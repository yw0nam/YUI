"""config.toml and the game's config.ini: defaults, env override, rcon_not_configured."""

import pytest

from factorio.config import ConfigError, load_config

INI = """
[other]
; local-rcon-socket=127.0.0.1:34197
; local-rcon-password=poop
"""

INI_SET = """
[other]
local-rcon-socket=127.0.0.1:27015
local-rcon-password=secret
"""


def write(tmp_path, name: str, text: str):
    path = tmp_path / name
    path.write_text(text)
    return path


def test_reads_rcon_from_the_game_config_and_applies_defaults(tmp_path):
    ini = write(tmp_path, "config.ini", INI_SET)
    toml = write(tmp_path, "config.toml", f'config_ini = "{ini}"\n')
    config = load_config(toml)
    assert (config.rcon_host, config.rcon_port, config.rcon_password) == ("127.0.0.1", 27015, "secret")
    assert config.signals_url == "http://127.0.0.1:8770/signals"
    assert config.coalesce_ms == 2000
    assert config.wake_kinds[0] == "chat"
    assert config.outcome_log == str(tmp_path / "outcome.jsonl")


def test_the_env_var_overrides_the_config_path(tmp_path, monkeypatch):
    ini = write(tmp_path, "config.ini", INI_SET)
    toml = write(tmp_path, "elsewhere.toml", f'config_ini = "{ini}"\n')
    monkeypatch.setenv("FACTORIO_CONFIG_TOML", str(toml))
    assert load_config().rcon_port == 27015


def test_commented_rcon_keys_report_rcon_not_configured(tmp_path):
    ini = write(tmp_path, "config.ini", INI)
    toml = write(tmp_path, "config.toml", f'config_ini = "{ini}"\n')
    with pytest.raises(ConfigError) as raised:
        load_config(toml)
    assert raised.value.code == "rcon_not_configured"
