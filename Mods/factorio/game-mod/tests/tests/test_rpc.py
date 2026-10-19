import json

import pytest
from conftest import load_module

MAP_ID = "42-1234"

STUB_OPS = """
OPS = {}
OPS.calls = 0
OPS.echo = function(_deps, args)
  OPS.calls = OPS.calls + 1
  return { said = args.text }
end
OPS.status = function(_deps, _args)
  OPS.calls = OPS.calls + 1
  return { ok_status = true }
end
OPS.boom = function(_deps, _args)
  OPS.calls = OPS.calls + 1
  error("the machine broke\\nwith a traceback")
end
OPS.big = function(_deps, args)
  return string.rep("a", args.size)
end
"""


def req(op, args=None, id_="t", map_id=MAP_ID):
    body = {"v": 1, "id": id_, "op": op, "args": args or {}}
    if map_id is not None:
        body["map_id"] = map_id
    return json.dumps(body)


@pytest.fixture
def rpc(lua):
    module = load_module(lua, "scripts.rpc")
    lua.execute(STUB_OPS)
    lua.execute("PRINTED = {}")
    lua.execute(
        f"""
        DEPS = {{
          from_json = JSON.decode,
          to_json = JSON.encode,
          print = function(text) PRINTED[#PRINTED + 1] = text end,
          storage = {{ rpc_memory = {{}} }},
          tick = 100,
          map_id = function() return "{MAP_ID}" end,
          ops = OPS,
        }}
        """
    )
    return module


def dispatch(lua, rpc, parameter, player_index=None):
    rpc.dispatch(parameter, player_index, lua.globals().DEPS)
    printed = lua.globals().PRINTED
    return [json.loads(text) for text in printed.values()]


def last_printed(lua):
    printed = lua.globals().PRINTED
    return json.loads(printed[len(list(printed.values()))])


def test_not_console_refuses_player_calls_and_runs_nothing(lua, rpc):
    replies = dispatch(lua, rpc, req("echo", {"text": "hi"}, id_="a1"), player_index=1)
    assert replies == [{"v": 1, "id": "a1", "ok": False, "e": "not_console"}]
    assert lua.globals().OPS.calls == 0


def test_bad_request_on_unparsable_json(lua, rpc):
    replies = dispatch(lua, rpc, "not json at all")
    assert replies == [
        {"v": 1, "id": None, "ok": False, "e": "bad_request", "m": "parameter must be one JSON object"}
    ]


def test_unknown_op(lua, rpc):
    dispatch(lua, rpc, req("nope", id_="a1"))
    assert last_printed(lua) == {"v": 1, "id": "a1", "ok": False, "e": "unknown_op", "m": "nope"}


def test_status_needs_no_map_id_and_other_ops_do(lua, rpc):
    dispatch(lua, rpc, req("status", id_="s1", map_id=None))
    assert last_printed(lua)["ok"] is True

    dispatch(lua, rpc, req("echo", {"text": "hi"}, id_="e1", map_id=None))
    assert last_printed(lua)["e"] == "stale_session"

    dispatch(lua, rpc, req("echo", {"text": "hi"}, id_="e2"))
    assert last_printed(lua) == {"v": 1, "id": "e2", "ok": True, "r": {"said": "hi"}}


def test_wrong_map_id_is_stale_session(lua, rpc):
    dispatch(lua, rpc, req("echo", id_="e1", map_id="other-map"))
    assert last_printed(lua)["e"] == "stale_session"


def test_op_error_carries_first_line(lua, rpc):
    dispatch(lua, rpc, req("boom", id_="b1"))
    reply = last_printed(lua)
    assert reply["ok"] is False
    assert reply["e"] == "op_error"
    # m keeps the first line of the Lua error, including the source prefix
    assert "\n" not in reply["m"]
    assert reply["m"].endswith("the machine broke")


def test_reply_at_exactly_65536_bytes_is_ok_and_65537_is_too_large(lua, rpc):
    def big_reply(size):
        # zero-padded ids: every probe gets a fresh id of constant length, so
        # the envelope overhead measured once applies to every probe
        dispatch(lua, rpc, req("big", {"size": size}, id_=f"big-{size:09d}"))
        printed = lua.globals().PRINTED
        text = printed[len(list(printed.values()))]
        return json.loads(text), len(text)

    _, overhead = big_reply(0)
    size_for_65536 = 65536 - overhead
    assert size_for_65536 > 0

    reply, reply_bytes = big_reply(size_for_65536)
    assert reply_bytes == 65536
    assert reply["ok"] is True

    reply, _ = big_reply(size_for_65536 + 1)
    assert reply["ok"] is False
    assert reply["e"] == "too_large"
    assert reply["r"] == {"bytes": 65537}


def test_same_id_and_hash_replays_the_stored_reply(lua, rpc):
    request = req("echo", {"text": "hi"}, id_="a1")
    dispatch(lua, rpc, request)
    first = last_printed(lua)
    dispatch(lua, rpc, request)
    second = last_printed(lua)

    assert first == second == {"v": 1, "id": "a1", "ok": True, "r": {"said": "hi"}}
    assert lua.globals().OPS.calls == 1


def test_same_id_with_different_args_is_id_conflict(lua, rpc):
    dispatch(lua, rpc, req("echo", {"text": "hi"}, id_="a1"))
    dispatch(lua, rpc, req("echo", {"text": "bye"}, id_="a1"))

    reply = last_printed(lua)
    assert reply["ok"] is False
    assert reply["e"] == "id_conflict"
    assert lua.globals().OPS.calls == 1


def test_memory_keeps_the_last_256_replies(lua, rpc):
    for i in range(257):
        dispatch(lua, rpc, req("echo", {"text": str(i)}, id_=f"id-{i}"))

    assert len(list(lua.globals().DEPS.storage.rpc_memory[MAP_ID].values())) == 256

    calls_before = lua.globals().OPS.calls
    dispatch(lua, rpc, req("echo", {"text": "0"}, id_="id-0"))
    assert lua.globals().OPS.calls == calls_before + 1


def test_errors_are_not_memoized(lua, rpc):
    dispatch(lua, rpc, req("boom", id_="b1"))
    dispatch(lua, rpc, req("boom", id_="b1"))
    assert lua.globals().OPS.calls == 2
