import json

import pytest

from yui_notify.config import load

DEFAULTS = {"endpoint": "http://127.0.0.1:8770"}


def write(tmp_path, text):
    (tmp_path / "yui-notify").mkdir()
    (tmp_path / "yui-notify" / "config.json").write_text(text)
    return {"XDG_CONFIG_HOME": str(tmp_path)}


def test_missing_file_gives_defaults(tmp_path):
    assert load({"XDG_CONFIG_HOME": str(tmp_path)}) == DEFAULTS


def test_endpoint_is_read(tmp_path):
    env = write(tmp_path, json.dumps({"endpoint": "http://127.0.0.1:9"}))
    assert load(env) == {"endpoint": "http://127.0.0.1:9"}


def test_invalid_json_gives_defaults(tmp_path):
    assert load(write(tmp_path, "{nope")) == DEFAULTS


@pytest.mark.parametrize("path", ["/presets/demo", "/threads", "/"])
def test_endpoint_path_falls_back(tmp_path, path):
    env = write(tmp_path, json.dumps({"endpoint": "http://127.0.0.1:9" + path}))
    assert load(env) == DEFAULTS
