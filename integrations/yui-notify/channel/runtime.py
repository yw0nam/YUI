import os
import signal
import sys
from contextlib import nullcontext

import anyio
from mcp.server.runner import serve_loop
from mcp.server.stdio import stdio_server
from yui_notify import config
from yui_notify.channel import ready_file
from yui_notify.label import context

from channel.identity import discover
from channel.poll import poll
from channel.relay import PermissionRequest, relay

CAPABILITIES = {"claude/channel": {}, "claude/channel/permission": {}}


async def _shutdown(scope):
    with anyio.open_signal_receiver(signal.SIGTERM, signal.SIGINT) as signals:
        async for _ in signals:
            scope.cancel()
            return


async def serve(server, identity, env):
    url = config.load(env)["endpoint"] + "/threads/" + identity.thread_id
    async with stdio_server() as (read, write), anyio.create_task_group() as tasks:
        tasks.start_soon(_shutdown, tasks.cancel_scope)
        options = server.create_initialization_options(experimental_capabilities=CAPABILITIES)
        with ready_file(identity.pid, env) if identity.ready else nullcontext():
            if identity.ready:
                tasks.start_soon(poll, url, write)
            try:
                await serve_loop(server, read, write, lifespan_state=None, init_options=options)
            finally:
                tasks.cancel_scope.cancel()


async def main(server):
    try:
        identity = discover()
    except ValueError as error:
        print(f"yui-notify: {error}", file=sys.stderr)
        raise SystemExit(1) from None
    env = os.environ
    url = config.load(env)["endpoint"] + "/threads/" + identity.thread_id
    ctx = context(os.getcwd(), env)

    async def permission(_context, request):
        if identity.ready:
            await relay(url, ctx, request)

    server.add_notification_handler(
        "notifications/claude/channel/permission_request",
        PermissionRequest,
        permission,
    )
    await serve(server, identity, env)
