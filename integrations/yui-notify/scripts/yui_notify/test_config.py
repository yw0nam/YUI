import json

import pytest

from yui_notify.config import load

DEFAULTS = {"endpoint": "http://127.0.0.1:8770", "wait": {"stop": 600, "permission": 120}}


def write(tmp_path, text):
    (tmp_path / "yui-notify").mkdir()
    (tmp_path / "yui-notify" / "config.json").write_text(text)
    return {"XDG_CONFIG_HOME": str(tmp_path)}


def test_missing_file_gives_defaults(tmp_path):
    assert load({"XDG_CONFIG_HOME": str(tmp_path)}) == DEFAULTS


def test_partial_file_merges(tmp_path):
    env = write(tmp_path, json.dumps({"endpoint": "http://127.0.0.1:9/", "wait": {"stop": 30}}))
    assert load(env) == {"endpoint": "http://127.0.0.1:9", "wait": {"stop": 30, "permission": 120}}


@pytest.mark.parametrize("value", [0, 601, -1, True, "10", None])
def test_invalid_wait_falls_back(tmp_path, value):
    env = write(tmp_path, json.dumps({"wait": {"stop": value, "permission": value}}))
    assert load(env) == DEFAULTS


def test_invalid_json_gives_defaults(tmp_path):
    assert load(write(tmp_path, "{nope")) == DEFAULTS
