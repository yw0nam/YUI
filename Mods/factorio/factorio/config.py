"""Mod config from config.toml plus the RCON settings inside the game's config.ini."""

import os
import tomllib
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

CONFIG_PATH_ENV = "FACTORIO_CONFIG_TOML"
DEFAULT_CONFIG_PATH = Path(__file__).resolve().parents[1] / "config.toml"
DEFAULT_CONFIG_INI = "~/Library/Application Support/factorio/config/config.ini"
DEFAULT_SIGNALS_URL = "http://127.0.0.1:8770/signals"
DEFAULT_COALESCE_MS = 2000
DOORBELL_TIMEOUT_S = 10.0
POLL_RETRY_DELAY_S = 5.0
DEFAULT_WAKE_KINDS = (
    "chat",
    "job_done",
    "job_failed",
    "body_died",
    "body_damaged",
    "research_finished",
    "rocket_launched",
    "player_died",
    "attack_started",
    "attack_ended",
)


ConfigErrorCode = Literal["rcon_not_configured"]


class ConfigError(RuntimeError):
    """The Mod cannot build its RCON target from the files it was given."""

    def __init__(self, code: ConfigErrorCode, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class Config:
    rcon_host: str
    rcon_port: int
    rcon_password: str
    signals_url: str
    wake_kinds: tuple[str, ...]
    coalesce_ms: int
    outcome_log: str


def load_config(path: str | Path | None = None) -> Config:
    """Read config.toml (or the env override) and the RCON keys in config.ini."""
    config_path = Path(path or os.getenv(CONFIG_PATH_ENV) or DEFAULT_CONFIG_PATH).expanduser()
    values = tomllib.loads(config_path.read_text()) if config_path.exists() else {}

    ini_path = Path(values.get("config_ini", DEFAULT_CONFIG_INI)).expanduser()
    host, port, password = _read_rcon_ini(ini_path)

    wake = values.get("wake", {})
    return Config(
        rcon_host=host,
        rcon_port=port,
        rcon_password=password,
        signals_url=str(values.get("signals_url", DEFAULT_SIGNALS_URL)),
        wake_kinds=tuple(wake.get("kinds", DEFAULT_WAKE_KINDS)),
        coalesce_ms=int(wake.get("coalesce_ms", DEFAULT_COALESCE_MS)),
        outcome_log=str(config_path.parent / values.get("outcome_log", "outcome.jsonl")),
    )


def _read_rcon_ini(path: Path) -> tuple[str, int, str]:
    if not path.exists():
        raise ConfigError("rcon_not_configured", f"{path} does not exist")
    values: dict[str, str] = {}
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith(";"):
            continue
        key, separator, value = line.partition("=")
        if separator:
            values[key.strip()] = value.strip()

    socket = values.get("local-rcon-socket", "")
    password = values.get("local-rcon-password", "")
    if not socket or not password:
        raise ConfigError(
            "rcon_not_configured",
            f"set local-rcon-socket and local-rcon-password in {path}",
        )
    host, separator, port = socket.rpartition(":")
    if not separator or not port.isdigit():
        raise ConfigError("rcon_not_configured", f"local-rcon-socket in {path} is not host:port")
    return host or "127.0.0.1", int(port), password
