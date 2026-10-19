import json

import pytest
from conftest import load_module

KOREAN_70 = "나무위키" * 17 + "한글"  # 70 characters, 280 UTF-8 bytes
ASCII_200 = "a" * 200
ASCII_201 = "a" * 201
KOREAN_201 = "한" * 201

STUB = """
PRINTED = {}
SAID = {}
DEPS = {
  storage = { say_ticks = {} },
  tick = 1000,
  body_name = "Buddy",
  print = function(text) PRINTED[#PRINTED + 1] = text end,
  say = function(line) SAID[#SAID + 1] = line end,
  ops = { say = require("scripts.ops.say").op },
}
"""


@pytest.fixture
def dispatch(lua):
    module = load_module(lua, "scripts.rpc")
    lua.execute(STUB)
    return module


def send(lua, dispatch, text, id_="t1"):
    request = json.dumps({"v": 1, "id": id_, "op": "say", "args": {"text": text}})
    dispatch.dispatch(request, None, lua.globals().DEPS)


def last_reply(lua):
    return json.loads(list(lua.globals().PRINTED.values())[-1])


def said(lua):
    return list(lua.globals().SAID.values())


def test_say_prefixes_the_body_name(lua, dispatch):
    send(lua, dispatch, "hello", id_="h1")
    assert said(lua) == ["Buddy: hello"]


@pytest.mark.parametrize("text", [KOREAN_70, ASCII_200])
def test_say_accepts_up_to_200_characters(lua, dispatch, text):
    assert len(text) <= 200
    send(lua, dispatch, text)
    assert said(lua) == ["Buddy: " + text]


@pytest.mark.parametrize(
    "text",
    [ASCII_201, KOREAN_201, ""],
)
def test_say_rejects_over_the_limit_text(lua, dispatch, text):
    send(lua, dispatch, text)
    reply = last_reply(lua)
    assert reply["ok"] is False
    assert reply["e"] == "op_error"
    assert "\n" not in reply["m"]
    assert reply["m"].endswith("say: text must be 1 to 200 characters of valid UTF-8")


def test_say_rejects_bytes_that_are_not_utf8(lua, dispatch):
    # a raw 0xFF byte is invalid UTF-8; build and dispatch the request inside
    # Lua so the byte never crosses into Python
    lua.globals().RPC = dispatch
    lua.execute(r"""req = '{"v":1,"id":"bad","op":"say","args":{"text":"\255\254"}}'""")
    lua.execute("RPC.dispatch(req, nil, DEPS)")
    assert last_reply(lua)["e"] == "op_error"
