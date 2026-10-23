import json

from yui_notify.config import load

DEFAULTS = {
    "endpoint": "http://127.0.0.1:8770",
    "events": {"done": "batched", "needs_input": "urgent"},
}


def write(tmp_path, text):
    (tmp_path / "yui-notify").mkdir()
    (tmp_path / "yui-notify" / "config.json").write_text(text)
    return {"XDG_CONFIG_HOME": str(tmp_path)}


def test_missing_file_gives_defaults(tmp_path):
    assert load({"XDG_CONFIG_HOME": str(tmp_path)}) == DEFAULTS


def test_partial_file_merges(tmp_path):
    env = write(tmp_path, json.dumps({"endpoint": "http://127.0.0.1:9/", "events": {"done": "drop"}}))
    assert load(env) == {
        "endpoint": "http://127.0.0.1:9",
        "events": {"done": "drop", "needs_input": "urgent"},
    }


def test_invalid_event_value_falls_back(tmp_path):
    env = write(
        tmp_path, json.dumps({"events": {"done": "immediate", "needs_input": "batched"}, "summary": None})
    )
    assert load(env) == {
        "endpoint": "http://127.0.0.1:8770",
        "events": {"done": "batched", "needs_input": "batched"},
    }


def test_invalid_json_gives_defaults(tmp_path):
    assert load(write(tmp_path, "{nope")) == DEFAULTS
