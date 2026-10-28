import json

import pytest
from conftest import load_module

HANGUL_70_CHARS_IN_210_BYTES = "나무위키" * 17 + "한글"
ASCII_AT_LIMIT = "a" * 200
ASCII_OVER_LIMIT = "a" * 201
HANGUL_OVER_LIMIT = "한" * 201
BAD_TEXT = "text must be a non-empty string of valid UTF-8"

STUB = """
PRINTED = {}
SAID = {}
DEPS = {
  storage = { say_ticks = {}, rpc_memory = {}, map_id = "m" },
  tick = 1000,
  body_name = "Buddy",
  from_json = JSON.decode,
  to_json = JSON.encode,
  print = function(text) PRINTED[#PRINTED + 1] = text end,
  chat = function(line) SAID[#SAID + 1] = line end,
  ops = { say = { fn = require("scripts.ops.say").op, write = true } },
}
"""


@pytest.fixture
def rpc(lua):
    module = load_module(lua, "scripts.rpc")
    lua.execute(STUB)
    lua.globals().RPC = module
    return module


def send(lua, rpc, text, id_="t1"):
    request = {"v": 1, "id": id_, "op": "say", "args": {"text": text}, "map_id": "m"}
    rpc.dispatch(json.dumps(request, ensure_ascii=False), None, lua.globals().DEPS)


def last_reply(lua):
    return json.loads(list(lua.globals().PRINTED.values())[-1])


def said(lua):
    return list(lua.globals().SAID.values())


@pytest.mark.parametrize("text", [HANGUL_70_CHARS_IN_210_BYTES, ASCII_AT_LIMIT])
def test_say_speaks_up_to_200_characters_with_the_body_name(lua, rpc, text):
    send(lua, rpc, text)
    assert said(lua) == ["Buddy: " + text]


@pytest.mark.parametrize(
    ("text", "error", "message"),
    [
        (ASCII_OVER_LIMIT, "too_long", "text is 201 characters, over the 200-character limit"),
        (HANGUL_OVER_LIMIT, "too_long", "text is 201 characters, over the 200-character limit"),
        ("", "bad_request", BAD_TEXT),
        (7, "bad_request", BAD_TEXT),
    ],
)
def test_say_refuses_text_it_cannot_speak(lua, rpc, text, error, message):
    send(lua, rpc, text)
    assert said(lua) == []
    assert last_reply(lua) == {"v": 1, "id": "t1", "ok": False, "e": error, "m": message}


def test_say_refuses_bytes_that_are_not_utf8(lua, rpc):
    # the raw 0xFF byte stays inside Lua, so it never crosses into Python
    lua.execute(
        r"""RPC.dispatch('{"v":1,"id":"bad","op":"say","args":{"text":"\255\254"},"map_id":"m"}', nil, DEPS)"""
    )
    assert said(lua) == []
    assert last_reply(lua) == {"v": 1, "id": "bad", "ok": False, "e": "bad_request", "m": BAD_TEXT}


def test_say_answers_rate_limited_after_6_lines_in_60_s(lua, rpc):
    for i in range(7):
        send(lua, rpc, "hi", id_=f"s{i}")
    assert len(said(lua)) == 6
    assert last_reply(lua) == {
        "v": 1,
        "id": "s6",
        "ok": False,
        "e": "rate_limited",
        "m": "say allows at most 6 messages per 60 s",
    }
