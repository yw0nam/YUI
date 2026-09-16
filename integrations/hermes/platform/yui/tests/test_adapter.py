"""The WebSocket the client talks to: hello, turns, renders, reports and delegations."""

from __future__ import annotations

import asyncio
import json
import logging
import time

import aiohttp
import pytest
from aiohttp.test_utils import TestClient, TestServer
from gateway_stub import (
    PERSISTED_HOMES,
    SLASH_CONFIRM,
    STUB_ENV,
    MessageEvent,
    MessageType,
    ProcessingOutcome,
)
from yui import delegations, reasoning, reports, state
from yui.adapter import MAX_FRAME_BYTES, YuiAdapter, fit_frame, is_loopback

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
        state.set_muted(chat, False)
        reports.take(chat)
        reports.take_renders(chat)
        delegations.forget(chat)
        reasoning.clear(chat)
    delegations.set_notifier(None)
    reasoning.set_sink(None)
    PERSISTED_HOMES.clear()
    SLASH_CONFIRM.pending.clear()
    SLASH_CONFIRM.resolved.clear()
    STUB_ENV.pop("HERMES_SESSION_CHAT_ID", None)


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
    assert await recv(ws) == {"type": "ready", "chat_id": chat_id}
    assert (await recv(ws))["type"] == "delegations"
    return ws


async def recv(ws):
    """One frame, or a failure; a missing frame must not hang the suite."""
    return await asyncio.wait_for(ws.receive_json(), 2.0)


async def recv_raw(ws):
    return await asyncio.wait_for(ws.receive(), 2.0)


async def wait_for(predicate, timeout=2.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        await asyncio.sleep(0.01)
    raise AssertionError("condition never held")


def user_turn(adapter, turn_id):
    return MessageEvent(
        text="hi", message_id=turn_id, source=adapter.build_source(chat_id=CHAT, chat_type="dm")
    )


def internal_event(adapter, text):
    return MessageEvent(
        text=text,
        message_type=MessageType.TEXT,
        internal=True,
        source=adapter.build_source(chat_id=CHAT, chat_type="dm"),
    )


async def test_a_hello_with_the_right_key_is_answered_with_ready(client):
    ws = await hello(client)
    assert await recv(ws) == {"type": "ready", "chat_id": CHAT}


async def test_a_wrong_key_closes_the_socket_and_says_nothing(client):
    ws = await hello(client, key="wrong")
    message = await recv_raw(ws)
    assert message.type is aiohttp.WSMsgType.CLOSE
    assert message.data == 4401


async def test_a_hello_with_no_chat_id_is_turned_away(client):
    ws = await client.ws_connect("/ws")
    await ws.send_json({"type": "hello", "key": KEY})
    message = await recv_raw(ws)
    assert message.type is aiohttp.WSMsgType.CLOSE
    assert message.data == 4401


async def test_an_oversized_frame_closes_the_socket(client):
    ws = await ready(client)
    await ws.send_str("x" * (MAX_FRAME_BYTES + 1))
    message = await recv_raw(ws)
    assert message.type is aiohttp.WSMsgType.CLOSE
    assert message.data == 1009


async def test_a_second_hello_for_one_chat_replaces_the_first(client, adapter):
    first = await ready(client)
    second = await ready(client)
    message = await recv_raw(first)
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
    assert event.message_id == "1789365854947"


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
    await adapter.on_processing_start(user_turn(adapter, "1789365854947"))
    state.append_cue(CHAT, {"emotion_id": "happy"}, "All green")
    state.append_cue(CHAT, {"emotion_id": "curious"}, "Want the slow ones")
    await adapter.send(CHAT, "All green. Want the slow ones listed?", metadata={"notify": True})
    frame = await recv(ws)
    assert frame == {
        "type": "render",
        "turn_id": "1789365854947",
        "source": "hermes",
        "segments": [
            {"cues": [{"emotion_id": "happy"}], "speech": "All green."},
            {"cues": [{"emotion_id": "curious"}], "speech": "Want the slow ones listed?"},
        ],
    }


async def test_a_reply_the_gateway_did_not_mark_final_still_renders(client, adapter):
    ws = await ready(client)
    await adapter.send(CHAT, "The tests passed.", metadata={"thread_id": "t1"})
    assert (await recv(ws))["segments"] == [{"cues": [], "speech": "The tests passed."}]


async def test_an_interim_stream_frame_is_not_rendered(client, adapter):
    ws = await ready(client)
    await adapter.send(CHAT, "The tests", metadata={"expect_edits": True})
    await adapter.send(CHAT, "The tests passed.", metadata={"notify": True})
    assert (await recv(ws))["segments"] == [{"cues": [], "speech": "The tests passed."}]


async def test_the_busy_acknowledgement_is_not_rendered(client, adapter):
    """The gateway's busy path sends it through _send_with_retry, carrying no marker of its own."""
    ws = await ready(client)
    await adapter.on_processing_start(user_turn(adapter, "1789365854947"))
    await adapter._send_with_retry(
        chat_id=CHAT,
        content="⏳ Still working on the previous message — this one is queued.",
        reply_to="1789365854948",
        metadata=None,
    )
    await adapter.send(CHAT, "Done.", metadata={"notify": True})
    assert (await recv(ws))["segments"] == [{"cues": [], "speech": "Done."}]


async def test_a_gateway_status_notice_is_not_rendered(client, adapter):
    """_send_or_update_status_coro routes every status notice to send_or_update_status."""
    ws = await ready(client)
    await adapter.on_processing_start(user_turn(adapter, "1789365854947"))
    result = await adapter.send_or_update_status(
        CHAT, "context_pressure", "⚠️ Context is nearly full.", metadata=None
    )
    assert result.success is True
    await adapter.send(CHAT, "Done.", metadata={"notify": True})
    assert (await recv(ws))["segments"] == [{"cues": [], "speech": "Done."}]


def test_the_gateway_says_nothing_to_this_platform_when_it_restarts():
    """The home-channel ping and the restart and shutdown notices share this one gate."""
    config = FakeConfig(key=KEY)
    config.gateway_restart_notification = True
    YuiAdapter(config)
    assert config.gateway_restart_notification is False


def test_a_config_without_the_restart_gate_is_reported_and_left_alone(caplog):
    """An upstream rename of the gate shows up in the log instead of silently bringing pings back."""
    config = FakeConfig(key=KEY)
    with caplog.at_level(logging.WARNING):
        YuiAdapter(config)
    assert not hasattr(config, "gateway_restart_notification")
    assert "gateway_restart_notification" in caplog.text


async def test_the_words_before_a_tool_call_still_render(client, adapter):
    """Interim commentary reaches send() with no metadata at all; it is the agent speaking."""
    ws = await ready(client)
    await adapter.on_processing_start(user_turn(adapter, "1789365854947"))
    await adapter.send(CHAT, "Let me look at the logs.", metadata=None)
    assert (await recv(ws))["segments"] == [{"cues": [], "speech": "Let me look at the logs."}]


async def test_a_mid_turn_status_line_is_not_rendered(client, adapter):
    ws = await ready(client)
    await adapter.send(CHAT, "⏳ Working — 2 min", metadata={"_interim_send": True})
    await adapter.send(CHAT, "Done.", metadata={"notify": True})
    assert (await recv(ws))["segments"] == [{"cues": [], "speech": "Done."}]


async def test_a_send_with_no_words_is_not_rendered(client, adapter):
    ws = await ready(client)
    await adapter.send(CHAT, "   ", metadata={"notify": True})
    await adapter.send(CHAT, "Done.", metadata={"notify": True})
    assert (await recv(ws))["segments"] == [{"cues": [], "speech": "Done."}]


async def test_a_reply_the_agent_speaks_on_its_own_carries_no_turn_id(client, adapter):
    ws = await ready(client)
    await adapter.on_processing_start(internal_event(adapter, "the build finished"))
    await adapter.send(CHAT, "The build finished.", metadata={"notify": True})
    assert (await recv(ws))["turn_id"] is None


async def test_a_silent_turn_with_no_cues_closes_with_no_segments(client, adapter):
    ws = await ready(client)
    await adapter.on_processing_start(user_turn(adapter, "7"))
    event = MessageEvent(text="hi", source=adapter.build_source(chat_id=CHAT))
    await adapter.on_processing_complete(event, ProcessingOutcome.SUCCESS)
    assert await recv(ws) == {
        "type": "render",
        "turn_id": "7",
        "source": "hermes",
        "segments": [],
    }


async def test_a_turn_that_already_spoke_is_not_closed_twice(client, adapter):
    ws = await ready(client)
    await adapter.send(CHAT, "Done.", metadata={"notify": True})
    await recv(ws)
    event = MessageEvent(text="hi", source=adapter.build_source(chat_id=CHAT))
    await adapter.on_processing_complete(event, ProcessingOutcome.SUCCESS)
    await adapter.send(CHAT, "Next.", metadata={"notify": True})
    assert (await recv(ws))["segments"] == [{"cues": [], "speech": "Next."}]


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
    assert (await recv(ws))["type"] == "ready"
    assert await recv(ws) == {"type": "delegations", "items": []}


async def test_a_delegation_change_reaches_the_connected_client(client, adapter):
    ws = await ready(client)
    adapter.notify_delegations(CHAT)
    frame = await recv(ws)
    assert frame["type"] == "delegations"


async def test_the_plugin_approves_the_gateway_confirmation_of_its_own_reset(adapter):
    SLASH_CONFIRM.register("agent:main:yui:dm:" + CHAT, "7", "new")
    result = await adapter.send_slash_confirm(
        chat_id=CHAT,
        title="/new",
        message="⚠️ **Confirm /new**",
        session_key="agent:main:yui:dm:" + CHAT,
        confirm_id="7",
    )
    assert result.success is True
    await wait_for(lambda: SLASH_CONFIRM.resolved)
    assert SLASH_CONFIRM.resolved == [("agent:main:yui:dm:" + CHAT, "7", "once")]


async def test_a_reset_clears_the_delegations_the_client_was_shown(client, adapter):
    STUB_ENV["HERMES_SESSION_CHAT_ID"] = CHAT
    delegations.on_subagent_start(child_subagent_id="sa-1", child_session_id="s-1", child_goal="Work")
    ws = await ready(client)
    assert delegations.items(CHAT)
    await ws.send_json({"type": "reset"})
    await wait_for(lambda: adapter.dispatched)
    assert await recv(ws) == {"type": "delegations", "items": []}
    assert delegations.items(CHAT) == []


async def test_the_reset_reply_is_not_spoken_but_the_next_one_is(client, adapter):
    ws = await ready(client)
    await ws.send_json({"type": "reset"})
    await wait_for(lambda: adapter.dispatched)
    assert (await recv(ws))["type"] == "delegations"
    await adapter.send(CHAT, "✨ New conversation started.", metadata={"notify": True})
    await adapter.send(CHAT, "Hello again.", metadata={"notify": True})
    frame = await recv(ws)
    assert frame["segments"] == [{"cues": [], "speech": "Hello again."}]


async def test_approving_the_confirmation_leaves_the_next_reply_speakable(client, adapter):
    ws = await ready(client)
    await ws.send_json({"type": "reset"})
    await wait_for(lambda: adapter.dispatched)
    assert (await recv(ws))["type"] == "delegations"
    SLASH_CONFIRM.register("agent:main:yui:dm:" + CHAT, "7", "new")
    await adapter.send_slash_confirm(
        chat_id=CHAT,
        title="/new",
        message="⚠️ **Confirm /new**",
        session_key="agent:main:yui:dm:" + CHAT,
        confirm_id="7",
    )
    await adapter.send(CHAT, "Hello again.", metadata={"notify": True})
    frame = await recv(ws)
    assert frame["segments"] == [{"cues": [], "speech": "Hello again."}]


async def test_the_turn_id_is_bound_when_the_gateway_starts_the_turn(client, adapter):
    ws = await ready(client)
    await adapter.on_processing_start(user_turn(adapter, "777"))
    await adapter.send(CHAT, "Done.", metadata={"notify": True})
    assert (await recv(ws))["turn_id"] == "777"


async def test_a_report_turn_renders_without_a_turn_id(client, adapter):
    ws = await ready(client)
    await adapter.on_processing_start(internal_event(adapter, "the build finished"))
    await adapter.send(CHAT, "The build finished.", metadata={"notify": True})
    assert (await recv(ws))["turn_id"] is None


async def test_every_reply_of_a_turn_names_it(client, adapter):
    ws = await ready(client)
    await adapter.on_processing_start(user_turn(adapter, "777"))
    await adapter.send(CHAT, "The tests passed.", metadata={"thread_id": "t1"})
    await adapter.send(CHAT, "And the child finished.", metadata={"notify": True})
    assert (await recv(ws))["turn_id"] == "777"
    assert (await recv(ws))["turn_id"] == "777"


async def test_a_turn_that_spoke_leaves_its_id_cleared(client, adapter):
    ws = await ready(client)
    await adapter.on_processing_start(user_turn(adapter, "777"))
    await adapter.send(CHAT, "Done.", metadata={"notify": True})
    assert (await recv(ws))["turn_id"] == "777"
    event = MessageEvent(text="hi", source=adapter.build_source(chat_id=CHAT))
    await adapter.on_processing_complete(event, ProcessingOutcome.SUCCESS)
    assert state.turn_id(CHAT) is None


async def test_a_turn_that_ended_empty_leaves_its_id_cleared(client, adapter):
    ws = await ready(client)
    await adapter.on_processing_start(user_turn(adapter, "777"))
    event = MessageEvent(text="hi", source=adapter.build_source(chat_id=CHAT))
    await adapter.on_processing_complete(event, ProcessingOutcome.SUCCESS)
    assert (await recv(ws))["turn_id"] == "777"
    assert state.turn_id(CHAT) is None


async def test_a_cue_only_turn_leaves_its_id_cleared(client, adapter):
    ws = await ready(client)
    await adapter.on_processing_start(user_turn(adapter, "777"))
    state.append_cue(CHAT, {"emotion_id": "happy"}, "")
    event = MessageEvent(text="hi", source=adapter.build_source(chat_id=CHAT))
    await adapter.on_processing_complete(event, ProcessingOutcome.SUCCESS)
    assert (await recv(ws))["turn_id"] == "777"
    assert state.turn_id(CHAT) is None


async def test_a_muted_turn_leaves_its_id_cleared(client, adapter):
    await ready(client)
    await adapter.on_processing_start(user_turn(adapter, "777"))
    state.set_muted(CHAT, True)
    await adapter.send(CHAT, "✨ New conversation started.", metadata={"notify": True})
    event = MessageEvent(text="hi", source=adapter.build_source(chat_id=CHAT))
    await adapter.on_processing_complete(event, ProcessingOutcome.SUCCESS)
    assert state.turn_id(CHAT) is None


async def test_a_report_admitted_mid_turn_leaves_the_running_turn_alone(client, adapter):
    ws = await ready(client)
    await adapter.on_processing_start(user_turn(adapter, "777"))
    state.append_cue(CHAT, {"emotion_id": "happy"}, "")
    await adapter.handle_message(internal_event(adapter, "the build finished"))
    await adapter.send(CHAT, "Done.", metadata={"notify": True})
    frame = await recv(ws)
    assert frame["turn_id"] == "777"
    assert frame["segments"] == [{"cues": [{"emotion_id": "happy"}], "speech": "Done."}]


async def test_an_empty_turn_is_answered_so_the_client_is_not_left_waiting(client, adapter):
    ws = await ready(client)
    await ws.send_json({"type": "turn", "turn_id": "9", "client_context": "", "text": ""})
    assert await recv(ws) == {"type": "render", "turn_id": "9", "source": "hermes", "segments": []}
    assert adapter.dispatched == []


async def test_a_silent_turn_still_plays_its_cues(client, adapter):
    ws = await ready(client)
    await adapter.on_processing_start(user_turn(adapter, "7"))
    state.append_cue(CHAT, {"emotion_id": "happy"}, "One")
    state.append_cue(CHAT, {"motion_id": "idle"}, "")
    event = MessageEvent(text="hi", source=adapter.build_source(chat_id=CHAT))
    await adapter.on_processing_complete(event, ProcessingOutcome.SUCCESS)
    assert await recv(ws) == {
        "type": "render",
        "turn_id": "7",
        "source": "hermes",
        "segments": [{"cues": [{"emotion_id": "happy"}, {"motion_id": "idle"}], "speech": ""}],
    }


async def test_an_oversize_render_loses_its_trailing_segments(client, adapter):
    ws = await ready(client)
    await adapter.on_processing_start(user_turn(adapter, "7"))
    await adapter.send(CHAT, ("x" * 1000 + ". ") * 300, metadata={"notify": True})
    frame = await recv(ws)
    assert len(json.dumps(frame, ensure_ascii=False).encode("utf-8")) <= MAX_FRAME_BYTES
    assert 0 < len(frame["segments"]) < 300


def test_only_a_loopback_host_needs_no_key():
    assert is_loopback("127.0.0.1") is True
    assert is_loopback("localhost") is True
    assert is_loopback("::1") is True
    assert is_loopback("0.0.0.0") is False
    assert is_loopback("example.invalid") is False


async def test_binding_past_loopback_without_a_key_is_refused():
    refused = YuiAdapter(FakeConfig(host="0.0.0.0"))
    assert await refused.connect() is False
    assert refused.fatal is not None
    assert refused.fatal[0] == "no_key"


async def test_a_reply_finished_while_the_client_is_away_arrives_on_reconnect(client, adapter):
    ws = await ready(client)
    await adapter.on_processing_start(user_turn(adapter, "777"))
    await ws.close()
    await wait_for(lambda: not state.is_connected(CHAT))
    assert (await adapter.send(CHAT, "The tests passed.", metadata={"notify": True})).success is True
    back = await ready(client)
    assert await recv(back) == {
        "type": "render",
        "turn_id": "777",
        "source": "hermes",
        "segments": [{"cues": [], "speech": "The tests passed."}],
    }


async def test_a_reply_the_socket_cannot_take_is_held_not_failed(client, adapter):
    ws = await ready(client)
    await adapter.on_processing_start(user_turn(adapter, "777"))
    await ws.close()
    # The connected mark can outlive a socket the client has already dropped.
    await wait_for(lambda: not state.is_connected(CHAT))
    state.set_connected(CHAT, True)
    assert (await adapter.send(CHAT, "The tests passed.", metadata={"notify": True})).success is True
    back = await ready(client)
    assert (await recv(back))["turn_id"] == "777"


async def test_a_socket_that_dies_mid_flush_keeps_the_replies_it_did_not_take(adapter):
    for turn_id in ("1", "2"):
        reports.queue_render(CHAT, {"type": "render", "turn_id": turn_id, "segments": []})
    await adapter._flush_renders(CHAT)
    held, _dropped = reports.take_renders(CHAT)
    assert [frame["turn_id"] for frame in held] == ["1", "2"]


async def test_commentary_places_only_the_cues_it_names(client, adapter):
    ws = await ready(client)
    await adapter.on_processing_start(user_turn(adapter, "777"))
    state.append_cue(CHAT, {"emotion_id": "curious"}, "Let me check")
    state.append_cue(CHAT, {"emotion_id": "happy"}, "All green")
    await adapter.send(CHAT, "Let me check the tests.", metadata={"thread_id": "t1"})
    first = await recv(ws)
    await adapter.send(CHAT, "All green.", metadata={"notify": True})
    second = await recv(ws)
    assert first["segments"] == [{"cues": [{"emotion_id": "curious"}], "speech": "Let me check the tests."}]
    assert second["segments"] == [{"cues": [{"emotion_id": "happy"}], "speech": "All green."}]


async def test_a_socket_that_arrives_during_the_send_still_gets_the_reply(client, adapter, monkeypatch):
    ws = await ready(client)
    connected = state.is_connected
    seen: list[str] = []

    def racing(chat_id: str) -> bool:
        # The first look happens before the new socket marks itself ready.
        seen.append(chat_id)
        return connected(chat_id) if len(seen) > 1 else False

    monkeypatch.setattr(state, "is_connected", racing)
    await adapter.send(CHAT, "The tests passed.", metadata={"notify": True})
    assert (await recv(ws))["segments"] == [{"cues": [], "speech": "The tests passed."}]


# -- the audio, files and images the gateway offers ------------------------------------------


def test_the_gateway_never_synthesizes_audio_for_this_platform(adapter):
    """voice.auto_tts drives the base probe, and the client runs its own TTS."""
    assert adapter._should_auto_tts_for_chat(CHAT) is False


@pytest.mark.parametrize(
    "deliver",
    [
        lambda a: a.send_voice(chat_id=CHAT, audio_path="/tmp/reply.ogg"),
        lambda a: a.send_document(chat_id=CHAT, file_path="/tmp/notes.pdf"),
        lambda a: a.send_image(chat_id=CHAT, image_url="https://example.invalid/cat.png"),
        lambda a: a.send_video(chat_id=CHAT, video_path="/tmp/clip.mp4"),
        lambda a: a.send_image_file(chat_id=CHAT, image_path="/tmp/cat.png"),
    ],
)
async def test_media_is_dropped_without_a_word_reaching_the_reply(adapter, deliver, monkeypatch):
    """The base defaults put a "couldn't deliver" line in the chat; this platform speaks only."""
    spoken: list[str] = []

    async def spy(chat_id, content, reply_to=None, metadata=None):
        spoken.append(content)

    monkeypatch.setattr(adapter, "send", spy)
    result = await deliver(adapter)
    assert result.success is True
    assert spoken == []


# -- the home channel ------------------------------------------------------------------------


async def test_the_first_client_becomes_the_platform_home_channel(client, adapter):
    """Without one the gateway hints about /sethome on the first message of every session."""
    await ready(client)
    (home,) = PERSISTED_HOMES
    assert home.chat_id == CHAT
    assert home.name == "YUI"
    assert home.platform.value == "yui"
    assert adapter.config.home_channel is home


async def test_a_reconnecting_client_does_not_set_the_home_channel_again(client):
    ws = await ready(client)
    await ws.close()
    await ready(client)
    assert len(PERSISTED_HOMES) == 1


async def test_a_configured_home_channel_is_left_alone(client, adapter):
    adapter.config.home_channel = "already set"
    await ready(client)
    assert PERSISTED_HOMES == []


async def test_a_home_channel_that_cannot_be_saved_leaves_the_client_connected(client, monkeypatch):
    import gateway.config as gateway_config

    def refuse(home, **_kwargs):
        raise OSError("read-only config")

    monkeypatch.setattr(gateway_config, "persist_home_channel", refuse)
    ws = await ready(client)
    await ws.send_json({"type": "vocabulary", "vocabulary": {"emotion_ids": ["smug"], "motion_ids": []}})
    await wait_for(lambda: state.vocabulary(CHAT).emotion_ids == ["smug"])


# -- reasoning -------------------------------------------------------------------------------


async def test_the_reasoning_stream_reaches_the_client_as_one_coalesced_frame(client, adapter):
    """The hook runs on a worker thread, so the deltas are marshaled onto the adapter's loop."""
    ws = await ready(client)
    reasoning.set_sink(adapter.push_reasoning)
    STUB_ENV["HERMES_SESSION_CHAT_ID"] = CHAT
    for delta in ("I will ", "check ", "the log."):
        await asyncio.to_thread(reasoning.on_stream_delta, delta=delta, kind="reasoning", surface="yui")
    assert await recv(ws) == {"type": "reasoning", "delta": "I will check the log."}


async def test_the_render_carries_the_streamed_reasoning_over_the_prepended_block(client, adapter):
    ws = await ready(client)
    STUB_ENV["HERMES_SESSION_CHAT_ID"] = CHAT
    await adapter.on_processing_start(user_turn(adapter, "7"))
    reasoning.on_stream_delta(delta="The whole thought.", kind="reasoning", surface="yui")
    await adapter.send(
        CHAT,
        "\U0001f4ad **Reasoning:**\n```\nThe truncated thought.\n```\n\nAll green.",
        metadata={"notify": True},
    )
    frame = await recv(ws)
    assert frame["reasoning"] == "The whole thought."
    assert frame["segments"] == [{"cues": [], "speech": "All green."}]


async def test_the_render_carries_the_prepended_block_when_nothing_streamed(client, adapter):
    ws = await ready(client)
    await adapter.on_processing_start(user_turn(adapter, "7"))
    await adapter.send(
        CHAT,
        "\U0001f4ad **Reasoning:**\n```\nThe log is the first place to look.\n```\n\nAll green.",
        metadata={"notify": True},
    )
    frame = await recv(ws)
    assert frame["reasoning"] == "The log is the first place to look."
    assert frame["segments"] == [{"cues": [], "speech": "All green."}]


async def test_a_render_with_no_reasoning_at_all_carries_no_reasoning_field(client, adapter):
    ws = await ready(client)
    await adapter.on_processing_start(user_turn(adapter, "7"))
    await adapter.send(CHAT, "All green.", metadata={"notify": True})
    assert "reasoning" not in await recv(ws)


async def test_a_delta_that_lands_during_a_flush_leaves_on_the_next_one(client, adapter, monkeypatch):
    """The window pops its buffer before the send, so a token can arrive with the flush still armed."""
    ws = await ready(client)
    send_frame = adapter._send_frame
    admitted: list[bool] = []

    async def admitting(chat_id, frame):
        if not admitted:
            admitted.append(True)
            adapter._collect_reasoning(chat_id, "TAIL")
        return await send_frame(chat_id, frame)

    monkeypatch.setattr(adapter, "_send_frame", admitting)
    adapter._collect_reasoning(CHAT, "HEAD")
    assert (await recv(ws))["delta"] == "HEAD"
    assert (await recv(ws))["delta"] == "TAIL"


async def test_a_new_turn_keeps_none_of_the_last_turns_reasoning(client, adapter, monkeypatch):
    ws = await ready(client)
    send_frame = adapter._send_frame
    admitted: list[bool] = []

    async def admitting(chat_id, frame):
        if not admitted:
            admitted.append(True)
            adapter._collect_reasoning(chat_id, "TAIL")
        return await send_frame(chat_id, frame)

    monkeypatch.setattr(adapter, "_send_frame", admitting)
    adapter._collect_reasoning(CHAT, "HEAD")
    assert (await recv(ws))["delta"] == "HEAD"
    await adapter.on_processing_start(user_turn(adapter, "8"))
    assert adapter._reasoning_pending == {}
    assert adapter._reasoning_flushes == {}


def test_an_oversize_render_drops_its_reasoning_before_any_speech():
    segments = [{"cues": [], "speech": "x" * 1000} for _ in range(3)]
    frame = {"type": "render", "turn_id": "7", "segments": segments, "reasoning": "y" * MAX_FRAME_BYTES}
    fitted = json.loads(fit_frame(frame))
    assert "reasoning" not in fitted
    assert len(fitted["segments"]) == 3


def test_an_oversize_reasoning_frame_keeps_what_fits_of_its_delta():
    frame = {"type": "reasoning", "delta": "y" * (MAX_FRAME_BYTES * 2)}
    fitted = json.loads(fit_frame(frame))
    assert len(json.dumps(fitted, ensure_ascii=False).encode("utf-8")) <= MAX_FRAME_BYTES
    assert 0 < len(fitted["delta"]) < MAX_FRAME_BYTES * 2


def test_an_oversize_multibyte_reasoning_delta_is_cut_by_bytes_not_characters():
    frame = {"type": "reasoning", "delta": "안" * MAX_FRAME_BYTES}
    fitted = json.loads(fit_frame(frame))
    assert len(json.dumps(fitted, ensure_ascii=False).encode("utf-8")) <= MAX_FRAME_BYTES
    # Three bytes per character; the frame's own keys cost well under 64 bytes.
    assert len(fitted["delta"]) >= (MAX_FRAME_BYTES - 64) // 3
    assert set(fitted["delta"]) == {"안"}
