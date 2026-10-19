import json

import pytest
from conftest import load_module

TOO_LONG = "ping: text must be 1 to 60 characters of valid UTF-8"

STUB = """
PRINTED = {}
DEPS = {
  storage = { pings = {}, rpc_memory = {}, map_id = "m" },
  tick = 1000,
  from_json = JSON.decode,
  to_json = JSON.encode,
  print = function(text) PRINTED[#PRINTED + 1] = text end,
  ops = { ping = require("scripts.ops.ping").op },
}
"""


@pytest.fixture
def rpc(lua):
    module = load_module(lua, "scripts.rpc")
    lua.execute(STUB)
    return module


def ping(lua, rpc, args):
    rpc.dispatch(
        json.dumps({"v": 1, "id": "p1", "op": "ping", "args": args, "map_id": "m"}, ensure_ascii=False),
        None,
        lua.globals().DEPS,
    )
    return json.loads(list(lua.globals().PRINTED.values())[-1])


@pytest.mark.parametrize(
    ("args", "message"),
    [
        ({"pos": {"x": 0, "y": 0}, "text": "a" * 61}, TOO_LONG),
        ({"pos": {"x": 0, "y": 0}, "text": "한" * 61}, TOO_LONG),
        ({"pos": {"x": 0, "y": 0}, "text": 7}, TOO_LONG),
        ({"text": "a" * 60}, "ping: pos must be {x, y}"),
    ],
)
def test_ping_refuses_bad_arguments_before_touching_the_map(lua, rpc, args, message):
    reply = ping(lua, rpc, args)
    assert reply["e"] == "op_error"
    assert reply["m"].endswith(message)
