import os
import sys

import anyio
from mcp.server.runner import serve_loop
from mcp.server.stdio import stdio_server
from mcp_types import NotificationParams
from yui_notify import config
from yui_notify.channel_file import ready_file, remove_ready_file
from yui_notify.label import context

from channel.identity import discover
from channel.poll import poll
from channel.relay import PermissionRequest, relay

CAPABILITIES = {"claude/channel": {}, "claude/channel/permission": {}}


def stop(signum=None, frame=None) -> None:
    """leave at once: the stdio reader thread cannot be interrupted"""
    remove_ready_file(os.environ)
    try:
        sys.stdout.flush()
    except (OSError, ValueError):
        pass
    os._exit(0)


async def _run_channel(initialized, identity, env, url, write):
    await initialized.wait()
    with ready_file(identity.pid, env):
        await poll(url, write)


def _register_channel(server, url, ctx, env, initialized):
    async def permission(_context, request):
        await relay(url, ctx, request, env)

    async def on_initialized(_context, _params):
        initialized.set()

    server.add_notification_handler(
        "notifications/claude/channel/permission_request", PermissionRequest, permission
    )
    server.add_notification_handler("notifications/initialized", NotificationParams, on_initialized)


async def serve(server, identity, env):
    ready = identity is not None and identity.ready
    initialized = anyio.Event()
    if ready:
        url = config.load(env)["endpoint"] + "/threads/" + identity.thread_id
        _register_channel(server, url, context(os.getcwd(), env), env, initialized)
    else:
        reason = "claude process not found" if identity is None else "Claude Code channel not enabled"
        print(f"yui-notify: {reason}; channel idle", file=sys.stderr)
    async with stdio_server() as (read, write), anyio.create_task_group() as tasks:
        if ready:
            tasks.start_soon(_run_channel, initialized, identity, env, url, write)
        options = server.create_initialization_options(experimental_capabilities=CAPABILITIES)
        try:
            await serve_loop(server, read, write, lifespan_state=None, init_options=options)
        finally:
            tasks.cancel_scope.cancel()


async def main(server):
    try:
        identity = discover()
    except ValueError:
        identity = None
    await serve(server, identity, os.environ)
