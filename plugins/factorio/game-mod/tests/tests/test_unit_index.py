import pytest
from conftest import load_module


@pytest.fixture
def index(lua):
    module = load_module(lua, "scripts.unit_index")
    lua.execute("storage = { unit_index = { map = {}, order = {} } }")
    return module


def add(lua, index, unit_number):
    entity = lua.table(unit_number=unit_number, valid=True)
    index.add(entity)
    return entity


def order(lua):
    return list(lua.globals().storage.unit_index.order.values())


def test_the_index_keeps_the_newest_4096_units(lua, index):
    for unit in range(1, 4098):
        add(lua, index, unit)
    add(lua, index, 2)  # re-adding keeps the unit's place

    assert order(lua) == list(range(2, 4098))
    assert index.get(1) is None
    assert index.get(4097).unit_number == 4097


def test_the_sweep_drops_invalid_entities(lua, index):
    dead = add(lua, index, 1)
    add(lua, index, 2)
    dead.valid = False

    assert index.get(1) is None
    index.sweep()
    assert order(lua) == [2]
    assert list(lua.globals().storage.unit_index.map.keys()) == [2]
