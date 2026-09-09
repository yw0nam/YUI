import json
import sqlite3
import threading
from datetime import timedelta
from pathlib import Path

import pytest
from conftest import AGENT_NAME

import act
import desire_state
import skill_usage

TICK_JOB_ID = "47f1361de4db"
OTHER_JOB_ID = "50b142a711ad"


def write_jobs(profile: Path) -> None:
    jobs = {
        "jobs": [
            {"id": OTHER_JOB_ID, "name": f"{AGENT_NAME}-desire-report"},
            {"id": TICK_JOB_ID, "name": f"{AGENT_NAME}-desire-tick"},
        ]
    }
    (profile / "cron").mkdir(parents=True, exist_ok=True)
    (profile / "cron" / "jobs.json").write_text(json.dumps(jobs), encoding="utf-8")


def write_skill(profile: Path, ref: str) -> None:
    directory = profile / "skills" / ref
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "SKILL.md").write_text("# skill\n", encoding="utf-8")


def write_usage(profile: Path, entries: dict) -> None:
    (profile / "skills").mkdir(parents=True, exist_ok=True)
    (profile / "skills" / ".usage.json").write_text(json.dumps(entries), encoding="utf-8")


def usage_entry(created_at: str, last_used_at: str | None = None, state: str = "active") -> dict:
    return {"created_at": created_at, "last_used_at": last_used_at, "state": state, "use_count": 1}


def write_state_db(profile: Path, views: list[tuple[str, float, list[str]]]) -> None:
    """Write a Hermes state database holding one assistant turn per `skill_view` group."""

    connection = sqlite3.connect(profile / "state.db")
    connection.execute(
        "CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, content TEXT, "
        "tool_calls TEXT, tool_name TEXT, timestamp REAL)"
    )
    connection.execute("CREATE TABLE sessions (id TEXT PRIMARY KEY, source TEXT, started_at REAL)")
    for session_id, timestamp, names in views:
        calls = [
            {"type": "function", "function": {"name": "skill_view", "arguments": json.dumps({"name": name})}}
            for name in names
        ]
        connection.execute(
            "INSERT INTO messages (session_id, role, tool_calls, timestamp) VALUES (?, 'assistant', ?, ?)",
            (session_id, json.dumps(calls), timestamp),
        )
        connection.execute(
            "INSERT OR IGNORE INTO sessions (id, source, started_at) VALUES (?, 'cron', ?)",
            (session_id, timestamp),
        )
    connection.commit()
    connection.close()


def tick_session(stamp: str = "20260909_075300") -> str:
    return f"cron_{TICK_JOB_ID}_{stamp}"


def other_session(stamp: str = "20260909_210000") -> str:
    return f"cron_{OTHER_JOB_ID}_{stamp}"


@pytest.fixture
def profile(isolated_profile) -> Path:
    root = desire_state.profile_root()
    root.mkdir(parents=True, exist_ok=True)
    write_jobs(root)
    (root / "skills").mkdir(parents=True, exist_ok=True)
    return root


def audited(state_dir: Path, event: str) -> list[dict]:
    lines = (state_dir / "audit.jsonl").read_text(encoding="utf-8").splitlines()
    return [value for value in (json.loads(line) for line in lines if line) if value["event"] == event]


def test_loads_split_by_session_kind_though_both_sessions_are_cron(profile, at):
    now = at("2026-09-09T21:00:00+09:00")
    write_skill(profile, "mcp/tick-operations")
    write_usage(
        profile,
        {"tick-operations": usage_entry("2026-09-07T06:52:18+00:00", "2026-09-09T08:53:16+00:00")},
    )
    write_state_db(
        profile,
        [
            (tick_session(), (now - timedelta(hours=2)).timestamp(), ["tick-operations", "tick-operations"]),
            (other_session(), (now - timedelta(hours=3)).timestamp(), ["tick-operations"]),
        ],
    )
    connection = sqlite3.connect(profile / "state.db")
    assert {row[0] for row in connection.execute("SELECT source FROM sessions")} == {"cron"}
    connection.close()

    text, failure = skill_usage.section(now, first_seen={"mcp/tick-operations": "2026-09-07T15:52:18+09:00"})

    assert failure is None
    assert text == (
        "skills you made (7 days):\n- mcp/tick-operations — tick 2, other 1, last used 2026-09-09 17:53"
    )


def test_load_matches_the_name_with_or_without_its_category_prefix(profile, at):
    now = at("2026-09-09T21:00:00+09:00")
    write_skill(profile, "mcp/presence")
    write_usage(profile, {"presence": usage_entry("2026-09-08T00:00:00+00:00", "2026-09-08T00:00:00+00:00")})
    write_state_db(
        profile,
        [
            (tick_session(), (now - timedelta(hours=1)).timestamp(), ["presence"]),
            (other_session(), (now - timedelta(hours=1)).timestamp(), ["mcp/presence"]),
        ],
    )

    text, failure = skill_usage.section(now, first_seen={"mcp/presence": "2026-09-08T09:00:00+09:00"})

    assert failure is None
    assert text.splitlines()[1].startswith("- mcp/presence — tick 1, other 1, ")


def test_loads_older_than_seven_days_are_not_counted(profile, at):
    now = at("2026-09-09T21:00:00+09:00")
    write_skill(profile, "mcp/presence")
    write_usage(profile, {"presence": usage_entry("2026-09-08T00:00:00+00:00")})
    write_state_db(
        profile,
        [
            (other_session(), (now - timedelta(days=7, minutes=1)).timestamp(), ["presence"]),
            (other_session("20260903_210000"), (now - timedelta(days=6)).timestamp(), ["presence"]),
        ],
    )

    text, _ = skill_usage.section(now, first_seen={"mcp/presence": "2026-09-08T09:00:00+09:00"})

    assert text.splitlines()[1] == "- mcp/presence — tick 0, other 1, last used never"


def test_a_skill_seen_at_bootstrap_is_not_listed(profile, at):
    now = at("2026-09-09T21:00:00+09:00")
    write_skill(profile, "mcp/pre-existing")
    write_usage(profile, {"pre-existing": usage_entry("2026-06-07T08:55:53+00:00")})
    write_state_db(profile, [])

    assert skill_usage.section(now, first_seen={}) == ("skills you made (7 days): none yet", None)


@pytest.mark.parametrize(
    ("created_at", "verdict"),
    [
        ("2026-08-27T21:00:00+09:00", ""),
        ("2026-08-26T21:00:01+09:00", ""),
        ("2026-08-26T21:00:00+09:00", " — unused: archive it or say why it stays"),
    ],
)
def test_the_unused_verdict_starts_at_fourteen_days_old(profile, at, created_at, verdict):
    now = at("2026-09-09T21:00:00+09:00")
    write_skill(profile, "mcp/quiet")
    write_usage(profile, {"quiet": usage_entry(created_at)})
    write_state_db(profile, [(tick_session(), (now - timedelta(hours=1)).timestamp(), ["quiet"])])

    text, _ = skill_usage.section(now, first_seen={"mcp/quiet": created_at})

    assert text.splitlines()[1] == f"- mcp/quiet — tick 1, other 0, last used never{verdict}"


def test_one_non_tick_load_clears_the_unused_verdict(profile, at):
    now = at("2026-09-09T21:00:00+09:00")
    created_at = "2026-08-01T00:00:00+09:00"
    write_skill(profile, "mcp/quiet")
    write_usage(profile, {"quiet": usage_entry(created_at)})
    write_state_db(profile, [(other_session(), (now - timedelta(days=6)).timestamp(), ["quiet"])])

    text, _ = skill_usage.section(now, first_seen={"mcp/quiet": created_at})

    assert text.splitlines()[1] == "- mcp/quiet — tick 0, other 1, last used never"


def test_an_archived_skill_leaves_the_section(profile, at):
    now = at("2026-09-09T21:00:00+09:00")
    write_skill(profile, "mcp/retired")
    write_usage(profile, {"retired": usage_entry("2026-08-01T00:00:00+09:00", state="archived")})
    write_state_db(profile, [])

    assert skill_usage.section(now, first_seen={"mcp/retired": "2026-08-01T00:00:00+09:00"})[0] == (
        "skills you made (7 days): none yet"
    )


def test_a_deleted_skill_directory_leaves_the_section(profile, at):
    now = at("2026-09-09T21:00:00+09:00")
    write_usage(profile, {"gone": usage_entry("2026-08-01T00:00:00+09:00")})
    write_state_db(profile, [])

    assert skill_usage.section(now, first_seen={"mcp/gone": "2026-08-01T00:00:00+09:00"})[0] == (
        "skills you made (7 days): none yet"
    )


def test_an_unreadable_database_renders_loads_unavailable_without_a_verdict(profile, at):
    now = at("2026-09-09T21:00:00+09:00")
    write_skill(profile, "mcp/quiet")
    write_usage(profile, {"quiet": usage_entry("2026-08-01T00:00:00+09:00", "2026-09-07T21:51:34+00:00")})

    text, failure = skill_usage.section(now, first_seen={"mcp/quiet": "2026-08-01T00:00:00+09:00"})

    assert failure is not None
    assert text == "skills you made (7 days):\n- mcp/quiet — loads unavailable, last used 2026-09-08 06:51"


def test_a_missing_tick_job_renders_loads_unavailable_and_names_the_reason(profile, at):
    now = at("2026-09-09T21:00:00+09:00")
    (profile / "cron" / "jobs.json").write_text(json.dumps({"jobs": []}), encoding="utf-8")
    write_skill(profile, "mcp/quiet")
    write_usage(profile, {"quiet": usage_entry("2026-08-01T00:00:00+09:00")})
    write_state_db(profile, [])

    text, failure = skill_usage.section(now, first_seen={"mcp/quiet": "2026-08-01T00:00:00+09:00"})

    assert f"{AGENT_NAME}-desire-tick" in failure
    assert text.splitlines()[1] == "- mcp/quiet — loads unavailable, last used never"


def test_a_tool_call_carrying_its_arguments_as_an_object_still_counts(profile, at):
    now = at("2026-09-09T21:00:00+09:00")
    write_skill(profile, "mcp/quiet")
    write_usage(profile, {"quiet": usage_entry("2026-08-01T00:00:00+09:00")})
    write_state_db(profile, [])
    call = {"type": "function", "function": {"name": "skill_view", "arguments": {"name": "quiet"}}}
    connection = sqlite3.connect(profile / "state.db")
    connection.execute(
        "INSERT INTO messages (session_id, role, tool_calls, timestamp) VALUES (?, 'assistant', ?, ?)",
        (other_session(), json.dumps([call]), (now - timedelta(hours=1)).timestamp()),
    )
    connection.commit()
    connection.close()

    text, _ = skill_usage.section(now, first_seen={"mcp/quiet": "2026-08-01T00:00:00+09:00"})

    assert text.splitlines()[1] == "- mcp/quiet — tick 0, other 1, last used never"


def test_an_unreadable_last_used_stamp_renders_unknown_and_withholds_the_verdict(profile, at):
    now = at("2026-09-09T21:00:00+09:00")
    write_skill(profile, "mcp/quiet")
    write_usage(profile, {"quiet": usage_entry("2026-08-01 midnight", "2026-08-01 midnight")})
    write_state_db(profile, [])

    text, _ = skill_usage.section(now, first_seen={"mcp/quiet": "2026-08-01 midnight"})

    assert text.splitlines()[1] == "- mcp/quiet — tick 0, other 0, last used unknown"


def test_the_state_lock_is_free_while_the_loads_are_counted(profile, state_dir, at, monkeypatch):
    now = at("2026-09-09T21:00:00+09:00")
    desire_state.bootstrap(now)
    record = desire_state.default_artefacts(now)
    record["skill_first_seen"] = {"mcp/quiet": "2026-09-08T09:00:00+09:00"}
    desire_state.write_json_atomic(state_dir / "artefacts.json", record)
    write_skill(profile, "mcp/quiet")
    write_state_db(profile, [])
    original = skill_usage.section

    def probe_lock(*args, **kwargs):
        taken = []

        def take():
            with desire_state.state_lock(state_dir):
                taken.append(True)

        worker = threading.Thread(target=take, daemon=True)
        worker.start()
        worker.join(timeout=5)
        assert taken, "the report step held the state lock while counting loads"
        return original(*args, **kwargs)

    monkeypatch.setattr(skill_usage, "section", probe_lock)

    assert act.main(["report", "--skills"], now=now) == 0


def test_a_skill_without_a_usage_entry_is_aged_from_its_first_sight(profile, at):
    now = at("2026-09-09T21:00:00+09:00")
    write_skill(profile, "mcp/unseen")
    write_state_db(profile, [])

    text, _ = skill_usage.section(now, first_seen={"mcp/unseen": "2026-08-01T00:00:00+09:00"})

    assert text.splitlines()[1] == (
        "- mcp/unseen — tick 0, other 0, last used never — unused: archive it or say why it stays"
    )


def test_report_skills_prints_the_section_and_delivers_nothing(profile, state_dir, at, capsys):
    now = at("2026-09-09T21:00:00+09:00")
    desire_state.bootstrap(now)
    record = desire_state.default_artefacts(now)
    record["skill_first_seen"] = {"mcp/quiet": "2026-09-08T09:00:00+09:00"}
    desire_state.write_json_atomic(state_dir / "artefacts.json", record)
    write_skill(profile, "mcp/quiet")
    write_usage(profile, {"quiet": usage_entry("2026-09-08T00:00:00+00:00")})
    write_state_db(profile, [(tick_session(), (now - timedelta(hours=1)).timestamp(), ["quiet"])])

    def opener(request, timeout):
        raise AssertionError("the skills section is rendered locally")

    assert act.main(["report", "--skills"], now=now, opener=opener) == 0
    assert capsys.readouterr().out == (
        "skills you made (7 days):\n- mcp/quiet — tick 1, other 0, last used never\n"
    )


def test_report_skills_audits_a_failed_load_count(profile, state_dir, at, capsys):
    now = at("2026-09-09T21:00:00+09:00")
    desire_state.bootstrap(now)
    record = desire_state.default_artefacts(now)
    record["skill_first_seen"] = {"mcp/quiet": "2026-09-08T09:00:00+09:00"}
    desire_state.write_json_atomic(state_dir / "artefacts.json", record)
    write_skill(profile, "mcp/quiet")

    assert act.main(["report", "--skills"], now=now) == 0
    assert "loads unavailable" in capsys.readouterr().out
    assert len(audited(state_dir, "report_skills_failed")) == 1


def test_report_note_still_delivers(profile, state_dir, at):
    now = at("2026-09-09T21:00:00+09:00")
    sent = []

    class Response:
        status = 204

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    def opener(request, timeout):
        sent.append(json.loads(request.data))
        return Response()

    assert act.main(["report", "--note", "today I opened one issue"], now=now, opener=opener) == 0
    assert sent[0]["signals"] == [{"kind": "report", "note": "today I opened one issue"}]
