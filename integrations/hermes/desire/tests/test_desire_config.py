import importlib
import sys
import types

import pytest

import desire_config


def test_agent_name_is_required(monkeypatch):
    monkeypatch.delenv("DESIRE_AGENT_NAME", raising=False)
    with pytest.raises(desire_config.ConfigurationError, match="DESIRE_AGENT_NAME"):
        desire_config.agent_name()


def test_a_blank_agent_name_is_as_missing_as_an_absent_one(monkeypatch):
    monkeypatch.setenv("DESIRE_AGENT_NAME", "   ")
    with pytest.raises(desire_config.ConfigurationError, match="DESIRE_AGENT_NAME"):
        desire_config.agent_name()


@pytest.mark.parametrize("value", ["my agent", "Agent", "agent_two", "-agent", "agent/x"])
def test_an_agent_name_outside_the_slug_shape_is_refused(monkeypatch, value):
    monkeypatch.setenv("DESIRE_AGENT_NAME", value)
    with pytest.raises(desire_config.ConfigurationError, match="DESIRE_AGENT_NAME"):
        desire_config.agent_name()


@pytest.mark.parametrize("value", ["", "  ", " , "])
def test_the_chat_platforms_are_required(monkeypatch, value):
    monkeypatch.setenv("DESIRE_CHAT_PLATFORMS", value)
    with pytest.raises(desire_config.ConfigurationError, match="DESIRE_CHAT_PLATFORMS"):
        desire_config.chat_platforms()


def test_the_chat_platforms_are_read_as_a_list(monkeypatch):
    monkeypatch.setenv("DESIRE_CHAT_PLATFORMS", "Discord, slack ")
    assert desire_config.chat_platforms() == frozenset({"discord", "slack"})


def test_every_convention_derives_from_the_agent_name(monkeypatch):
    monkeypatch.setenv("DESIRE_AGENT_NAME", "demo")

    assert desire_config.agent_name() == "demo"
    assert desire_config.branch_prefix() == "demo/"
    assert desire_config.issue_marker() == "<!-- from-demo -->"
    assert desire_config.signal_source() == "demo-desire"
    assert desire_config.cron_job_name("tick") == "demo-desire-tick"


def test_state_dir_defaults_to_the_hermes_home(monkeypatch, tmp_path):
    monkeypatch.delenv("DESIRE_STATE_DIR", raising=False)
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    assert desire_config.resolve_state_dir() == tmp_path / "desire"

    monkeypatch.delenv("HERMES_HOME")
    monkeypatch.setenv("HOME", str(tmp_path))
    assert desire_config.resolve_state_dir() == tmp_path / ".hermes" / "desire"


def test_inside_hermes_settings_come_from_the_profile_scope_and_home(monkeypatch, tmp_path):
    scope = {
        "DESIRE_AGENT_NAME": "scoped",
        "DESIRE_CHAT_PLATFORMS": "Discord, slack",
        "YUI_SIGNALS_URL": "http://scoped.test/signals",
    }
    secret_scope = types.ModuleType("agent.secret_scope")
    secret_scope.get_secret = lambda name, default=None: scope.get(name, default)
    hermes_constants = types.ModuleType("hermes_constants")
    hermes_constants.get_hermes_home = lambda: tmp_path / "home"
    monkeypatch.setitem(sys.modules, "agent", types.ModuleType("agent"))
    monkeypatch.setitem(sys.modules, "agent.secret_scope", secret_scope)
    monkeypatch.setitem(sys.modules, "hermes_constants", hermes_constants)
    monkeypatch.delitem(sys.modules, "desire_config")
    scoped = importlib.import_module("desire_config")
    for name in (*scope, "DESIRE_STATE_DIR", "HERMES_PROFILE", "HERMES_HOME"):
        monkeypatch.delenv(name, raising=False)

    assert scoped.agent_name() == "scoped"
    assert scoped.chat_platforms() == frozenset({"discord", "slack"})
    assert scoped.signals_url() == "http://scoped.test/signals"
    assert scoped.resolve_state_dir() == tmp_path / "home" / "desire"

    scope["DESIRE_STATE_DIR"] = str(tmp_path / "state")
    assert scoped.resolve_state_dir() == tmp_path / "state"


def test_wake_day_rolls_at_nine_kst(at):
    assert desire_config.wake_day(at("2026-08-25T08:59:59+09:00")) == "2026-08-24"
    assert desire_config.wake_day(at("2026-08-25T09:00:00+09:00")) == "2026-08-25"
    assert desire_config.wake_day(at("2026-08-25T23:59:59+09:00")) == "2026-08-25"
    assert desire_config.wake_day(at("2026-08-26T00:30:00+09:00")) == "2026-08-25"
