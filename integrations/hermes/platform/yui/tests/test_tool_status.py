"""Which tool the agent is using: the tool hooks."""

from __future__ import annotations

import pytest
from gateway_stub import STUB_ENV
from yui import state, tool_status

CHAT = "yui-3f9a2c1d"


@pytest.fixture(autouse=True)
def clean():
    STUB_ENV["HERMES_SESSION_CHAT_ID"] = CHAT
    yield
    tool_status.set_sink(None)
    STUB_ENV.pop("HERMES_SESSION_CHAT_ID", None)


def collect() -> list[tuple[str, str, str]]:
    taken: list[tuple[str, str, str]] = []
    tool_status.set_sink(
        lambda chat_id, tool_state, tool_name: taken.append((chat_id, tool_state, tool_name))
    )
    return taken


def test_a_pre_tool_call_hands_running_to_the_sink_and_returns_none():
    taken = collect()
    result = tool_status.on_pre_tool_call(tool_name="read_file", task_id="", session_id="")
    assert result is None
    assert taken == [(CHAT, "running", "read_file")]


def test_a_post_tool_call_hands_done_to_the_sink():
    taken = collect()
    tool_status.on_post_tool_call(tool_name="read_file", task_id="", session_id="")
    assert taken == [(CHAT, "done", "read_file")]


def test_generate_express_hands_nothing():
    taken = collect()
    tool_status.on_pre_tool_call(tool_name="generate_express", task_id="", session_id="")
    tool_status.on_post_tool_call(tool_name="generate_express", task_id="", session_id="")
    assert taken == []


def test_a_delegated_childs_call_hands_nothing_and_the_agents_own_does():
    taken = collect()
    tool_status.on_pre_tool_call(tool_name="read_file", task_id="child-1", session_id="sess-1")
    tool_status.on_post_tool_call(tool_name="read_file", task_id="child-1", session_id="sess-1")
    assert taken == []
    tool_status.on_pre_tool_call(tool_name="read_file", task_id="sess-1", session_id="sess-1")
    assert taken == [(CHAT, "running", "read_file")]


def test_with_no_chat_and_no_connected_client_nothing_reaches_the_sink():
    taken = collect()
    STUB_ENV.pop("HERMES_SESSION_CHAT_ID", None)
    state.set_connected(CHAT, False)
    tool_status.on_pre_tool_call(tool_name="read_file", task_id="", session_id="")
    tool_status.on_post_tool_call(tool_name="read_file", task_id="", session_id="")
    assert taken == []
