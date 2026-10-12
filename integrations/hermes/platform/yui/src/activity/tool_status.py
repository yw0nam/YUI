"""Which tool the agent is using, as the client's chip and tool phrase show it."""

from __future__ import annotations

import logging
from collections.abc import Callable

from ..express import tools
from ..turns import session
from ..tools.image_result import result_text

logger = logging.getLogger(__name__)

_sink: Callable[[str, str, str], None] | None = None


def set_sink(callback: Callable[[str, str, str], None] | None) -> None:
    """Who to hand a tool state to; the adapter frames it onto its loop."""
    global _sink
    _sink = callback


def on_pre_tool_call(
    tool_name: object = None, task_id: object = None, session_id: object = None, **_kwargs: object
) -> None:
    """A tool call starts. The gateway awaits a dict to alter the call, so nothing is returned."""
    _report("running", tool_name, task_id, session_id)


def on_post_tool_call(
    tool_name: object = None,
    task_id: object = None,
    session_id: object = None,
    result: object = None,
    status: object = None,
    **_kwargs: object,
) -> None:
    """A tool call came back."""
    _report(
        "failed" if _failed(tool_name, result, status) else "done",
        tool_name,
        task_id,
        session_id,
    )


def _failed(tool_name: object, result: object, status: object) -> bool:
    """The client's own verdicts read as failures: any non-ok body action, any error string."""
    if status == "error":
        return True
    name = str(tool_name or "")
    text = result_text(result)
    if name == "body_action":
        return text != "ok"
    if name == "look":
        return text.startswith("error:")
    return False


def _report(state: str, tool_name: object, task_id: object, session_id: object) -> None:
    """One call's state to the sink, when the call is work a YUI turn's agent is waiting on."""
    name = str(tool_name or "")
    task = str(task_id or "")
    if not name or name == tools.TOOL_NAME:
        return
    if task and task != str(session_id or ""):
        return
    chat_id = session.current_chat_id()
    sink = _sink
    if not chat_id or sink is None:
        return
    try:
        sink(chat_id, state, name)
    except Exception:
        logger.debug("yui: tool status sink failed", exc_info=True)
