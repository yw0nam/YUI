import pytest
from conftest import load_module


@pytest.fixture
def map_id(lua):
    lua.execute(
        """
        game = { get_surface = function() return { map_gen_settings = { seed = SEED } } end }
        """
    )
    return load_module(lua, "scripts.map_id")


@pytest.mark.parametrize(
    ("seed", "tick", "expected"), [(42, 0, "42-0"), (7, 0, "7-0"), (42, 3600, "42-3600")]
)
def test_map_id_is_the_surface_seed_and_the_init_tick(lua, map_id, seed, tick, expected):
    lua.globals().SEED = seed
    storage = lua.table()
    map_id.ensure(storage, tick)
    assert storage.map_id == expected


def test_an_existing_map_id_is_kept(lua, map_id):
    lua.globals().SEED = 7
    storage = lua.table(map_id="42-0")
    map_id.ensure(storage, 99)
    assert storage.map_id == "42-0"
