import json
import shutil
import socket
import threading
from datetime import timedelta
from pathlib import Path

import pytest
from conftest import AGENT_NAME

import desire_config
import desire_events
import desire_state
import desire_store
import gate

BRANCH = f"{AGENT_NAME}/"
MARKER = f"<!-- from-{AGENT_NAME} -->"
NO_WAKE = '{"wakeAgent": false}\n'


@pytest.fixture
def transport_up(monkeypatch):
    monkeypatch.setattr(gate, "probe_transport", lambda: True)


def audited(state_dir: Path, event: str) -> list[dict]:
    return [
        value for value in desire_store.read_jsonl(state_dir / "audit.jsonl") if value.get("event") == event
    ]


def event_line(event_id, at, fact, source="monitor", source_ref=None):
    return {"id": event_id, "at": at.isoformat(), "fact": fact, "source": source, "source_ref": source_ref}


def reading_line(reading_id, event_id, at, text="how it landed"):
    return {"id": reading_id, "event_id": event_id, "at": at.isoformat(), "text": text}


def retraction_line(event_id, at, why="no longer true"):
    return {"retracts": event_id, "at": at.isoformat(), "why": why}


def held_note(item_id, created_at, **extra):
    return {
        "id": item_id,
        "created_at": created_at.isoformat(),
        "note": f"note {item_id}",
        "blocked_by": "budget",
        "surfaced_at": None,
        **extra,
    }


def git_repo(workspace: Path, name: str, origin: str | None) -> Path:
    """Create a workspace directory, optionally with a git origin remote."""

    path = workspace / name
    (path / ".git").mkdir(parents=True)
    if origin is not None:
        (path / ".git" / "config").write_text(
            '[core]\n\trepositoryformatversion = 0\n[remote "origin"]\n'
            f"\turl = {origin}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n",
            encoding="utf-8",
        )
    return path


def gh_runner(payloads: dict, failing: tuple = (), views: dict | None = None, comments=None, calls=None):
    """Answer `gh <kind> list` from a `(command, repo)` table, `gh <kind> view` from a url table,
    and `gh api` from a per-repository comments table, recording each argv with its cwd in ``calls``;
    repositories match without regard to case, as on GitHub."""

    payloads = {(command, repo.lower()): answer for (command, repo), answer in payloads.items()}
    comments = {repo.lower(): answer for repo, answer in (comments or {}).items()}
    failing = tuple(item if isinstance(item, str) else (item[0], item[1].lower()) for item in failing)

    def run(args: list[str], cwd=None) -> str:
        if calls is not None:
            calls.append((args, cwd))
        command = args[0]
        if command == "api":
            repo = args[1].removeprefix("repos/").split("/issues/comments")[0].lower()
            if "comments" in failing or ("comments", repo) in failing:
                raise RuntimeError("gh: HTTP 502")
            answer = comments.get(repo, [])
            return answer if isinstance(answer, str) else "".join(json.dumps(item) + "\n" for item in answer)
        if args[1] == "view":
            url = args[2]
            if url in failing:
                raise RuntimeError("gh: HTTP 404")
            return json.dumps((views or {}).get(url, {}))
        repo = args[args.index("--repo") + 1].lower()
        if command in failing or (command, repo) in failing:
            raise RuntimeError("gh: HTTP 404")
        return json.dumps(payloads.get((command, repo), []))

    return run


def run_gate(state_dir, now, **sources):
    """Run both derivation phases the way the gate does."""

    observed = gate.collect_artefacts(state_dir, now, **sources)
    gate.record_artefacts(state_dir, now, observed)
    return observed


def derive(state_dir, now, tmp_path, *, payloads=None, failing=(), views=None, comments=None, calls=None):
    """Run one derivation over a workspace holding `owner/YUI`."""

    workspace = tmp_path / "workspace"
    workspace.mkdir(exist_ok=True)
    if not (workspace / "YUI").exists():
        git_repo(workspace, "YUI", "https://github.com/owner/YUI.git")
    return run_gate(
        state_dir,
        now,
        workspace_root=workspace,
        run_gh=gh_runner(payloads or {}, failing, views, comments, calls),
    )


def test_gate_wrapper_is_self_locating_for_symlink_installation():
    wrapper = Path(__file__).parents[1] / "scripts/desire-gate.sh"
    assert wrapper.read_text(encoding="utf-8").splitlines() == [
        "#!/bin/sh",
        'exec python3 "$(dirname "$(readlink -f "$0")")/../gate.py"',
    ]


def test_gate_refuses_to_run_without_its_identity(state_dir, monkeypatch, capsys):
    monkeypatch.delenv("DESIRE_AGENT_NAME", raising=False)

    with pytest.raises(SystemExit) as failure:
        gate.main()

    assert "DESIRE_AGENT_NAME" in str(failure.value)
    assert capsys.readouterr().out == ""


def test_the_wake_line_prefixes_are_the_byte_exact_contract():
    assert desire_config.WAKE_UNREAD_EVENTS == "desire gate: unread events"
    assert desire_config.WAKE_HELD_NOTES == "desire gate: held notes"


def test_no_case_holds_prints_only_the_no_wake_line(state_dir, at, capsys):
    gate.main()

    assert capsys.readouterr().out == NO_WAKE


def test_a_held_note_wakes_nobody_while_transport_is_down(state_dir, at, state_helpers):
    _, write_jsonl, _, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    write_jsonl(state_dir / "outbox.jsonl", [held_note("one", now)])

    assert gate.run(now) == NO_WAKE


def test_a_held_note_wakes_nobody_on_an_exhausted_budget(state_dir, at, state_helpers, transport_up):
    write_json, write_jsonl, _, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    write_json(
        state_dir / "budget.json",
        {"date": "2026-08-25", "signals": 3, "issues": 0, "self_comments": 0, "prs": 0, "pending": {}},
    )
    write_jsonl(state_dir / "outbox.jsonl", [held_note("one", now)])

    assert gate.run(now) == NO_WAKE


def test_a_postponed_note_wakes_nobody_until_not_before(state_dir, at, state_helpers, transport_up):
    _, write_jsonl, _, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    write_jsonl(
        state_dir / "outbox.jsonl",
        [held_note("later", now, not_before=(now + timedelta(hours=1)).isoformat())],
    )

    assert gate.run(now) == NO_WAKE
    assert gate.run(now + timedelta(hours=1)) == "desire gate: held notes (1)\n"


def test_a_held_note_wakes_again_after_six_hours_and_on_a_newer_note(
    state_dir, at, state_helpers, transport_up
):
    _, write_jsonl, read_json, _ = state_helpers
    t0 = at("2026-08-25T12:00:00+09:00")
    write_jsonl(state_dir / "outbox.jsonl", [held_note("one", t0)])

    assert gate.run(t0) == "desire gate: held notes (1)\n"
    assert gate.run(t0 + timedelta(minutes=1)) == NO_WAKE
    assert gate.run(t0 + timedelta(hours=6)) == "desire gate: held notes (1)\n"
    assert read_json(state_dir / "gate.json")["notes_presented_at"] == (t0 + timedelta(hours=6)).isoformat()

    write_jsonl(state_dir / "outbox.jsonl", [held_note("one", t0), held_note("two", t0 + timedelta(hours=7))])

    assert gate.run(t0 + timedelta(hours=7, minutes=1)) == "desire gate: held notes (2)\n"


def test_five_unread_events_wake_once_then_every_six_hours_at_most_three_times(state_dir, at, state_helpers):
    _, write_jsonl, read_json, _ = state_helpers
    t0 = at("2026-08-25T12:00:00+09:00")
    write_jsonl(
        state_dir / "events.jsonl",
        [event_line(f"e-{index:06x}", t0, f"fact {index}") for index in range(5)],
    )

    assert gate.run(t0) == "desire gate: unread events (5)\n"
    assert gate.run(t0 + timedelta(minutes=1)) == NO_WAKE
    assert gate.run(t0 + timedelta(hours=6)) == "desire gate: unread events (5)\n"
    assert gate.run(t0 + timedelta(hours=12)) == "desire gate: unread events (5)\n"
    assert gate.run(t0 + timedelta(hours=18)) == NO_WAKE
    assert len(read_json(state_dir / "gate.json")["batch"]["presented_at"]) == 3


def test_reading_two_events_leaves_the_batch_due_state_untouched(state_dir, at, state_helpers):
    _, write_jsonl, read_json, _ = state_helpers
    t0 = at("2026-08-25T12:00:00+09:00")
    lines = [event_line(f"e-{index:06x}", t0, f"fact {index}") for index in range(5)]
    write_jsonl(state_dir / "events.jsonl", lines)
    gate.run(t0)
    gate.run(t0 + timedelta(hours=6))
    gate.run(t0 + timedelta(hours=12))

    write_jsonl(
        state_dir / "readings.jsonl",
        [
            reading_line("r-000001", "e-000000", t0 + timedelta(hours=18)),
            reading_line("r-000002", "e-000001", t0 + timedelta(hours=18)),
        ],
    )

    assert gate.run(t0 + timedelta(hours=18, minutes=1)) == NO_WAKE
    assert read_json(state_dir / "gate.json")["batch"]["ids"] == ["e-000002", "e-000003", "e-000004"]


def test_a_new_event_starts_a_fresh_batch_with_one_presentation_stamp(state_dir, at, state_helpers):
    _, write_jsonl, read_json, _ = state_helpers
    t0 = at("2026-08-25T12:00:00+09:00")
    lines = [event_line(f"e-{index:06x}", t0, f"fact {index}") for index in range(5)]
    write_jsonl(state_dir / "events.jsonl", lines)
    gate.run(t0)
    gate.run(t0 + timedelta(hours=6))
    gate.run(t0 + timedelta(hours=12))

    write_jsonl(
        state_dir / "readings.jsonl",
        [
            reading_line("r-000001", "e-000000", t0 + timedelta(hours=18)),
            reading_line("r-000002", "e-000001", t0 + timedelta(hours=18)),
        ],
    )
    assert gate.run(t0 + timedelta(hours=18)) == NO_WAKE

    lines.append(event_line("e-000005", t0 + timedelta(hours=19), "fact 5"))
    write_jsonl(state_dir / "events.jsonl", lines)

    assert gate.run(t0 + timedelta(hours=19)) == "desire gate: unread events (4)\n"
    batch = read_json(state_dir / "gate.json")["batch"]
    assert batch["presented_at"] == [(t0 + timedelta(hours=19)).isoformat()]
    assert len(batch["ids"]) == 4


def test_a_read_or_retracted_event_is_not_unread(state_dir, at, state_helpers):
    _, write_jsonl, _, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    write_jsonl(
        state_dir / "events.jsonl",
        [
            event_line("e-000001", now, "read already"),
            event_line("e-000002", now, "taken back"),
            retraction_line("e-000002", now),
        ],
    )
    write_jsonl(state_dir / "readings.jsonl", [reading_line("r-000001", "e-000001", now)])

    assert gate.run(now) == NO_WAKE


def test_both_cases_wake_on_one_run_with_unread_events_first(state_dir, at, state_helpers, transport_up):
    _, write_jsonl, _, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    write_jsonl(state_dir / "events.jsonl", [event_line("e-000001", now, "fact")])
    write_jsonl(state_dir / "outbox.jsonl", [held_note("one", now)])

    assert gate.run(now) == "desire gate: unread events (1)\ndesire gate: held notes (1)\n"


def test_an_internal_error_prints_the_no_wake_line_and_audits_gate_error(state_dir, at, capsys, monkeypatch):
    gate.run(at("2026-08-25T12:00:00+09:00"))
    before = (state_dir / "gate.json").read_bytes()

    def fail():
        raise OSError("probe exploded")

    monkeypatch.setattr(gate, "probe_transport", fail)

    assert gate.main() is None
    assert capsys.readouterr().out == NO_WAKE
    assert (state_dir / "gate.json").read_bytes() == before
    errors = audited(state_dir, "gate_error")
    assert [value["error"] for value in errors] == ["OSError: probe exploded"]


def test_a_failed_audit_write_still_prints_the_no_wake_line(state_dir, at, capsys, monkeypatch):
    gate.run(at("2026-08-25T12:00:00+09:00"))
    (state_dir / "audit.jsonl").unlink()
    (state_dir / "audit.jsonl").mkdir()

    def fail():
        raise OSError("probe exploded")

    monkeypatch.setattr(gate, "probe_transport", fail)

    assert gate.main() is None
    assert capsys.readouterr().out == NO_WAKE


def test_the_first_run_deletes_the_monitor_and_cursor_leftovers(state_dir, at):
    now = at("2026-08-25T12:00:00+09:00")
    (state_dir / "monitor.json").write_text("{}", encoding="utf-8")
    (state_dir / "ticks.jsonl").write_text('{"at": 1}\n', encoding="utf-8")
    (state_dir / "cursor.json").write_text("{}", encoding="utf-8")

    assert gate.run(now) == NO_WAKE

    assert not (state_dir / "monitor.json").exists()
    assert not (state_dir / "ticks.jsonl").exists()
    assert not (state_dir / "cursor.json").exists()


def test_an_installed_drives_file_with_level_objects_is_rewritten_to_the_stamps(state_dir, at, state_helpers):
    write_json, _, read_json, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    interaction = (now - timedelta(hours=3)).isoformat()
    write_json(
        state_dir / "drives.json",
        {
            "curiosity": {"level": 42.0, "anchor_at": now.isoformat()},
            "accomplishment": {"level": 17.5, "anchor_at": now.isoformat()},
            "last_interaction_at": interaction,
            "last_interaction_hash": None,
        },
    )

    gate.run(now)

    assert read_json(state_dir / "drives.json") == {
        "last_interaction_at": interaction,
        "last_interaction_hash": None,
        "last_signal_at": None,
        "last_signal_answered_at": None,
    }


def test_the_first_answer_records_everything_seen_and_shipped(state_dir, at, tmp_path, state_helpers):
    _, _, read_json, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)

    derive(
        state_dir,
        now,
        tmp_path,
        payloads={
            ("pr", "owner/YUI"): [
                {
                    "url": "https://github.com/owner/YUI/pull/1",
                    "isCrossRepository": False,
                    "headRefName": f"{BRANCH}a",
                    "mergedAt": None,
                },
                {
                    "url": "https://github.com/owner/YUI/pull/2",
                    "isCrossRepository": False,
                    "headRefName": f"{BRANCH}b",
                    "mergedAt": "2026-08-24T00:00:00Z",
                },
            ],
            ("issue", "owner/YUI"): [
                {
                    "url": "https://github.com/owner/YUI/issues/9",
                    "body": f"{MARKER}\nhello",
                    "closedAt": None,
                }
            ],
        },
    )

    assert read_json(state_dir / "artefacts.json") == {
        "bootstrapped_at": now.isoformat(),
        "bootstrapped": ["issue", "pr"],
        "seen": {
            "pr": ["https://github.com/owner/YUI/pull/1", "https://github.com/owner/YUI/pull/2"],
            "issue": ["https://github.com/owner/YUI/issues/9"],
        },
        "shipped": ["https://github.com/owner/YUI/pull/2"],
        "comments_from": {"owner/yui": now.isoformat()},
        "comments_since": {"owner/yui": now.isoformat()},
    }
    assert desire_events.events_view(state_dir) == []


def test_a_new_agent_pull_request_is_recorded_exactly_once(state_dir, at, tmp_path, state_helpers):
    _, _, read_json, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    derive(state_dir, now, tmp_path)

    payloads = {
        ("pr", "owner/YUI"): [
            {
                "url": "https://github.com/owner/YUI/pull/3",
                "isCrossRepository": False,
                "headRefName": f"{BRANCH}c",
                "mergedAt": None,
            }
        ]
    }
    derive(state_dir, now, tmp_path, payloads=payloads)
    derive(state_dir, now, tmp_path, payloads=payloads)

    artefacts = read_json(state_dir / "artefacts.json")
    assert artefacts["seen"]["pr"] == ["https://github.com/owner/YUI/pull/3"]
    assert artefacts["shipped"] == []


def test_a_merged_pull_request_is_recorded_shipped_exactly_once(state_dir, at, tmp_path, state_helpers):
    _, _, read_json, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    derive(state_dir, now, tmp_path)
    open_pull = {
        "url": "https://github.com/owner/YUI/pull/4",
        "isCrossRepository": False,
        "headRefName": f"{BRANCH}d",
        "mergedAt": None,
    }
    derive(state_dir, now, tmp_path, payloads={("pr", "owner/YUI"): [open_pull]})

    merged = {**open_pull, "mergedAt": "2026-08-25T11:00:00Z"}
    derive(state_dir, now, tmp_path, payloads={("pr", "owner/YUI"): [merged]})
    derive(state_dir, now, tmp_path, payloads={("pr", "owner/YUI"): [merged]})

    artefacts = read_json(state_dir / "artefacts.json")
    assert artefacts["seen"] == {"pr": ["https://github.com/owner/YUI/pull/4"], "issue": []}
    assert artefacts["shipped"] == ["https://github.com/owner/YUI/pull/4"]


def test_a_pull_request_outside_the_agent_branch_prefix_or_from_a_fork_is_never_recorded(
    state_dir, at, tmp_path, state_helpers
):
    _, _, read_json, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    derive(state_dir, now, tmp_path)

    derive(
        state_dir,
        now,
        tmp_path,
        payloads={
            ("pr", "owner/YUI"): [
                {
                    "url": "https://github.com/owner/YUI/pull/5",
                    "isCrossRepository": False,
                    "headRefName": "feat/other",
                    "mergedAt": "2026-08-25T11:00:00Z",
                },
                {
                    "url": "https://github.com/owner/YUI/pull/6",
                    "isCrossRepository": True,
                    "headRefName": f"{BRANCH}fork",
                    "mergedAt": None,
                },
            ]
        },
    )

    assert read_json(state_dir / "artefacts.json")["seen"]["pr"] == []


def test_an_issue_that_does_not_open_with_the_marker_is_never_recorded(
    state_dir, at, tmp_path, state_helpers
):
    _, _, read_json, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    derive(state_dir, now, tmp_path)

    derive(
        state_dir,
        now,
        tmp_path,
        payloads={
            ("issue", "owner/YUI"): [
                {"url": "https://github.com/owner/YUI/issues/10", "body": "plain body", "closedAt": None},
                {
                    "url": "https://github.com/owner/YUI/issues/12",
                    "body": f"Quoting:\n{MARKER}",
                    "closedAt": None,
                },
                {
                    "url": "https://github.com/owner/YUI/issues/11",
                    "body": f"{MARKER}\nmarked",
                    "closedAt": "2026-08-25T10:00:00Z",
                },
            ]
        },
    )

    artefacts = read_json(state_dir / "artefacts.json")
    assert artefacts["seen"]["issue"] == ["https://github.com/owner/YUI/issues/11"]
    assert artefacts["shipped"] == ["https://github.com/owner/YUI/issues/11"]


def test_failing_source_audits_derive_failed_and_leaves_its_cursor(state_dir, at, tmp_path, state_helpers):
    _, _, read_json, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    derive(state_dir, now, tmp_path)

    derive(
        state_dir,
        now,
        tmp_path,
        payloads={
            ("pr", "owner/YUI"): [
                {
                    "url": "https://github.com/owner/YUI/pull/6",
                    "isCrossRepository": False,
                    "headRefName": f"{BRANCH}e",
                    "mergedAt": None,
                }
            ]
        },
        failing=("issue",),
    )

    failures = audited(state_dir, "derive_failed")
    assert [(event["source"], event["repo"]) for event in failures] == [("issue", "owner/yui")]
    assert "404" in failures[0]["error"]
    artefacts = read_json(state_dir / "artefacts.json")
    assert artefacts["seen"]["issue"] == []
    assert artefacts["seen"]["pr"] == ["https://github.com/owner/YUI/pull/6"]


def test_a_source_that_failed_during_bootstrap_bootstraps_when_it_recovers(
    state_dir, at, tmp_path, state_helpers
):
    _, _, read_json, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    existing = {
        "url": "https://github.com/owner/YUI/pull/1",
        "isCrossRepository": False,
        "headRefName": f"{BRANCH}a",
        "mergedAt": "2026-08-24T00:00:00Z",
    }
    payloads = {("pr", "owner/YUI"): [existing]}

    derive(state_dir, now, tmp_path, payloads=payloads, failing=("pr",))

    assert read_json(state_dir / "artefacts.json")["seen"]["pr"] == []

    derive(state_dir, now, tmp_path, payloads=payloads)

    artefacts = read_json(state_dir / "artefacts.json")
    assert artefacts["seen"]["pr"] == [existing["url"]]
    assert artefacts["shipped"] == [existing["url"]]

    fresh = {
        "url": "https://github.com/owner/YUI/pull/2",
        "isCrossRepository": False,
        "headRefName": f"{BRANCH}b",
        "mergedAt": None,
    }
    derive(state_dir, now, tmp_path, payloads={("pr", "owner/YUI"): [existing, fresh]})

    assert read_json(state_dir / "artefacts.json")["seen"]["pr"] == [existing["url"], fresh["url"]]


def test_two_workspace_directories_sharing_an_origin_record_once(state_dir, at, tmp_path, state_helpers):
    _, _, read_json, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    workspace = tmp_path / "workspace"
    workspace.mkdir(exist_ok=True)
    git_repo(workspace, "YUI", "https://github.com/owner/YUI.git")
    git_repo(workspace, "YUI-clone", "https://github.com/owner/YUI.git")

    run_gate(
        state_dir,
        now,
        workspace_root=workspace,
        run_gh=gh_runner({}),
    )
    payloads = {
        ("pr", "owner/YUI"): [
            {
                "url": "https://github.com/owner/YUI/pull/7",
                "isCrossRepository": False,
                "headRefName": f"{BRANCH}f",
                "mergedAt": None,
            }
        ]
    }
    run_gate(
        state_dir,
        now,
        workspace_root=workspace,
        run_gh=gh_runner(payloads),
    )

    assert read_json(state_dir / "artefacts.json")["seen"]["pr"] == ["https://github.com/owner/YUI/pull/7"]


def test_a_repository_failing_during_bootstrap_leaves_the_kind_unbootstrapped(
    state_dir, at, tmp_path, state_helpers
):
    _, _, read_json, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    workspace = tmp_path / "workspace"
    workspace.mkdir(exist_ok=True)
    git_repo(workspace, "YUI", "https://github.com/owner/YUI.git")
    git_repo(workspace, "YUI-clone", "https://github.com/owner/memory_layer.git")
    healthy = {
        "url": "https://github.com/owner/YUI/pull/8",
        "isCrossRepository": False,
        "headRefName": f"{BRANCH}g",
        "mergedAt": None,
    }

    run_gate(
        state_dir,
        now,
        workspace_root=workspace,
        run_gh=gh_runner({("pr", "owner/YUI"): [healthy]}, failing=(("pr", "owner/memory_layer"),)),
    )

    artefacts = read_json(state_dir / "artefacts.json")
    assert artefacts["seen"]["pr"] == []
    assert "pr" not in artefacts["bootstrapped"]
    assert "issue" in artefacts["bootstrapped"]


def test_a_repository_failing_after_bootstrap_still_records_the_healthy_one(
    state_dir, at, tmp_path, state_helpers
):
    _, _, read_json, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    workspace = tmp_path / "workspace"
    workspace.mkdir(exist_ok=True)
    git_repo(workspace, "YUI", "https://github.com/owner/YUI.git")
    git_repo(workspace, "YUI-clone", "https://github.com/owner/memory_layer.git")
    run_gate(state_dir, now, workspace_root=workspace, run_gh=gh_runner({}))
    healthy = {
        "url": "https://github.com/owner/YUI/pull/9",
        "isCrossRepository": False,
        "headRefName": f"{BRANCH}h",
        "mergedAt": None,
    }

    run_gate(
        state_dir,
        now,
        workspace_root=workspace,
        run_gh=gh_runner({("pr", "owner/YUI"): [healthy]}, failing=(("pr", "owner/memory_layer"),)),
    )

    assert [(event["source"], event["repo"]) for event in audited(state_dir, "derive_failed")] == [
        ("pr", "owner/memory_layer")
    ]
    assert read_json(state_dir / "artefacts.json")["seen"]["pr"] == [healthy["url"]]


def test_a_merged_pull_request_outside_the_list_window_is_shipped_from_its_own_view(
    state_dir, at, tmp_path, state_helpers
):
    _, _, read_json, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    url = "https://github.com/owner/YUI/pull/10"
    listed = {"url": url, "isCrossRepository": False, "headRefName": f"{BRANCH}i", "mergedAt": None}
    derive(state_dir, now, tmp_path)
    derive(state_dir, now, tmp_path, payloads={("pr", "owner/YUI"): [listed]})

    derive(state_dir, now, tmp_path, views={url: {"state": "MERGED", "mergedAt": "2026-08-25T11:00:00Z"}})
    derive(state_dir, now, tmp_path, views={url: {"state": "MERGED", "mergedAt": "2026-08-25T11:00:00Z"}})

    assert read_json(state_dir / "artefacts.json")["shipped"] == [url]


def test_a_closed_issue_outside_the_list_window_is_shipped_from_its_own_view(
    state_dir, at, tmp_path, state_helpers
):
    _, _, read_json, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    url = "https://github.com/owner/YUI/issues/12"
    listed = {"url": url, "body": f"{MARKER}\nhi", "closedAt": None}
    derive(state_dir, now, tmp_path)
    derive(state_dir, now, tmp_path, payloads={("issue", "owner/YUI"): [listed]})

    derive(state_dir, now, tmp_path, views={url: {"state": "CLOSED", "closedAt": "2026-08-25T11:00:00Z"}})
    derive(state_dir, now, tmp_path, views={url: {"state": "CLOSED", "closedAt": "2026-08-25T11:00:00Z"}})

    assert read_json(state_dir / "artefacts.json")["shipped"] == [url]


def test_a_failing_view_call_audits_that_artefact_and_leaves_it_for_the_next_run(
    state_dir, at, tmp_path, state_helpers
):
    _, _, read_json, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    url = "https://github.com/owner/YUI/pull/11"
    listed = {"url": url, "isCrossRepository": False, "headRefName": f"{BRANCH}j", "mergedAt": None}
    derive(state_dir, now, tmp_path)
    derive(state_dir, now, tmp_path, payloads={("pr", "owner/YUI"): [listed]})

    derive(state_dir, now, tmp_path, failing=(url,))

    failures = audited(state_dir, "derive_failed")
    assert [(event["source"], event["ref"]) for event in failures] == [("pr", url)]
    assert read_json(state_dir / "artefacts.json")["shipped"] == []

    derive(state_dir, now, tmp_path, views={url: {"state": "MERGED", "mergedAt": "2026-08-25T11:00:00Z"}})

    assert read_json(state_dir / "artefacts.json")["shipped"] == [url]


def test_a_malformed_ref_audits_derive_failed_instead_of_vanishing(state_dir, at, tmp_path, state_helpers):
    _, _, read_json, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    derive(state_dir, now, tmp_path)
    url = "https://github.com/owner/YUI/pull/3"

    derive(
        state_dir,
        now,
        tmp_path,
        payloads={
            ("pr", "owner/YUI"): [
                {"url": 12, "isCrossRepository": False, "headRefName": f"{BRANCH}broken", "mergedAt": None},
                {"url": url, "isCrossRepository": False, "headRefName": f"{BRANCH}good", "mergedAt": None},
            ]
        },
    )

    failures = audited(state_dir, "derive_failed")
    assert [event["source"] for event in failures] == ["pr"]
    assert "12" in failures[0]["error"]
    assert read_json(state_dir / "artefacts.json")["seen"]["pr"] == [url]


def test_sources_are_read_before_the_gate_takes_the_state_lock(state_dir, at, isolated_profile, monkeypatch):
    now = at("2026-08-25T12:00:00+09:00")
    workspace = isolated_profile / "workspace"
    workspace.mkdir(parents=True)
    git_repo(workspace, "YUI", "https://github.com/owner/YUI.git")
    acquired = []

    def probe_lock(args, cwd=None):
        def take():
            with desire_store.state_lock(state_dir):
                acquired.append(args[0] if args[0] != "api" else args[1].split("?")[0])

        worker = threading.Thread(target=take, daemon=True)
        worker.start()
        worker.join(timeout=5)
        assert not worker.is_alive(), "the gate held the state lock while reading a source"
        return "[]" if args[0] != "api" else ""

    monkeypatch.setattr(gate, "run_gh", probe_lock)

    gate.run(now)
    gate.run(now + timedelta(minutes=5))

    assert acquired == ["pr", "issue", "pr", "issue", "repos/owner/yui/issues/comments"]


def test_gate_run_derives_from_the_profile_and_stays_silent_when_a_source_fails(
    state_dir, at, isolated_profile, monkeypatch, state_helpers
):
    _, _, read_json, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    profile = isolated_profile
    workspace = profile / "workspace"
    workspace.mkdir(parents=True)
    git_repo(workspace, "YUI", "https://github.com/owner/YUI.git")

    def failing_gh(args, cwd=None):
        raise RuntimeError("gh: could not authenticate")

    monkeypatch.setattr(gate, "run_gh", failing_gh)

    assert gate.run(now) == NO_WAKE

    assert [event["source"] for event in audited(state_dir, "derive_failed")] == ["pr", "issue"]
    assert read_json(state_dir / "artefacts.json")["seen"] == {"pr": [], "issue": []}


def test_workspace_repos_reads_github_origins_only(tmp_path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    git_repo(workspace, "YUI", "https://github.com/owner/YUI.git")
    git_repo(workspace, "memory_layer", "git@github.com:owner/memory_layer.git")
    git_repo(workspace, "internal", "https://gitlab.example.com/team/internal.git")
    git_repo(workspace, "no-remote", None)
    (workspace / "cron_results").mkdir()
    (workspace / "notes.md").write_text("loose file", encoding="utf-8")

    assert gate.workspace_repos(workspace) == {
        "owner/yui": workspace / "YUI",
        "owner/memory_layer": workspace / "memory_layer",
    }


def test_workspace_repos_tolerates_a_missing_workspace(tmp_path):
    assert gate.workspace_repos(tmp_path / "absent") == {}


def test_expires_items_at_48h_and_audits(state_dir, at, state_helpers):
    _, write_jsonl, _, read_jsonl = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    write_jsonl(
        state_dir / "outbox.jsonl",
        [
            {
                "id": "expired",
                "created_at": (now - timedelta(hours=48)).isoformat(),
                "note": "old",
                "blocked_by": "budget",
                "surfaced_at": (now - timedelta(hours=40)).isoformat(),
            },
            {
                "id": "active",
                "created_at": (now - timedelta(hours=47, minutes=59)).isoformat(),
                "note": "new",
                "blocked_by": "error",
                "surfaced_at": (now - timedelta(hours=1)).isoformat(),
            },
        ],
    )

    gate.run(now)

    assert [item["id"] for item in read_jsonl(state_dir / "outbox.jsonl")] == ["active"]
    expired = [event for event in read_jsonl(state_dir / "audit.jsonl") if event["event"] == "outbox_expired"]
    assert expired == [{"at": now.isoformat(), "event": "outbox_expired", "item": expired[0]["item"]}]
    assert expired[0]["item"]["id"] == "expired"


def test_keeps_surfaced_item_alive(state_dir, at, state_helpers):
    _, write_jsonl, _, read_jsonl = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    write_jsonl(
        state_dir / "outbox.jsonl",
        [
            {
                "id": "fresh",
                "created_at": now.isoformat(),
                "note": "still pending",
                "blocked_by": "budget",
                "surfaced_at": (now - timedelta(minutes=20)).isoformat(),
            }
        ],
    )

    gate.run(now)

    assert [item["id"] for item in read_jsonl(state_dir / "outbox.jsonl")] == ["fresh"]


def test_removes_future_dated_item_without_raising_and_audits_expired(state_dir, at, state_helpers):
    _, write_jsonl, _, read_jsonl = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    write_jsonl(
        state_dir / "outbox.jsonl",
        [
            {
                "id": "far_future",
                "created_at": "9999-12-31T23:59:59+09:00",
                "note": "distant",
                "blocked_by": "budget",
                "surfaced_at": None,
            },
            {
                "id": "near_future",
                "created_at": (now + timedelta(hours=1)).isoformat(),
                "note": "not yet",
                "blocked_by": "budget",
                "surfaced_at": None,
            },
        ],
    )

    gate.run(now)

    assert read_jsonl(state_dir / "outbox.jsonl") == []
    expired_ids = {
        event["item"]["id"]
        for event in read_jsonl(state_dir / "audit.jsonl")
        if event["event"] == "outbox_expired"
    }
    assert expired_ids == {"far_future", "near_future"}


def test_drops_malformed_outbox_lines_and_audits_count(state_dir, at, state_helpers):
    _, _, _, read_jsonl = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    (state_dir / "outbox.jsonl").write_text(
        '{"id":"ok","created_at":"2026-08-25T12:00:00+09:00","note":"n","blocked_by":"budget","surfaced_at":null}\n'
        "{bad}\n",
        encoding="utf-8",
    )

    gate.run(now)

    assert [item["id"] for item in read_jsonl(state_dir / "outbox.jsonl")] == ["ok"]
    assert read_jsonl(state_dir / "audit.jsonl")[-1] == {
        "at": now.isoformat(),
        "event": "jsonl_lines_dropped",
        "count": 1,
    }


def test_reaps_outbox_item_with_invalid_surfaced_at(state_dir, at, state_helpers):
    _, write_jsonl, _, read_jsonl = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    write_jsonl(
        state_dir / "outbox.jsonl",
        [
            {
                "id": "invalid",
                "created_at": now.isoformat(),
                "note": "bad timestamp",
                "blocked_by": "budget",
                "surfaced_at": "not-a-date",
            },
            {
                "id": "valid",
                "created_at": now.isoformat(),
                "note": "keep",
                "blocked_by": "budget",
                "surfaced_at": None,
            },
        ],
    )

    assert gate.run(now) == NO_WAKE

    assert [value["id"] for value in read_jsonl(state_dir / "outbox.jsonl")] == ["valid"]
    assert read_jsonl(state_dir / "audit.jsonl")[-1] == {
        "at": now.isoformat(),
        "event": "jsonl_lines_dropped",
        "count": 1,
    }


def test_prunes_pending_older_than_seven_days(state_dir, at, state_helpers):
    write_json, _, read_json, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    write_json(
        state_dir / "budget.json",
        {
            "date": "2026-08-25",
            "signals": 0,
            "issues": 2,
            "self_comments": 0,
            "prs": 0,
            "pending": {
                "stale": {"kind": "issue", "date": "2026-08-17"},
                "boundary": {"kind": "issue", "date": "2026-08-18"},
            },
        },
    )

    gate.run(now)

    assert read_json(state_dir / "budget.json")["pending"] == {
        "boundary": {"kind": "issue", "date": "2026-08-18"}
    }


def test_transport_probe_tracks_since_and_failures(
    state_dir, at, state_helpers, listening_signals_url, closed_signals_url, monkeypatch
):
    _, _, read_json, _ = state_helpers
    first = at("2026-08-25T12:00:00+09:00")

    gate.run(first)

    assert read_json(state_dir / "transport.json") == {
        "state": "up",
        "since": first.isoformat(),
        "failed": 0,
        "last_checked_at": first.isoformat(),
        "source": "probe",
    }

    monkeypatch.setenv("YUI_SIGNALS_URL", closed_signals_url)
    second = first + timedelta(minutes=30)
    gate.run(second)
    assert read_json(state_dir / "transport.json") == {
        "state": "down",
        "since": second.isoformat(),
        "failed": 1,
        "last_checked_at": second.isoformat(),
        "source": "probe",
    }

    third = second + timedelta(minutes=30)
    gate.run(third)
    assert read_json(state_dir / "transport.json") == {
        "state": "down",
        "since": second.isoformat(),
        "failed": 2,
        "last_checked_at": third.isoformat(),
        "source": "probe",
    }

    monkeypatch.setenv("YUI_SIGNALS_URL", listening_signals_url)
    fourth = third + timedelta(minutes=30)
    gate.run(fourth)
    assert read_json(state_dir / "transport.json") == {
        "state": "up",
        "since": fourth.isoformat(),
        "failed": 0,
        "last_checked_at": fourth.isoformat(),
        "source": "probe",
    }


def test_probe_treats_http_404_as_up(listening_signals_url):
    assert gate.probe_transport() is True


def test_probe_reports_down_when_server_accepts_then_closes(monkeypatch):
    server = socket.socket()
    server.bind(("127.0.0.1", 0))
    server.listen()

    def accept_then_close():
        connection, _ = server.accept()
        connection.close()

    worker = threading.Thread(target=accept_then_close)
    worker.start()
    monkeypatch.setenv("YUI_SIGNALS_URL", f"http://127.0.0.1:{server.getsockname()[1]}/signals")
    try:
        assert gate.probe_transport() is False
    finally:
        server.close()
        worker.join()


def test_probe_falls_back_to_default_url_when_env_is_empty(monkeypatch):
    from tests.conftest import free_port

    monkeypatch.setenv("YUI_SIGNALS_URL", "")
    monkeypatch.setattr(desire_config, "DEFAULT_SIGNALS_URL", f"http://127.0.0.1:{free_port()}/signals")

    assert gate.probe_transport() is False


def test_an_undecodable_line_in_the_event_log_silences_nothing(state_dir, at, transport_up, state_helpers):
    _, write_jsonl, _, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    write_jsonl(state_dir / "events.jsonl", [event_line("e-000001", now, "fact")])
    with (state_dir / "events.jsonl").open("ab") as stream:
        stream.write(b"\xff not utf-8\n")
    write_jsonl(state_dir / "outbox.jsonl", [held_note("one", now)])

    assert gate.run(now) == "desire gate: unread events (1)\ndesire gate: held notes (1)\n"


def test_an_error_after_the_bookkeeping_leaves_the_presentation_history_unchanged(
    state_dir, at, capsys, monkeypatch, transport_up, state_helpers
):
    _, write_jsonl, _, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    write_jsonl(state_dir / "events.jsonl", [event_line("e-000001", now, "fact")])
    gate.run(now)
    before = (state_dir / "gate.json").read_bytes()

    def fail(_state_dir):
        raise OSError("log exploded")

    monkeypatch.setattr(gate.desire_events, "unread_event_ids", fail)

    assert gate.main() is None
    assert capsys.readouterr().out == NO_WAKE
    assert (state_dir / "gate.json").read_bytes() == before
    assert [value["error"] for value in audited(state_dir, "gate_error")] == ["OSError: log exploded"]


def test_an_error_inside_the_decision_leaves_a_presented_batch_unchanged(
    state_dir, at, capsys, monkeypatch, transport_up, state_helpers
):
    _, write_jsonl, _, _ = state_helpers
    t0 = at("2026-08-25T12:00:00+09:00")
    write_jsonl(state_dir / "events.jsonl", [event_line("e-000001", t0, "fact")])
    gate.run(t0)
    before = (state_dir / "gate.json").read_bytes()
    assert b'"presented_at":["2026-08-25T12:00:00+09:00"]' in before

    def fail(*_args):
        raise OSError("notes exploded")

    monkeypatch.setattr(gate, "_held_notes_lines", fail)

    assert gate.main() is None
    assert capsys.readouterr().out == NO_WAKE
    assert (state_dir / "gate.json").read_bytes() == before
    assert [value["error"] for value in audited(state_dir, "gate_error")] == ["OSError: notes exploded"]


@pytest.mark.parametrize(
    "content",
    [
        "{broken",
        '{"batch": {"ids": [], "presented_at": ["nope"]}, "notes_presented_at": null}',
        '{"batch": {"ids": [], "presented_at": []}}',
    ],
)
def test_an_invalid_gate_state_is_quarantined_and_rebuilt(state_dir, at, state_helpers, content):
    _, _, read_json, read_jsonl = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    gate.run(now)
    (state_dir / "gate.json").write_text(content, encoding="utf-8")

    assert gate.run(now + timedelta(minutes=1)) == NO_WAKE
    assert read_json(state_dir / "gate.json") == {
        "batch": {"ids": [], "presented_at": []},
        "notes_presented_at": None,
    }
    assert len(list(state_dir.glob("gate.json.corrupt-*"))) == 1
    assert [
        e["file"] for e in read_jsonl(state_dir / "audit.jsonl") if e["event"] == "state_corrupt_recovered"
    ] == ["gate.json"]


ISSUE = "https://github.com/owner/YUI/issues/9"
PULL = "https://github.com/owner/YUI/pull/4"


def open_issue(url=ISSUE, closed_at=None):
    return {"url": url, "body": f"{MARKER}\nhello", "closedAt": closed_at}


def open_pull(url=PULL, merged_at=None):
    return {"url": url, "isCrossRepository": False, "headRefName": f"{BRANCH}x", "mergedAt": merged_at}


def comment(number, comment_id, author, created, updated=None, *, path="issues", body="looks good"):
    return {
        "html_url": f"https://github.com/owner/YUI/{path}/{number}#issuecomment-{comment_id}",
        "issue_url": f"https://api.github.com/repos/owner/YUI/issues/{number}",
        "user": {"login": author, "type": "User"},
        "body": body,
        "created_at": created,
        "updated_at": updated or created,
    }


def monitor_events(state_dir):
    return [(event["fact"], event["source_ref"]) for event in desire_events.events_view(state_dir)]


def comment_calls(calls):
    return [args for args, _ in calls if args[0] == "api"]


def cursor(state_dir):
    return json.loads((state_dir / "artefacts.json").read_text(encoding="utf-8"))["comments_since"].get(
        "owner/yui"
    )


def test_a_closed_issue_files_one_event_and_a_second_run_files_none(state_dir, at, tmp_path):
    t0 = at("2026-08-25T12:00:00+09:00")
    derive(state_dir, t0, tmp_path, payloads={("issue", "owner/YUI"): [open_issue()]})
    closed = {("issue", "owner/YUI"): [open_issue(closed_at="2026-08-25T04:00:00Z")]}

    derive(state_dir, t0 + timedelta(hours=1), tmp_path, payloads=closed)
    derive(state_dir, t0 + timedelta(hours=2), tmp_path, payloads=closed)

    assert monitor_events(state_dir) == [(f"issue {ISSUE} was closed", ISSUE)]
    assert desire_events.events_view(state_dir)[0]["source"] == "monitor"


def test_a_merged_pull_request_files_one_event_however_many_calls_report_it(state_dir, at, tmp_path):
    t0 = at("2026-08-25T12:00:00+09:00")
    shipped_before = open_pull("https://github.com/owner/YUI/pull/2", merged_at="2026-08-24T00:00:00Z")
    derive(state_dir, t0, tmp_path, payloads={("pr", "owner/YUI"): [open_pull(), shipped_before]})
    merged = {("pr", "owner/YUI"): [open_pull(merged_at="2026-08-25T04:00:00Z"), shipped_before]}
    views = {PULL: {"state": "MERGED", "mergedAt": "2026-08-25T04:00:00Z"}}

    derive(state_dir, t0 + timedelta(hours=1), tmp_path, payloads=merged, views=views)
    derive(state_dir, t0 + timedelta(hours=2), tmp_path, payloads=merged, views=views)

    assert monitor_events(state_dir) == [(f"pull request {PULL} was merged", PULL)]


def test_an_issue_first_seen_already_closed_after_bootstrap_files_its_delivery(state_dir, at, tmp_path):
    t0 = at("2026-08-25T12:00:00+09:00")
    derive(state_dir, t0, tmp_path)

    derive(
        state_dir,
        t0 + timedelta(hours=1),
        tmp_path,
        payloads={("issue", "owner/YUI"): [open_issue(closed_at="2026-08-25T04:00:00Z")]},
    )

    assert monitor_events(state_dir) == [(f"issue {ISSUE} was closed", ISSUE)]


def test_a_comment_by_someone_else_on_a_seen_artefact_files_one_event(state_dir, at, tmp_path):
    t0 = at("2026-08-25T12:00:00+09:00")
    payloads = {("issue", "owner/YUI"): [open_issue()], ("pr", "owner/YUI"): [open_pull()]}
    derive(state_dir, t0, tmp_path, payloads=payloads)
    page = [
        comment(9, 1, "reviewer", "2026-08-25T03:30:00Z"),
        comment(9, 2, "owner", "2026-08-25T03:31:00Z", body=f"{MARKER}\nOn it."),
        comment(77, 3, "reviewer", "2026-08-25T03:32:00Z"),
        comment(4, 4, "reviewer", "2026-08-25T03:33:00Z", path="pull"),
    ]

    derive(state_dir, t0 + timedelta(hours=1), tmp_path, payloads=payloads, comments={"owner/YUI": page})
    edited = [comment(9, 1, "reviewer", "2026-08-25T03:30:00Z", "2026-08-25T05:00:00Z")]
    derive(state_dir, t0 + timedelta(hours=2), tmp_path, payloads=payloads, comments={"owner/YUI": edited})

    assert monitor_events(state_dir) == [
        (f"reviewer commented on {ISSUE}", f"{ISSUE}#issuecomment-1"),
        (f"reviewer commented on {PULL}", f"{PULL}#issuecomment-4"),
    ]


def test_the_first_run_for_a_repository_sets_its_cursor_without_a_comments_call(state_dir, at, tmp_path):
    t0 = at("2026-08-25T12:00:00+09:00")
    calls = []

    derive(
        state_dir,
        t0,
        tmp_path,
        calls=calls,
        comments={"owner/YUI": [comment(9, 1, "x", "2026-08-25T03:30:00Z")]},
    )

    assert comment_calls(calls) == []
    artefacts = json.loads((state_dir / "artefacts.json").read_text(encoding="utf-8"))
    assert artefacts["comments_from"] == artefacts["comments_since"] == {"owner/yui": t0.isoformat()}


def test_the_cursor_advances_to_the_latest_update_returned(state_dir, at, tmp_path):
    t0 = at("2026-08-25T12:00:00+09:00")
    derive(state_dir, t0, tmp_path)
    calls = []
    page = [
        comment(9, 1, "x", "2026-08-25T03:30:00Z", "2026-08-25T05:00:00Z"),
        comment(9, 2, "x", "2026-08-25T03:40:00Z", "2026-08-25T04:00:00Z"),
    ]

    derive(state_dir, t0 + timedelta(hours=3), tmp_path, calls=calls, comments={"owner/YUI": page})

    assert comment_calls(calls) == [
        [
            "api",
            "repos/owner/yui/issues/comments?since=2026-08-25T02:59:00Z&per_page=100",
            "--paginate",
            "--jq",
            ".[]",
        ]
    ]
    assert desire_config.parse_timestamp(cursor(state_dir)) == at("2026-08-25T05:00:00+00:00")
    assert json.loads((state_dir / "artefacts.json").read_text())["comments_from"] == {
        "owner/yui": t0.isoformat()
    }


def test_a_failing_comments_call_audits_and_keeps_the_cursor(state_dir, at, tmp_path):
    t0 = at("2026-08-25T12:00:00+09:00")
    derive(state_dir, t0, tmp_path)

    derive(state_dir, t0 + timedelta(hours=1), tmp_path, failing=("comments",))

    assert [(event["source"], event["repo"]) for event in audited(state_dir, "derive_failed")] == [
        ("comments", "owner/yui")
    ]
    assert cursor(state_dir) == t0.isoformat()


def test_a_failing_issue_source_keeps_the_cursor_although_comments_were_returned(state_dir, at, tmp_path):
    t0 = at("2026-08-25T12:00:00+09:00")
    derive(state_dir, t0, tmp_path)
    page = [comment(9, 1, "reviewer", "2026-08-25T03:30:00Z", "2026-08-25T05:00:00Z")]

    derive(state_dir, t0 + timedelta(hours=3), tmp_path, failing=("issue",), comments={"owner/YUI": page})

    assert cursor(state_dir) == t0.isoformat()


def test_a_two_page_reply_is_read_whole_and_moves_the_cursor_though_nothing_is_filed(state_dir, at, tmp_path):
    t0 = at("2026-08-25T12:00:00+09:00")
    derive(state_dir, t0, tmp_path, payloads={("issue", "owner/YUI"): [open_issue()]})
    mine = f"{MARKER}\nworking on it"
    first_page = [
        comment(9, index, "owner", f"2026-08-25T03:{index:02d}:00Z", body=mine) for index in range(10, 15)
    ]
    second_page = [
        comment(9, 20, "owner", "2026-08-25T03:30:00Z", "2026-08-25T06:00:00Z", body=mine),
        {"html_url": f"{ISSUE}#issuecomment-21", "created_at": "2026-08-25T03:31:00Z", "updated_at": "nope"},
        {**comment(9, 22, "reviewer", "2026-08-25T03:32:00Z"), "user": None},
    ]
    reply = "".join(json.dumps(item) + "\n" for item in first_page) + "".join(
        json.dumps(item) + "\n" for item in second_page
    )

    derive(
        state_dir,
        t0 + timedelta(hours=4),
        tmp_path,
        payloads={("issue", "owner/YUI"): [open_issue()]},
        comments={"owner/YUI": reply},
    )

    assert monitor_events(state_dir) == []
    assert desire_config.parse_timestamp(cursor(state_dir)) == at("2026-08-25T06:00:00+00:00")
    assert audited(state_dir, "derive_failed") == []


def test_a_comment_on_an_issue_first_seen_on_the_same_run_is_filed(state_dir, at, tmp_path):
    t0 = at("2026-08-25T12:00:00+09:00")
    derive(state_dir, t0, tmp_path)

    derive(
        state_dir,
        t0 + timedelta(hours=1),
        tmp_path,
        payloads={("issue", "owner/YUI"): [open_issue()]},
        comments={"owner/YUI": [comment(9, 1, "reviewer", "2026-08-25T03:30:00Z")]},
    )

    assert monitor_events(state_dir) == [(f"reviewer commented on {ISSUE}", f"{ISSUE}#issuecomment-1")]


def test_the_creation_stamp_decides_and_an_edit_brings_back_a_missed_comment(state_dir, at, tmp_path):
    t0 = at("2026-08-25T12:00:00+09:00")
    payloads = {("issue", "owner/YUI"): [open_issue()]}
    derive(state_dir, t0, tmp_path, payloads=payloads)
    before_bootstrap = comment(9, 1, "reviewer", "2026-08-25T02:00:00Z", "2026-08-25T04:00:00Z")

    derive(
        state_dir,
        t0 + timedelta(hours=2),
        tmp_path,
        payloads=payloads,
        comments={"owner/YUI": [before_bootstrap]},
    )

    assert monitor_events(state_dir) == []
    missed = comment(9, 2, "reviewer", "2026-08-25T03:30:00Z", "2026-08-25T06:00:00Z")
    derive(state_dir, t0 + timedelta(hours=4), tmp_path, payloads=payloads, comments={"owner/YUI": [missed]})

    assert monitor_events(state_dir) == [(f"reviewer commented on {ISSUE}", f"{ISSUE}#issuecomment-2")]


def test_a_repository_bootstraps_its_cursor_only_when_both_sources_answer(state_dir, at, tmp_path):
    t0 = at("2026-08-25T12:00:00+09:00")

    for failing in (("pr",), ("issue",)):
        derive(state_dir, t0, tmp_path, failing=failing)
        assert cursor(state_dir) is None

    later = t0 + timedelta(hours=1)
    derive(state_dir, later, tmp_path)

    assert cursor(state_dir) == later.isoformat()


def test_events_filed_by_a_run_wake_the_agent_in_that_run(state_dir, at, isolated_profile, monkeypatch):
    t0 = at("2026-08-25T12:00:00+09:00")
    workspace = isolated_profile / "workspace"
    workspace.mkdir(parents=True)
    git_repo(workspace, "YUI", "https://github.com/owner/YUI.git")
    monkeypatch.setattr(gate, "run_gh", gh_runner({("issue", "owner/YUI"): [open_issue()]}))
    assert gate.run(t0) == NO_WAKE

    closed = {("issue", "owner/YUI"): [open_issue(closed_at="2026-08-25T04:00:00Z")]}
    monkeypatch.setattr(gate, "run_gh", gh_runner(closed))

    assert gate.run(t0 + timedelta(hours=1)) == "desire gate: unread events (1)\n"


def test_a_crash_between_the_event_and_the_artefact_write_files_once(state_dir, at, tmp_path, monkeypatch):
    t0 = at("2026-08-25T12:00:00+09:00")
    derive(state_dir, t0, tmp_path, payloads={("issue", "owner/YUI"): [open_issue()]})
    closed = {("issue", "owner/YUI"): [open_issue(closed_at="2026-08-25T04:00:00Z")]}
    real_write = desire_store.write_json_atomic

    def crash_on_artefacts(path, value):
        if path.name == "artefacts.json":
            raise OSError("disk gone")
        real_write(path, value)

    monkeypatch.setattr(desire_store, "write_json_atomic", crash_on_artefacts)
    with pytest.raises(OSError):
        derive(state_dir, t0 + timedelta(hours=1), tmp_path, payloads=closed)
    assert len(monitor_events(state_dir)) == 1
    monkeypatch.setattr(desire_store, "write_json_atomic", real_write)

    derive(state_dir, t0 + timedelta(hours=2), tmp_path, payloads=closed)

    assert monitor_events(state_dir) == [(f"issue {ISSUE} was closed", ISSUE)]
    assert json.loads((state_dir / "artefacts.json").read_text())["shipped"] == [ISSUE]


def test_a_filed_event_reaches_the_block_on_the_next_turn_not_inside_the_cached_one(
    desire_plugin, state_dir, at, tmp_path
):
    t0 = at("2026-08-25T12:00:00+09:00")
    derive(state_dir, t0, tmp_path, payloads={("issue", "owner/YUI"): [open_issue()]})

    def turn(text, now):
        request = {"messages": [{"role": "user", "content": text}]}
        return desire_plugin._inject(request=request, now=now)["request"]["messages"][0]["content"]

    first = turn("same turn", t0 + timedelta(minutes=1))
    derive(
        state_dir,
        t0 + timedelta(minutes=2),
        tmp_path,
        payloads={("issue", "owner/YUI"): [open_issue(closed_at="2026-08-25T03:01:00Z")]},
    )
    cached = turn("same turn", t0 + timedelta(minutes=3))
    fresh = turn("next turn", t0 + timedelta(minutes=4))

    assert cached == first
    assert "recent:" not in cached
    assert f'recent:\n- 08-25 "issue {ISSUE} was closed"\nwaiting for my reading: 1 event\n' in fresh


def test_a_repository_keeps_its_cursor_still_while_another_repository_holds_its_kind_unbootstrapped(
    state_dir, at, tmp_path, state_helpers
):
    _, _, read_json, _ = state_helpers
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    git_repo(workspace, "YUI", "https://github.com/owner/YUI.git")
    git_repo(workspace, "memory_layer", "https://github.com/owner/memory_layer.git")
    other_failing = (("pr", "owner/memory_layer"),)
    t0 = at("2026-08-25T12:00:00+09:00")
    page = {"owner/YUI": [comment(4, 1, "reviewer", "2026-08-25T03:30:00Z", path="pull")]}

    run_gate(state_dir, t0, workspace_root=workspace, run_gh=gh_runner({}, other_failing))

    assert read_json(state_dir / "artefacts.json")["comments_since"] == {}
    record = read_json(state_dir / "artefacts.json")
    record["comments_from"] = record["comments_since"] = {"owner/yui": t0.isoformat()}
    (state_dir / "artefacts.json").write_text(json.dumps(record), encoding="utf-8")
    payloads = {("pr", "owner/YUI"): [open_pull()]}

    run_gate(
        state_dir,
        t0 + timedelta(hours=1),
        workspace_root=workspace,
        run_gh=gh_runner(payloads, other_failing, comments=page),
    )

    assert monitor_events(state_dir) == []
    assert cursor(state_dir) == t0.isoformat()
    calls = []

    run_gate(
        state_dir,
        t0 + timedelta(hours=2),
        workspace_root=workspace,
        run_gh=gh_runner(payloads, comments=page, calls=calls),
    )

    assert "since=2026-08-25T02:59:00Z" in comment_calls(calls)[0][1]
    assert monitor_events(state_dir) == [(f"reviewer commented on {PULL}", f"{PULL}#issuecomment-1")]


def test_a_repository_added_later_records_its_closed_issues_silently_on_its_first_run(
    state_dir, at, tmp_path
):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    git_repo(workspace, "YUI", "https://github.com/owner/YUI.git")
    t0 = at("2026-08-25T12:00:00+09:00")
    run_gate(state_dir, t0, workspace_root=workspace, run_gh=gh_runner({}))
    git_repo(workspace, "memory_layer", "https://github.com/owner/memory_layer.git")
    closed_before = open_issue(
        "https://github.com/owner/memory_layer/issues/1", closed_at="2026-08-01T00:00:00Z"
    )
    still_open = open_issue("https://github.com/owner/memory_layer/issues/2")

    run_gate(
        state_dir,
        t0 + timedelta(hours=1),
        workspace_root=workspace,
        run_gh=gh_runner({("issue", "owner/memory_layer"): [closed_before, still_open]}),
    )

    assert monitor_events(state_dir) == []
    closed_now = {**still_open, "closedAt": "2026-08-25T05:00:00Z"}
    run_gate(
        state_dir,
        t0 + timedelta(hours=2),
        workspace_root=workspace,
        run_gh=gh_runner({("issue", "owner/memory_layer"): [closed_before, closed_now]}),
    )

    url = still_open["url"]
    assert monitor_events(state_dir) == [(f"issue {url} was closed", url)]


def test_workspace_repos_drops_an_origin_whose_owner_or_name_is_not_a_slug(tmp_path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    git_repo(workspace, "YUI", "https://github.com/owner/YUI.git")
    git_repo(workspace, "query", "git@github.com:o/n?x=1.git")
    git_repo(workspace, "parent", "https://github.com/../YUI.git")
    git_repo(workspace, "dots", "https://github.com/owner/...git")

    assert gate.workspace_repos(workspace) == {"owner/yui": workspace / "YUI"}


def test_a_comment_by_a_bot_files_nothing(state_dir, at, tmp_path):
    t0 = at("2026-08-25T12:00:00+09:00")
    payloads = {("issue", "owner/YUI"): [open_issue()]}
    derive(state_dir, t0, tmp_path, payloads=payloads)
    bot = comment(9, 1, "github-actions[bot]", "2026-08-25T03:30:00Z", "2026-08-25T05:00:00Z")
    bot["user"]["type"] = "Bot"

    derive(state_dir, t0 + timedelta(hours=1), tmp_path, payloads=payloads, comments={"owner/YUI": [bot]})

    assert monitor_events(state_dir) == []
    assert desire_config.parse_timestamp(cursor(state_dir)) == at("2026-08-25T05:00:00+00:00")


@pytest.mark.parametrize("field", ["html_url", "issue_url", "user.login", "created_at", "updated_at"])
def test_a_comment_entry_missing_a_field_is_skipped_on_its_own(state_dir, at, tmp_path, field):
    t0 = at("2026-08-25T12:00:00+09:00")
    payloads = {("issue", "owner/YUI"): [open_issue()]}
    derive(state_dir, t0, tmp_path, payloads=payloads)
    broken = comment(9, 1, "reviewer", "2026-08-25T03:30:00Z")
    if field == "user.login":
        del broken["user"]["login"]
    else:
        del broken[field]
    whole = comment(9, 2, "reviewer", "2026-08-25T03:40:00Z")

    derive(
        state_dir,
        t0 + timedelta(hours=1),
        tmp_path,
        payloads=payloads,
        comments={"owner/YUI": [broken, whole]},
    )

    assert monitor_events(state_dir) == [(f"reviewer commented on {ISSUE}", f"{ISSUE}#issuecomment-2")]
    assert audited(state_dir, "derive_failed") == []


def test_only_a_marker_on_the_first_line_makes_a_comment_the_agent_s_whichever_account_posted_it(
    state_dir, at, tmp_path
):
    t0 = at("2026-08-25T12:00:00+09:00")
    payloads = {("issue", "owner/YUI"): [open_issue()]}
    derive(state_dir, t0, tmp_path, payloads=payloads)
    page = [
        comment(9, 1, "owner", "2026-08-25T03:30:00Z", body=f"\n  {MARKER}  \nI opened a follow-up."),
        comment(9, 2, "owner", "2026-08-25T03:31:00Z", body="Thanks, merging after lunch."),
        comment(9, 3, "owner", "2026-08-25T03:32:00Z", body=f"> {MARKER}\nWhy this marker?"),
        comment(9, 4, "owner", "2026-08-25T03:33:00Z", body=f"See below.\n{MARKER}"),
        comment(9, 5, "owner", "2026-08-25T03:34:00Z", body=None),
    ]

    derive(state_dir, t0 + timedelta(hours=1), tmp_path, payloads=payloads, comments={"owner/YUI": page})

    assert monitor_events(state_dir) == [
        (f"owner commented on {ISSUE}", f"{ISSUE}#issuecomment-{number}") for number in (2, 3, 4, 5)
    ]


def test_the_gate_reads_github_without_asking_who_gh_acts_as(state_dir, at, tmp_path):
    t0 = at("2026-08-25T12:00:00+09:00")
    payloads = {("issue", "owner/YUI"): [open_issue()], ("pr", "owner/YUI"): [open_pull()]}
    page = {"owner/YUI": [comment(9, 1, "reviewer", "2026-08-25T03:30:00Z", "2026-08-25T05:00:00Z")]}
    calls = []

    derive(state_dir, t0, tmp_path, payloads=payloads, calls=calls)
    assert cursor(state_dir) == t0.isoformat()
    derive(state_dir, t0 + timedelta(hours=3), tmp_path, payloads=payloads, comments=page, calls=calls)

    assert desire_config.parse_timestamp(cursor(state_dir)) == at("2026-08-25T05:00:00+00:00")
    assert monitor_events(state_dir) == [(f"reviewer commented on {ISSUE}", f"{ISSUE}#issuecomment-1")]
    assert [args for args, _ in calls if args[:2] == ["api", "user"]] == []
    lists = [args for args, _ in calls if args[1] == "list"]
    assert len(lists) == 4
    for args in lists:
        assert "--author" not in args
        assert args[args.index("--state") + 1] == "all"
        assert args[args.index("--limit") + 1] == "100"


def test_every_gh_call_for_a_repository_runs_inside_its_first_workspace_clone(state_dir, at, tmp_path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    first = git_repo(workspace, "YUI", "https://github.com/owner/YUI.git")
    git_repo(workspace, "YUI-clone", "https://github.com/OWNER/yui.git")
    memory = git_repo(workspace, "memory_layer", "https://github.com/Owner/Memory_Layer.git")
    issue = "https://github.com/owner/memory_layer/issues/3"
    payloads = {
        ("pr", "owner/YUI"): [open_pull()],
        ("issue", "Owner/Memory_Layer"): [open_issue(issue)],
    }
    views = {issue: {"state": "CLOSED", "closedAt": "2026-08-25T04:00:00Z"}}
    t0 = at("2026-08-25T12:00:00+09:00")
    calls = []

    run_gate(state_dir, t0, workspace_root=workspace, run_gh=gh_runner(payloads, calls=calls))
    run_gate(
        state_dir,
        t0 + timedelta(hours=1),
        workspace_root=workspace,
        run_gh=gh_runner(payloads, views=views, calls=calls),
    )

    def repo_of(args):
        if args[0] == "api":
            return args[1].removeprefix("repos/").split("/issues/")[0]
        if args[1] == "view":
            return "/".join(args[2].split("/")[3:5])
        return args[args.index("--repo") + 1]

    assert {("api",) if args[0] == "api" else tuple(args[:2]) for args, _ in calls} == {
        ("pr", "list"),
        ("issue", "list"),
        ("api",),
        ("pr", "view"),
        ("issue", "view"),
    }
    assert {(repo_of(args).lower(), cwd) for args, cwd in calls} == {
        ("owner/yui", first),
        ("owner/memory_layer", memory),
    }
    assert monitor_events(state_dir) == [(f"issue {issue} was closed", issue)]


def test_a_view_of_an_artefact_whose_repository_has_no_clone_in_the_workspace_runs_without_a_cwd(
    state_dir, at, tmp_path
):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    git_repo(workspace, "YUI", "https://github.com/owner/YUI.git")
    gone = git_repo(workspace, "memory_layer", "https://github.com/owner/memory_layer.git")
    url = "https://github.com/owner/memory_layer/pull/2"
    t0 = at("2026-08-25T12:00:00+09:00")
    run_gate(
        state_dir,
        t0,
        workspace_root=workspace,
        run_gh=gh_runner({("pr", "owner/memory_layer"): [open_pull(url)]}),
    )
    shutil.rmtree(gone)
    calls = []

    run_gate(
        state_dir,
        t0 + timedelta(hours=1),
        workspace_root=workspace,
        run_gh=gh_runner(
            {}, views={url: {"state": "MERGED", "mergedAt": "2026-08-25T03:00:00Z"}}, calls=calls
        ),
    )

    assert [(args, cwd) for args, cwd in calls if args[1] == "view"] == [
        (["pr", "view", url, "--json", "state,mergedAt"], None)
    ]
