"""Clock, agent identity from the environment, and state-directory paths for yui-desire."""

from __future__ import annotations

import os
import re
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

KST = ZoneInfo("Asia/Seoul")
DEFAULT_SIGNALS_URL = "http://127.0.0.1:8770/signals"


def normalize_now(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("datetime must be timezone-aware")
    return value.astimezone(KST)


def parse_timestamp(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    return normalize_now(parsed)


def wake_day(now: datetime) -> str:
    """Return the KST day the tick belongs to; the day rolls at 09:00."""

    return (normalize_now(now) - timedelta(hours=9)).date().isoformat()


_AGENT_SLUG = re.compile(r"[a-z0-9][a-z0-9-]*")


class ConfigurationError(RuntimeError):
    """A value the deployment must set is missing."""


def _missing(name: str) -> ConfigurationError:
    return ConfigurationError(f"{name} is not set; export it in the Hermes profile environment")


def _required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise _missing(name)
    return value


def agent_name() -> str:
    """Return the slug naming this agent, which every desire convention derives from."""

    value = _required("DESIRE_AGENT_NAME")
    if _AGENT_SLUG.fullmatch(value) is None:
        raise ConfigurationError(
            "DESIRE_AGENT_NAME must be one slug of lowercase letters, digits, and hyphens"
        )
    return value


def hermes_profile() -> str:
    return _required("HERMES_PROFILE")


def branch_prefix() -> str:
    return f"{agent_name()}/"


def issue_marker() -> str:
    return f"<!-- from-{agent_name()} -->"


def signal_source() -> str:
    return f"{agent_name()}-desire"


def cron_job_name(kind: str) -> str:
    return f"{agent_name()}-desire-{kind}"


def chat_platforms() -> frozenset[str]:
    """Name the Hermes platforms whose turns are the user speaking to the agent."""

    listed = os.environ.get("DESIRE_CHAT_PLATFORMS", "").split(",")
    names = frozenset(name.strip().lower() for name in listed if name.strip())
    if not names:
        raise _missing("DESIRE_CHAT_PLATFORMS")
    return names


def profile_root() -> Path:
    """Return the Hermes profile directory the desire system belongs to."""

    return Path.home() / ".hermes" / "profiles" / hermes_profile()


def resolve_state_dir() -> Path:
    configured = os.environ.get("DESIRE_STATE_DIR")
    if configured:
        return Path(configured).expanduser()
    return profile_root() / "desire"
