import json
import socket
import threading
from datetime import timedelta
from pathlib import Path

import pytest
from conftest import AGENT_NAME

import desire_config
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


def gh_runner(payloads: dict, failing: tuple = (), views: dict | None = None):
    """Answer `gh <kind> list` from a `(command, repo)` table and `gh <kind> view` from a url table."""

    def run(args: list[str]) -> str:
        command = args[0]
        if args[1] == "view":
            url = args[2]
            if url in failing:
                raise RuntimeError("gh: HTTP 404")
            return json.dumps((views or {}).get(url, {}))
        repo = args[args.index("--repo") + 1]
        if command in failing or (command, repo) in failing:
            raise RuntimeError("gh: HTTP 404")
        return json.dumps(payloads.get((command, repo), []))

    return run


def run_gate(state_dir, now, **sources):
    """Run both derivation phases the way the gate does."""

    observed = gate.collect_artefacts(state_dir, now, **sources)
    gate.record_artefacts(state_dir, now, observed)
    return observed


def derive(state_dir, now, tmp_path, *, payloads=None, failing=(), views=None):
    """Run one derivation over a workspace holding `owner/YUI`."""

    workspace = tmp_path / "workspace"
    workspace.mkdir(exist_ok=True)
    if not (workspace / "YUI").exists():
        git_repo(workspace, "YUI", "https://github.com/owner/YUI.git")
    return run_gate(
        state_dir,
        now,
        workspace_root=workspace,
        run_gh=gh_runner(payloads or {}, failing, views),
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
    assert gate.WAKE_UNREAD_EVENTS == "desire gate: unread events"
    assert gate.WAKE_HELD_NOTES == "desire gate: held notes"


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

    lines += [
        reading_line("r-000001", "e-000000", t0 + timedelta(hours=18)),
        reading_line("r-000002", "e-000001", t0 + timedelta(hours=18)),
    ]
    write_jsonl(state_dir / "events.jsonl", lines)

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

    lines += [
        reading_line("r-000001", "e-000000", t0 + timedelta(hours=18)),
        reading_line("r-000002", "e-000001", t0 + timedelta(hours=18)),
    ]
    write_jsonl(state_dir / "events.jsonl", lines)
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
            reading_line("r-000001", "e-000001", now),
            retraction_line("e-000002", now),
        ],
    )

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


def test_the_first_run_deletes_the_monitor_leftovers(state_dir, at):
    now = at("2026-08-25T12:00:00+09:00")
    (state_dir / "monitor.json").write_text("{}", encoding="utf-8")
    (state_dir / "ticks.jsonl").write_text('{"at": 1}\n', encoding="utf-8")

    assert gate.run(now) == NO_WAKE

    assert not (state_dir / "monitor.json").exists()
    assert not (state_dir / "ticks.jsonl").exists()


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
                {"url": "https://github.com/owner/YUI/pull/1", "headRefName": f"{BRANCH}a", "mergedAt": None},
                {
                    "url": "https://github.com/owner/YUI/pull/2",
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
    }


def test_a_new_agent_pull_request_is_recorded_exactly_once(state_dir, at, tmp_path, state_helpers):
    _, _, read_json, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    derive(state_dir, now, tmp_path)

    payloads = {
        ("pr", "owner/YUI"): [
            {"url": "https://github.com/owner/YUI/pull/3", "headRefName": f"{BRANCH}c", "mergedAt": None}
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


def test_a_pull_request_outside_the_agent_branch_prefix_is_never_recorded(
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
                    "headRefName": "feat/other",
                    "mergedAt": "2026-08-25T11:00:00Z",
                }
            ]
        },
    )

    assert read_json(state_dir / "artefacts.json")["seen"]["pr"] == []


def test_an_issue_without_the_marker_is_never_recorded(state_dir, at, tmp_path, state_helpers):
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
                {"url": "https://github.com/owner/YUI/pull/6", "headRefName": f"{BRANCH}e", "mergedAt": None}
            ]
        },
        failing=("issue",),
    )

    failures = audited(state_dir, "derive_failed")
    assert [(event["source"], event["repo"]) for event in failures] == [("issue", "owner/YUI")]
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

    fresh = {"url": "https://github.com/owner/YUI/pull/2", "headRefName": f"{BRANCH}b", "mergedAt": None}
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
            {"url": "https://github.com/owner/YUI/pull/7", "headRefName": f"{BRANCH}f", "mergedAt": None}
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
    healthy = {"url": "https://github.com/owner/YUI/pull/8", "headRefName": f"{BRANCH}g", "mergedAt": None}

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
    healthy = {"url": "https://github.com/owner/YUI/pull/9", "headRefName": f"{BRANCH}h", "mergedAt": None}

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
    listed = {"url": url, "headRefName": f"{BRANCH}i", "mergedAt": None}
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
    listed = {"url": url, "headRefName": f"{BRANCH}j", "mergedAt": None}
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
                {"url": 12, "headRefName": f"{BRANCH}broken", "mergedAt": None},
                {"url": url, "headRefName": f"{BRANCH}good", "mergedAt": None},
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

    def probe_lock(args):
        def take():
            with desire_store.state_lock(state_dir):
                acquired.append(args[0])

        worker = threading.Thread(target=take, daemon=True)
        worker.start()
        worker.join(timeout=5)
        assert not worker.is_alive(), "the gate held the state lock while reading a source"
        return "[]"

    monkeypatch.setattr(gate, "run_gh", probe_lock)

    gate.run(now)

    assert acquired == ["pr", "issue"]


def test_gate_run_derives_from_the_profile_and_stays_silent_when_a_source_fails(
    state_dir, at, isolated_profile, monkeypatch, state_helpers
):
    _, _, read_json, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    profile = isolated_profile
    workspace = profile / "workspace"
    workspace.mkdir(parents=True)
    git_repo(workspace, "YUI", "https://github.com/owner/YUI.git")

    def failing_gh(args):
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

    assert gate.workspace_repos(workspace) == ["owner/YUI", "owner/memory_layer"]


def test_workspace_repos_tolerates_a_missing_workspace(tmp_path):
    assert gate.workspace_repos(tmp_path / "absent") == []


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
