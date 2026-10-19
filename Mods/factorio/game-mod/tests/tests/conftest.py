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


def pytest_addoption(parser):
    parser.addoption("--factorio-bin", default=None, help="Factorio binary for the headless integration test")
