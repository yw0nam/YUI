import json

import pytest
from conftest import load_module

ASCII_60 = "a" * 60
ASCII_61 = "a" * 61

STUB = """
DEPS = {
  storage = { pings = {} },
  tick = 1000,
  ops = { ping = require("scripts.ops.ping").op },
}
"""


@pytest.fixture
def dispatch(lua):
    module = load_module(lua, "scripts.rpc")
    lua.execute(STUB)
    return module


def ping(lua, dispatch, args, id_="t1"):
    request = json.dumps({"v": 1, "id": id_, "op": "ping", "args": args})
    dispatch.dispatch(request, None, lua.globals().DEPS)
    printed = lua.globals().PRINTED
    return json.loads(printed[len(list(printed.values()))])


def test_ping_rejects_text_over_60_characters(lua, dispatch):
    reply = ping(lua, dispatch, {"pos": {"x": 0, "y": 0}, "text": ASCII_61})
    assert reply["ok"] is False
    assert reply["e"] == "op_error"
    assert reply["m"].endswith("ping: text must be a string of 1 to 60 characters of valid UTF-8")


def test_ping_rejects_non_string_text(lua, dispatch):
    reply = ping(lua, dispatch, {"pos": {"x": 0, "y": 0}, "text": 7})
    assert reply["e"] == "op_error"
    assert reply["m"].endswith("ping: text must be a string of 1 to 60 characters of valid UTF-8")


def test_ping_rejects_a_missing_position(lua, dispatch):
    reply = ping(lua, dispatch, {"text": ASCII_60})
    assert reply["e"] == "op_error"
    assert reply["m"].endswith("ping: pos must be {x, y}")
