import json

import pytest
from conftest import load_module

MAP_ID = "42-1234"

# OPS.say and OPS.ping are the write ops (rpc memoizes them); the rest re-run.
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
OPS.say = function(_deps, args)
  OPS.calls = OPS.calls + 1
  if args.refuse then
    return { ok = false, e = "rate_limited", m = "slow down" }
  end
  return { said = args.text }
end
OPS.ping = function(_deps, _args)
  OPS.calls = OPS.calls + 1
  error("the machine broke\\nwith a traceback")
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
          storage = {{ rpc_memory = {{}}, map_id = "{MAP_ID}" }},
          tick = 100,
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
    assert last_printed(lua) == {"v": 1, "id": "s1", "ok": True, "r": {"ok_status": True}}

    dispatch(lua, rpc, req("echo", {"text": "hi"}, id_="e1", map_id=None))
    assert last_printed(lua) == {
        "v": 1,
        "id": "e1",
        "ok": False,
        "e": "stale_session",
        "m": "map_id does not match this map",
    }

    dispatch(lua, rpc, req("echo", {"text": "hi"}, id_="e2"))
    assert last_printed(lua) == {"v": 1, "id": "e2", "ok": True, "r": {"said": "hi"}}


def test_read_ops_rerun_on_retry(lua, rpc):
    request = req("echo", {"text": "hi"}, id_="a1")
    dispatch(lua, rpc, request)
    dispatch(lua, rpc, request)
    assert lua.globals().OPS.calls == 2


def test_write_op_replays_the_stored_reply(lua, rpc):
    request = req("say", {"text": "hi"}, id_="a1")
    dispatch(lua, rpc, request)
    first = last_printed(lua)
    dispatch(lua, rpc, request)
    second = last_printed(lua)

    assert first == second == {"v": 1, "id": "a1", "ok": True, "r": {"said": "hi"}}
    assert lua.globals().OPS.calls == 1


def test_write_op_stores_refused_replies(lua, rpc):
    request = req("say", {"text": "hi", "refuse": True}, id_="a1")
    dispatch(lua, rpc, request)
    first = last_printed(lua)
    dispatch(lua, rpc, request)
    second = last_printed(lua)

    assert first == second == {"v": 1, "id": "a1", "ok": False, "e": "rate_limited", "m": "slow down"}
    assert lua.globals().OPS.calls == 1


def test_write_op_that_raises_reruns_on_retry(lua, rpc):
    request = req("ping", id_="p1")
    dispatch(lua, rpc, request)
    dispatch(lua, rpc, request)
    assert lua.globals().OPS.calls == 2
    assert last_printed(lua)["e"] == "op_error"


def test_same_id_with_different_args_is_id_conflict(lua, rpc):
    dispatch(lua, rpc, req("say", {"text": "hi"}, id_="a1"))
    dispatch(lua, rpc, req("say", {"text": "bye"}, id_="a1"))

    reply = last_printed(lua)
    assert reply == {
        "v": 1,
        "id": "a1",
        "ok": False,
        "e": "id_conflict",
        "m": "id already used with different arguments",
    }
    assert lua.globals().OPS.calls == 1


def test_memory_keeps_the_last_256_replies(lua, rpc):
    for i in range(257):
        dispatch(lua, rpc, req("say", {"text": str(i)}, id_=f"id-{i}"))

    assert len(list(lua.globals().DEPS.storage.rpc_memory[MAP_ID].values())) == 256

    dispatch(lua, rpc, req("say", {"text": "0"}, id_="id-0"))
    assert last_printed(lua) == {"v": 1, "id": "id-0", "ok": True, "r": {"said": "0"}}


def test_memory_buckets_exist_only_for_this_map(lua, rpc):
    dispatch(lua, rpc, req("say", {"text": "hi"}, id_="w1", map_id="other-map"))
    assert last_printed(lua)["e"] == "stale_session"
    assert len(list(lua.globals().DEPS.storage.rpc_memory.values())) == 0

    dispatch(lua, rpc, req("say", {"text": "hi"}, id_="w2"))
    assert list(lua.globals().DEPS.storage.rpc_memory.keys()) == [MAP_ID]


def test_op_error_carries_first_line(lua, rpc):
    dispatch(lua, rpc, req("boom", id_="b1"))
    reply = last_printed(lua)
    assert reply["v"] == 1
    assert reply["id"] == "b1"
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
