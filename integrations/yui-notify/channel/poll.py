import sys

import anyio
from mcp.shared.message import SessionMessage
from mcp_types import JSONRPCNotification
from yui_notify.post import get


async def dispatch(answer: dict, write) -> None:
    if not isinstance(answer, dict) or not isinstance(answer.get("ask_id"), str):
        raise TypeError("answer requires a string ask_id")
    if answer.get("release"):
        return
    ask_id = answer["ask_id"]
    if ask_id.startswith("perm:"):
        await _notify(
            write,
            "/permission",
            {
                "request_id": ask_id[5:],
                "behavior": "allow" if answer.get("choice") == "allow" else "deny",
            },
        )
    elif not ask_id.startswith("next:"):
        return
    if answer.get("text"):
        await _notify(write, "", {"content": answer["text"], "meta": {"source": "yui"}})


async def _notify(write, suffix: str, params: dict) -> None:
    await write.send(
        SessionMessage(
            JSONRPCNotification(
                jsonrpc="2.0",
                method="notifications/claude/channel" + suffix,
                params=params,
            )
        )
    )


async def poll(url: str, write) -> None:
    delay = 1
    while True:
        status, answer, error = await anyio.to_thread.run_sync(
            get, url + "/answer?wait=25", 30, abandon_on_cancel=True
        )
        if error or status not in (200, 204):
            await anyio.sleep(delay)
            delay = min(delay * 2, 30)
            continue
        delay = 1
        if status == 200:
            try:
                await dispatch(answer, write)
            except Exception as error:  # noqa: BLE001
                print(f"yui-notify: answer dispatch failed: {error}", file=sys.stderr)
