"""Clock, agent identity from the profile settings, and state-directory paths for yui-desire."""

from __future__ import annotations

import logging
import os
import re
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

KST = ZoneInfo("Asia/Seoul")
logger = logging.getLogger(__name__)
DEFAULT_SIGNALS_URL = "http://127.0.0.1:8770/signals"


def normalize_now(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("datetime must be timezone-aware")
    return value.astimezone(KST)


def parse_timestamp(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    return normalize_now(parsed)


_AGENT_SLUG = re.compile(r"[a-z0-9][a-z0-9-]*")


class ConfigurationError(RuntimeError):
    """A value the deployment must set is missing."""


def _missing(name: str) -> ConfigurationError:
    return ConfigurationError(f"{name} is not set; export it in the Hermes profile environment")


try:
    from agent.secret_scope import get_secret as _setting
    from hermes_constants import get_hermes_home as _profile_dir
except ImportError:
    # A script outside the Hermes interpreter reads what Hermes exports to it.
    _setting = os.environ.get

    def _profile_dir() -> Path:
        return Path(os.environ.get("HERMES_HOME", "").strip() or "~/.hermes").expanduser()


def _required(name: str) -> str:
    value = _setting(name, "").strip()
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

    listed = _setting("DESIRE_CHAT_PLATFORMS", "").split(",")
    names = frozenset(name.strip().lower() for name in listed if name.strip())
    if not names:
        raise _missing("DESIRE_CHAT_PLATFORMS")
    return names


def profile_root() -> Path:
    """Return the Hermes profile directory the desire system belongs to."""

    return _profile_dir()


def signals_url() -> str:
    return _setting("YUI_SIGNALS_URL") or DEFAULT_SIGNALS_URL


def resolve_state_dir() -> Path:
    configured = _setting("DESIRE_STATE_DIR")
    if configured:
        return Path(configured).expanduser()
    state_dir = profile_root() / "desire"
    _report_left_behind(state_dir)
    return state_dir


_left_behind_reported = False


def _report_left_behind(state_dir: Path) -> None:
    """Warn once when the v0.4.0 default state directory exists and is not the one in use."""

    global _left_behind_reported
    profile = (_setting("HERMES_PROFILE") or "").strip()
    if _left_behind_reported or not profile:
        return
    left = Path.home() / ".hermes" / "profiles" / profile / "desire"
    if left == state_dir or not left.is_dir():
        return
    _left_behind_reported = True
    logger.warning(
        "DESIRE_STATE_DIR is not set: state is read from %s, and %s is left unread. "
        "Set DESIRE_STATE_DIR to keep using it.",
        state_dir,
        left,
    )
