import json
from pathlib import Path

import lupa.lua52 as lupa52
import pytest

FIXTURES = Path(__file__).parent / "fixtures"
GAME_MOD = Path(__file__).parents[2]


def lua_runtime():
    lua = lupa52.LuaRuntime(unpack_returned_tuples=True)
    lua.execute(f'package.path = "{GAME_MOD / "coop-agent"}/?.lua;" .. package.path')
    lua.execute(f'JSON = dofile("{FIXTURES / "json.lua"}")')
    return lua


def load_module(lua, name: str):
    loaded = lua.execute(f'return require("{name}")')
    # require yields (module, source) under unpack_returned_tuples
    return loaded[0] if isinstance(loaded, tuple) else loaded


@pytest.fixture
def lua():
    return lua_runtime()


@pytest.fixture
def world(lua):
    """The fake world of fixtures/world.lua, as the Lua globals."""
    lua.execute(f'dofile("{FIXTURES / "world.lua"}")')
    return lua.globals()


def rpc(world, op, args, id_="t"):
    """One /coop-rpc call in the fake world; its decoded reply."""
    request = {"v": 1, "id": id_, "op": op, "args": args, "map_id": "m"}
    world.RPC.dispatch(json.dumps(request), None, world.DEPS)
    return json.loads(list(world.PRINTED.values())[-1])


def run(world, n):
    """n ticks of the job runner."""
    world.step(n, world.JOBS.tick)


def events(world):
    """The pushed events, with an empty data table left out."""
    out = []
    for event in world.EVENTS.values():
        data = json.loads(world.JSON.encode(event.data))
        out.append({"kind": event.kind, "data": data} if data else {"kind": event.kind})
    return out


def pytest_addoption(parser):
    parser.addoption("--factorio-bin", default=None, help="Factorio binary for the headless integration test")
