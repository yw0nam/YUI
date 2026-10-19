import pytest
from conftest import load_module


@pytest.fixture
def store(lua):
    module = load_module(lua, "scripts.storage")
    lua.execute("storage = {}")
    module.ensure()
    return module


def test_ensure_creates_every_table(lua, store):
    storage = lua.globals().storage
    for name in ("events", "rpc_memory", "attacks", "say_ticks", "pings", "unit_index"):
        assert storage[name] is not None


def test_index_unit_tracks_order_and_updates_in_place(lua, store):
    for unit in (1, 2, 3):
        store.index_unit(unit, "gun-turret", "nauvis", unit, 0)
    index = lua.globals().storage.unit_index
    assert len(list(index.order.values())) == 3
    assert sorted(int(k) for k in index.map.keys())  # noqa: SIM118 -- lupa table == [1, 2, 3]

    store.index_unit(1, "gun-turret", "nauvis", 9, 9)
    assert len(list(index.order.values())) == 3  # re-indexing does not grow the order
    assert int(lua.globals().storage.unit_index.map[1].x) == 9


def test_index_unit_caps_at_4096_and_drops_the_oldest(lua, store):
    for unit in range(1, 4098):
        store.index_unit(unit, "gun-turret", "nauvis", unit, 0)
    index = lua.globals().storage.unit_index
    assert len(list(index.order.values())) == 4096
    assert index.map[1] is None  # the oldest entry is gone
    assert index.map[4097] is not None


def test_prune_index_drops_entries_the_lookup_calls_dead(lua, store):
    for unit in (1, 2, 3):
        store.index_unit(unit, "gun-turret", "nauvis", unit, 0)

    alive = {2, 3}
    store.prune_index(lambda unit_number, info: int(unit_number) in alive)

    index = lua.globals().storage.unit_index
    assert sorted(int(k) for k in index.map.keys())  # noqa: SIM118 -- lupa table == [2, 3]
