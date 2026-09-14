"""The WebSocket the client talks to: hello, turns, renders, reports and delegations."""

from __future__ import annotations

import asyncio
import time

import aiohttp
import pytest
from aiohttp.test_utils import TestClient, TestServer
from gateway_stub import MessageEvent, MessageType, ProcessingOutcome
from yui import delegations, reports, state
from yui.adapter import MAX_FRAME_BYTES, YuiAdapter

CHAT = "yui-3f9a2c1d"
KEY = "test-key"
VOCABULARY = {
    "emotion_ids": ["neutral", "happy", "curious"],
    "motion_ids": ["idle"],
    "emotion_text_mode": "free",
    "emotion_text_map": {},
}


class FakeConfig:
    def __init__(self, **extra):
        self.extra = extra


@pytest.fixture(autouse=True)
def clean():
    yield
    for chat in (CHAT, "other"):
        state.reset(chat)
        state.set_connected(chat, False)
        state.set_turn_id(chat, None)
        reports.take(chat)
        delegations.forget(chat)
    delegations.set_notifier(None)


@pytest.fixture
async def adapter():
    made = YuiAdapter(FakeConfig(key=KEY))
    yield made
    await made.disconnect()


@pytest.fixture
async def client(adapter):
    served = TestClient(TestServer(adapter.build_app()))
    await served.start_server()
    yield served
    await served.close()


async def hello(client, chat_id=CHAT, key=KEY, vocabulary=VOCABULARY):
    ws = await client.ws_connect("/ws")
    await ws.send_json({"type": "hello", "key": key, "chat_id": chat_id, "vocabulary": vocabulary})
    return ws


async def ready(client, chat_id=CHAT, **kwargs):
    """Open a socket through the handshake and hand back the socket past its ready frame."""
    ws = await hello(client, chat_id=chat_id, **kwargs)
    assert await ws.receive_json() == {"type": "ready", "chat_id": chat_id}
    assert (await ws.receive_json())["type"] == "delegations"
    return ws


async def wait_for(predicate, timeout=2.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        await asyncio.sleep(0.01)
    raise AssertionError("condition never held")


def internal_event(adapter, text):
    return MessageEvent(
        text=text,
        message_type=MessageType.TEXT,
        internal=True,
        source=adapter.build_source(chat_id=CHAT, chat_type="dm"),
    )


async def test_a_hello_with_the_right_key_is_answered_with_ready(client):
    ws = await hello(client)
    assert await ws.receive_json() == {"type": "ready", "chat_id": CHAT}


async def test_a_wrong_key_closes_the_socket_and_says_nothing(client):
    ws = await hello(client, key="wrong")
    message = await ws.receive()
    assert message.type is aiohttp.WSMsgType.CLOSE
    assert message.data == 4401


async def test_a_hello_with_no_chat_id_is_turned_away(client):
    ws = await client.ws_connect("/ws")
    await ws.send_json({"type": "hello", "key": KEY})
    message = await ws.receive()
    assert message.type is aiohttp.WSMsgType.CLOSE
    assert message.data == 4401


async def test_an_oversized_frame_closes_the_socket(client):
    ws = await ready(client)
    await ws.send_str("x" * (MAX_FRAME_BYTES + 1))
    message = await ws.receive()
    assert message.type is aiohttp.WSMsgType.CLOSE
    assert message.data == 1009


async def test_a_second_hello_for_one_chat_replaces_the_first(client, adapter):
    first = await ready(client)
    second = await ready(client)
    message = await first.receive()
    assert message.type is aiohttp.WSMsgType.CLOSE
    assert message.data == 4409
    assert state.is_connected(CHAT) is True
    await second.close()


async def test_closing_the_socket_leaves_the_chat_disconnected(client):
    ws = await ready(client)
    await ws.close()
    await wait_for(lambda: not state.is_connected(CHAT))


async def test_a_turn_reaches_the_gateway_as_context_then_utterance(client, adapter):
    ws = await ready(client)
    await ws.send_json(
        {
            "type": "turn",
            "turn_id": "1789365854947",
            "client_context": "<client_context>\ntrigger: user message\n</client_context>",
            "text": "How did the tests go?",
        }
    )
    await wait_for(lambda: adapter.dispatched)
    event = adapter.dispatched[-1]
    assert event.text == (
        "<client_context>\ntrigger: user message\n</client_context>\n\nHow did the tests go?"
    )
    assert event.allow_gateway_control is False
    assert event.source.chat_id == CHAT
    assert event.source.chat_type == "dm"
    assert state.turn_id(CHAT) == "1789365854947"


async def test_a_turn_with_no_utterance_still_carries_its_context(client, adapter):
    ws = await ready(client)
    await ws.send_json(
        {"type": "turn", "turn_id": "7", "client_context": "<client_context>\n</client_context>", "text": ""}
    )
    await wait_for(lambda: adapter.dispatched)
    assert adapter.dispatched[-1].text == "<client_context>\n</client_context>"


async def test_a_reset_starts_a_new_conversation_through_the_gateway_command(client, adapter):
    ws = await ready(client)
    await ws.send_json({"type": "reset"})
    await wait_for(lambda: adapter.dispatched)
    event = adapter.dispatched[-1]
    assert event.text == "/new"
    assert event.allow_gateway_control is True
    assert event.source.chat_id == CHAT


async def test_a_vocabulary_frame_replaces_what_the_cues_are_checked_against(client):
    ws = await ready(client)
    await ws.send_json({"type": "vocabulary", "vocabulary": {"emotion_ids": ["smug"], "motion_ids": []}})
    await wait_for(lambda: state.vocabulary(CHAT).emotion_ids == ["smug"])


async def test_the_final_reply_renders_as_cued_sentences(client, adapter):
    ws = await ready(client)
    state.set_turn_id(CHAT, "1789365854947")
    state.append_cue(CHAT, {"emotion_id": "happy"}, "All green")
    state.append_cue(CHAT, {"emotion_id": "curious"}, "Want the slow ones")
    await adapter.send(CHAT, "All green. Want the slow ones listed?", metadata={"notify": True})
    frame = await ws.receive_json()
    assert frame == {
        "type": "render",
        "turn_id": "1789365854947",
        "source": "hermes",
        "segments": [
            {"cues": [{"emotion_id": "happy"}], "speech": "All green."},
            {"cues": [{"emotion_id": "curious"}], "speech": "Want the slow ones listed?"},
        ],
    }


async def test_a_progress_send_never_reaches_the_client(client, adapter):
    ws = await ready(client)
    await adapter.send(CHAT, "still working", metadata=None)
    await adapter.send(CHAT, "done", metadata={"notify": True})
    frame = await ws.receive_json()
    assert frame["segments"] == [{"cues": [], "speech": "done"}]


async def test_a_reply_the_agent_speaks_on_its_own_carries_no_turn_id(client, adapter):
    ws = await ready(client)
    state.set_turn_id(CHAT, None)
    await adapter.send(CHAT, "The build finished.", metadata={"notify": True})
    assert (await ws.receive_json())["turn_id"] is None


async def test_a_silent_turn_closes_with_no_segments(client, adapter):
    ws = await ready(client)
    state.set_turn_id(CHAT, "7")
    state.append_cue(CHAT, {"emotion_id": "happy"}, "")
    event = MessageEvent(text="hi", source=adapter.build_source(chat_id=CHAT))
    await adapter.on_processing_complete(event, ProcessingOutcome.SUCCESS)
    assert await ws.receive_json() == {
        "type": "render",
        "turn_id": "7",
        "source": "hermes",
        "segments": [],
    }


async def test_a_turn_that_already_spoke_is_not_closed_twice(client, adapter):
    ws = await ready(client)
    await adapter.send(CHAT, "Done.", metadata={"notify": True})
    await ws.receive_json()
    event = MessageEvent(text="hi", source=adapter.build_source(chat_id=CHAT))
    await adapter.on_processing_complete(event, ProcessingOutcome.SUCCESS)
    await adapter.send(CHAT, "Next.", metadata={"notify": True})
    assert (await ws.receive_json())["segments"] == [{"cues": [], "speech": "Next."}]


async def test_a_report_arriving_with_a_client_connected_goes_straight_through(client, adapter):
    await ready(client)
    await adapter.handle_message(internal_event(adapter, "the build finished"))
    assert [e.text for e in adapter.dispatched] == ["the build finished"]


async def test_one_report_held_while_away_is_delivered_untouched(client, adapter):
    await adapter.handle_message(internal_event(adapter, "the build finished"))
    assert adapter.dispatched == []
    await ready(client)
    await wait_for(lambda: adapter.dispatched)
    assert adapter.dispatched[-1].text == "the build finished"
    assert adapter.dispatched[-1].internal is True


async def test_a_held_report_is_accepted_so_the_gateway_stops_retrying(adapter):
    event = internal_event(adapter, "the build finished")
    await adapter.handle_message(event)
    assert event._gateway_accepted is True


async def test_several_reports_held_while_away_arrive_as_one_summary_turn(client, adapter):
    for text in ("first", "second", "third"):
        await adapter.handle_message(internal_event(adapter, text))
    await ready(client)
    await wait_for(lambda: adapter.dispatched)
    event = adapter.dispatched[-1]
    assert event.internal is True
    assert event.allow_gateway_control is False
    assert event.text.split("\n\n") == [
        (
            "While the client was disconnected, 3 reports arrived. "
            "Summarise them for the user in one short reply, most important first."
        ),
        "first",
        "second",
        "third",
    ]


async def test_a_flood_of_reports_keeps_twenty_and_counts_the_rest(client, adapter):
    for number in range(25):
        await adapter.handle_message(internal_event(adapter, f"report {number}"))
    await ready(client)
    await wait_for(lambda: adapter.dispatched)
    lines = adapter.dispatched[-1].text.split("\n\n")
    assert lines[0].startswith(
        "While the client was disconnected, 20 reports arrived (5 older ones dropped)."
    )
    assert lines[1:] == [f"report {number}" for number in range(5, 25)]


async def test_a_typed_turn_is_never_held_while_away(client, adapter):
    event = MessageEvent(text="hello", source=adapter.build_source(chat_id=CHAT))
    await adapter.handle_message(event)
    assert [e.text for e in adapter.dispatched] == ["hello"]


async def test_the_delegation_list_arrives_right_after_ready(client):
    ws = await client.ws_connect("/ws")
    await ws.send_json({"type": "hello", "key": KEY, "chat_id": CHAT, "vocabulary": VOCABULARY})
    assert (await ws.receive_json())["type"] == "ready"
    assert await ws.receive_json() == {"type": "delegations", "items": []}


async def test_a_delegation_change_reaches_the_connected_client(client, adapter):
    ws = await ready(client)
    adapter.notify_delegations(CHAT)
    frame = await ws.receive_json()
    assert frame["type"] == "delegations"
