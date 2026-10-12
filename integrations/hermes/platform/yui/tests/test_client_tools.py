"""The client-declared tools: registration from ``hello.tools``, the blocking handler, the failures."""

from __future__ import annotations

import asyncio
import contextlib
import json
from types import SimpleNamespace

import pytest
from gateway_stub import STUB_ENV
from yui.src.tools import handler, pending, registry
from yui.src.transport.adapter import YuiAdapter
from yui.src.turns import state

CHAT = "yui-3f9a2c1d"


class FakeConfig:
    def __init__(self, **extra):
        self.extra = extra

LOOK_TOOL = {
    "type": "function",
    "function": {
        "name": "look",
        "description": "Read the character's state",
        "parameters": {
            "type": "object",
            "properties": {"at": {"type": "string", "enum": ["body", "perch_targets"]}},
            "required": ["at"],
            "additionalProperties": False,
        },
    },
}


@pytest.fixture(autouse=True)
def clean():
    state.set_connected(CHAT, True)
    yield
    handler.set_sink(None)
    pending._calls.clear()
    pending._locks.clear()
    state.set_connected(CHAT, False)
    state.close_turns(CHAT)
    STUB_ENV.pop("HERMES_SESSION_CHAT_ID", None)


def made_adapter(monkeypatch, sends: list[dict] | None = None, *, answers: bool = True) -> YuiAdapter:
    """An adapter on this loop whose frame writes are recorded instead of put on a socket."""
    made = YuiAdapter(FakeConfig(key="k"))
    made._loop = asyncio.get_running_loop()

    async def fake_send(chat_id: str, frame: dict) -> bool:
        if sends is not None:
            sends.append(frame)
        if answers and chat_id == CHAT and frame.get("type") == "tool_call":
            pending.resolve(chat_id, str(frame["id"]), "ok")
        return True

    monkeypatch.setattr(made, "_send_frame", fake_send)
    return made


def test_registration_registers_each_client_tool_once_per_fingerprint(monkeypatch):
    registered: list[dict] = []

    class Ctx:
        def register_tool(self, **kwargs):
            registered.append(kwargs)

    monkeypatch.setattr(registry, "_ctx", Ctx())
    monkeypatch.setattr(registry, "_declared", set())

    registry.declare([LOOK_TOOL], CHAT)
    registry.declare([LOOK_TOOL], CHAT)

    assert len(registered) == 1
    assert registered[0]["name"] == "look"
    assert registered[0]["toolset"] == "yui"
    assert registered[0]["schema"]["description"] == "Read the character's state"
    assert registered[0]["schema"]["parameters"]["required"] == ["at"]
    assert callable(registered[0]["handler"])


async def test_the_handler_sends_one_tool_call_and_returns_the_result(monkeypatch):
    sends: list[dict] = []
    made = made_adapter(monkeypatch, sends)
    handler.set_sink(made)
    state.open_turn(CHAT, "t1")
    STUB_ENV["HERMES_SESSION_CHAT_ID"] = CHAT

    result = await asyncio.to_thread(handler.handle("body_action"), {"action": "stand"})

    assert result == "ok"
    assert [json.dumps(frame, sort_keys=True) for frame in sends] == [
        json.dumps(
            {
                "type": "tool_call",
                "id": sends[0]["id"],
                "turn_id": "t1",
                "name": "body_action",
                "arguments": {"action": "stand"},
            },
            sort_keys=True,
        )
    ]
    assert sends[0]["turn_id"] == "t1"


async def test_the_handler_answers_disconnected_with_no_ready_socket(monkeypatch):
    made = made_adapter(monkeypatch)
    handler.set_sink(made)
    state.set_connected(CHAT, False)
    STUB_ENV["HERMES_SESSION_CHAT_ID"] = CHAT

    result = await asyncio.to_thread(handler.handle("look"), {"at": "body"})

    assert result == "error: client disconnected"


async def test_a_wait_that_passes_answers_no_reply(monkeypatch):
    made = made_adapter(monkeypatch, answers=False)
    handler.set_sink(made)
    STUB_ENV["HERMES_SESSION_CHAT_ID"] = CHAT
    monkeypatch.setitem(handler.WAITS_S, "look", 1.0)

    result = await asyncio.to_thread(handler.handle("look"), {"at": "body"})

    assert result == "error: no reply from the client within 1 s"
    assert pending._calls.get(CHAT) is None


async def test_a_stop_fails_the_named_turns_calls(monkeypatch):
    made = made_adapter(monkeypatch, answers=False)
    handler.set_sink(made)
    state.open_turn(CHAT, "t1")
    STUB_ENV["HERMES_SESSION_CHAT_ID"] = CHAT

    task = asyncio.create_task(asyncio.to_thread(handler.handle("body_action"), {"action": "stand"}))
    await asyncio.sleep(0.05)
    await made._on_stop(CHAT, {"type": "stop", "turn_ids": ["t1"]})

    assert await asyncio.wait_for(task, 2.0) == "error: turn stopped"


async def test_a_stop_fails_a_call_still_waiting_on_the_chat_lock_and_it_never_sends(monkeypatch):
    sends: list[dict] = []
    made = made_adapter(monkeypatch, sends, answers=False)
    handler.set_sink(made)
    state.open_turn(CHAT, "t1")
    STUB_ENV["HERMES_SESSION_CHAT_ID"] = CHAT

    first = asyncio.create_task(asyncio.to_thread(handler.handle("body_action"), {"action": "stand"}))
    await asyncio.sleep(0.05)
    second = asyncio.create_task(asyncio.to_thread(handler.handle("look"), {"at": "body"}))
    await asyncio.sleep(0.05)
    assert [frame["name"] for frame in sends] == ["body_action"]

    await made._on_stop(CHAT, {"type": "stop", "turn_ids": ["t1"]})

    assert await asyncio.wait_for(first, 2.0) == "error: turn stopped"
    assert await asyncio.wait_for(second, 2.0) == "error: turn stopped"
    assert [frame["name"] for frame in sends] == ["body_action"]
    assert pending._calls.get(CHAT) is None


async def test_a_close_fails_every_pending_call_of_the_chat(monkeypatch):
    made = made_adapter(monkeypatch, answers=False)
    handler.set_sink(made)
    STUB_ENV["HERMES_SESSION_CHAT_ID"] = CHAT
    ws = SimpleNamespace(closed=False)

    task = asyncio.create_task(asyncio.to_thread(handler.handle("look"), {"at": "body"}))
    await asyncio.sleep(0.05)
    made._sockets[CHAT] = ws
    made._forget(CHAT, ws)

    assert await asyncio.wait_for(task, 2.0) == "error: client disconnected"


async def test_a_replacement_fails_the_replaced_sockets_pending_calls(monkeypatch):
    made = made_adapter(monkeypatch, answers=False)
    handler.set_sink(made)
    STUB_ENV["HERMES_SESSION_CHAT_ID"] = CHAT
    old_ws = SimpleNamespace(closed=False)
    made._sockets[CHAT] = old_ws

    task = asyncio.create_task(asyncio.to_thread(handler.handle("look"), {"at": "body"}))
    await asyncio.sleep(0.05)
    new_ws = SimpleNamespace(closed=False, sent=[], send_str=None)

    async def record(text: str) -> None:
        new_ws.sent.append(text)  # type: ignore[attr-defined]

    new_ws.send_str = record
    with contextlib.suppress(Exception):
        await made._greet(new_ws, {"type": "hello", "key": "k", "chat_id": CHAT})

    assert await asyncio.wait_for(task, 2.0) == "error: client disconnected"


async def test_a_result_for_an_unknown_call_is_ignored(monkeypatch):
    made = made_adapter(monkeypatch)
    future = pending.register(CHAT, "c1", "t1")

    await made._on_frame(CHAT, {"type": "tool_result", "id": "other", "result": "x"})
    await made._on_frame(CHAT, {"type": "tool_result", "result": "x"})

    assert future.done() is False

    await made._on_frame(CHAT, {"type": "tool_result", "id": "c1", "result": "{}"})
    assert future.result(timeout=1) == "{}"
