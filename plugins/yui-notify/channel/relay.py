import os

import anyio
from pydantic import BaseModel
from yui_notify import config
from yui_notify.adapters import Event
from yui_notify.post import put
from yui_notify.thread import build_thread, fit_entries, permission_ask


class PermissionRequest(BaseModel):
    request_id: str
    tool_name: str
    description: str
    input_preview: str


async def relay(url: str, ctx: dict, request: PermissionRequest, env=os.environ) -> None:
    event = Event(
        agent="claude-code",
        phase="PermissionRequest",
        session_id="",
        cwd="",
        text=f"{request.tool_name}: {request.description}\n{request.input_preview}",
        turn_id="",
        tool_name=request.tool_name,
    )
    body = build_thread(event, ctx, False)
    body["ask"] = permission_ask("perm:" + request.request_id, request.tool_name, "Claude")
    fit_entries(body)
    status, _, error = await anyio.to_thread.run_sync(put, url, body, abandon_on_cancel=True)
    if error:
        config.write_error(env, url, status, error)
