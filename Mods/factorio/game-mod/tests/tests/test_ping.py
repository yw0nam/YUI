import json

import pytest
from conftest import load_module

ASCII_OVER_LIMIT = "a" * 61
HANGUL_OVER_LIMIT = "한" * 61
OVER_LIMIT = "text is 61 characters, over the 60-character limit"

STUB = """
PRINTED = {}
DEPS = {
  storage = { pings = {}, rpc_memory = {}, map_id = "m" },
  tick = 1000,
  from_json = JSON.decode,
  to_json = JSON.encode,
  print = function(text) PRINTED[#PRINTED + 1] = text end,
  ops = { ping = { fn = require("scripts.ops.ping").op, write = true } },
}
"""


@pytest.fixture
def rpc(lua):
    module = load_module(lua, "scripts.rpc")
    lua.execute(STUB)
    return module


def ping(lua, rpc, args):
    request = {"v": 1, "id": "p1", "op": "ping", "args": args, "map_id": "m"}
    rpc.dispatch(json.dumps(request, ensure_ascii=False), None, lua.globals().DEPS)
    return json.loads(list(lua.globals().PRINTED.values())[-1])


@pytest.mark.parametrize(
    ("args", "error", "message"),
    [
        ({"pos": {"x": 0, "y": 0}, "text": ASCII_OVER_LIMIT}, "too_long", OVER_LIMIT),
        ({"pos": {"x": 0, "y": 0}, "text": HANGUL_OVER_LIMIT}, "too_long", OVER_LIMIT),
        (
            {"pos": {"x": 0, "y": 0}, "text": 7},
            "bad_request",
            "text must be a non-empty string of valid UTF-8",
        ),
        ({"text": "a" * 60}, "op_error", "ping: pos must be {x, y}"),
    ],
)
def test_ping_refuses_bad_arguments_before_touching_the_map(lua, rpc, args, error, message):
    assert ping(lua, rpc, args) == {"v": 1, "id": "p1", "ok": False, "e": error, "m": message}
