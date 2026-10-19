import json

import pytest
from conftest import load_module

KOREAN_70 = "나무위키" * 17 + "한글"  # 70 characters, 210 UTF-8 bytes
ASCII_200 = "a" * 200
ASCII_201 = "a" * 201
KOREAN_201 = "한" * 201
TOO_LONG = "say: text must be 1 to 200 characters of valid UTF-8"

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
  say = function(line) SAID[#SAID + 1] = line end,
  ops = { say = require("scripts.ops.say").op },
}
"""


@pytest.fixture
def rpc(lua):
    module = load_module(lua, "scripts.rpc")
    lua.execute(STUB)
    lua.globals().RPC = module
    return module


def send(lua, rpc, text, id_="t1"):
    rpc.dispatch(
        json.dumps(
            {"v": 1, "id": id_, "op": "say", "args": {"text": text}, "map_id": "m"}, ensure_ascii=False
        ),
        None,
        lua.globals().DEPS,
    )


def last_reply(lua):
    return json.loads(list(lua.globals().PRINTED.values())[-1])


def said(lua):
    return list(lua.globals().SAID.values())


@pytest.mark.parametrize("text", [KOREAN_70, ASCII_200])
def test_say_speaks_up_to_200_characters_with_the_body_name(lua, rpc, text):
    send(lua, rpc, text)
    assert said(lua) == ["Buddy: " + text]


@pytest.mark.parametrize("text", [ASCII_201, KOREAN_201, ""])
def test_say_refuses_text_outside_1_to_200_characters(lua, rpc, text):
    send(lua, rpc, text)
    assert said(lua) == []
    assert last_reply(lua)["m"].endswith(TOO_LONG)


def test_say_refuses_bytes_that_are_not_utf8(lua, rpc):
    # the raw 0xFF byte stays inside Lua, so it never crosses into Python
    lua.execute(
        r"""RPC.dispatch('{"v":1,"id":"bad","op":"say","args":{"text":"\255\254"},"map_id":"m"}', nil, DEPS)"""
    )
    assert said(lua) == []
    assert last_reply(lua)["m"].endswith(TOO_LONG)


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
