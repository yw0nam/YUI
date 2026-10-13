import json
from datetime import timedelta
from urllib.error import URLError

import pytest
from conftest import AGENT_NAME

import act
import desire_events
import desire_state
import desire_store


class Response:
    def __init__(self, status=204):
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def test_act_reports_a_missing_agent_name_instead_of_signalling(state_dir, at, monkeypatch, capsys):
    monkeypatch.delenv("DESIRE_AGENT_NAME", raising=False)

    exit_code = act.main(["signal", "--note", "hello"], now=at("2026-08-25T12:00:00+09:00"))

    assert exit_code == 1
    assert "DESIRE_AGENT_NAME" in capsys.readouterr().err
    assert list(state_dir.iterdir()) == []


def test_signal_post_body_matches_ingress_contract(state_dir, at, monkeypatch):
    now = at("2026-08-25T12:34:56+09:00")
    calls = []

    def opener(request, timeout):
        calls.append((request, timeout))
        return Response()

    monkeypatch.setenv("YUI_SIGNALS_URL", "http://example.test/signals")
    assert act.main(["signal", "--note", "I want to explore"], now=now, opener=opener) == 0

    request, timeout = calls[0]
    body = json.loads(request.data)
    assert request.full_url == "http://example.test/signals"
    assert request.method == "POST"
    assert request.headers["Content-type"] == "application/json"
    assert timeout == 10
    rust_ingress_fixture = json.loads(
        '{"signals":[{"id":1}],"envelope":{"source":"n8n",'
        '"event_type":"workflow_done","delivery":"batched","event_id":"run-8812",'
        '"occurred_at":1787449000000,"extra":{"opaque":true}}}'
    )
    assert set(body) == set(rust_ingress_fixture)
    assert set(body["envelope"]) == set(rust_ingress_fixture["envelope"]) - {"extra"}
    assert body["signals"] == [{"kind": "desire", "note": "I want to explore"}]
    assert body["envelope"] == {
        "source": f"{AGENT_NAME}-desire",
        "event_type": "desire.impulse",
        "delivery": "immediate",
        "event_id": body["envelope"]["event_id"],
        "occurred_at": 1787628896000,
    }
    assert len(body["envelope"]["event_id"]) == 36


def test_action_and_monitor_share_budget_caps():
    assert act.CAPS is desire_state.CAPS
    assert desire_state.CAPS == {
        "signals": 3,
        "issues": 2,
        "self_comments": 1,
        "prs": 0,
    }


def test_signal_defaults_to_yui_agent_ingress_port(state_dir, at, monkeypatch):
    now = at("2026-08-25T12:34:56+09:00")
    calls = []
    monkeypatch.delenv("YUI_SIGNALS_URL", raising=False)

    def opener(request, timeout):
        calls.append((request, timeout))
        return Response()

    assert act.main(["signal", "--note", "I want to explore"], now=now, opener=opener) == 0
    assert calls[0][0].full_url == "http://127.0.0.1:8770/signals"


def test_fourth_signal_is_blocked_without_post_and_queued(state_dir, at, state_helpers, capsys):
    write_json, _, read_json, read_jsonl = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    write_json(
        state_dir / "budget.json",
        {"date": "2026-08-25", "signals": 3, "issues": 0, "self_comments": 0, "prs": 0, "pending": {}},
    )
    calls = []

    assert act.main(["signal", "--note", "pent up"], now=now, opener=lambda *a, **k: calls.append(a)) == 1

    assert calls == []
    assert capsys.readouterr().err.strip() == "over budget"
    assert read_json(state_dir / "budget.json")["signals"] == 3
    item = read_jsonl(state_dir / "outbox.jsonl")[-1]
    assert item["note"] == "pent up"
    assert item["blocked_by"] == "budget"
    assert item["surfaced_at"] is None


def test_signal_post_failure_refunds_and_queues_error(state_dir, at, state_helpers, capsys):
    _, _, read_json, read_jsonl = state_helpers
    now = at("2026-08-25T12:00:00+09:00")

    def failing(*args, **kwargs):
        raise URLError("offline")

    assert act.main(["signal", "--note", "try later"], now=now, opener=failing) == 1

    assert capsys.readouterr().err.strip() == "signal delivery failed: offline"
    assert read_json(state_dir / "budget.json")["signals"] == 0
    item = read_jsonl(state_dir / "outbox.jsonl")[-1]
    assert (item["note"], item["blocked_by"], item["surfaced_at"]) == ("try later", "error", None)
    assert (item["attempts"], item["last_failed_at"]) == (1, now.isoformat())
    assert read_json(state_dir / "transport.json") == {
        "state": "down",
        "since": now.isoformat(),
        "failed": 1,
        "last_checked_at": now.isoformat(),
        "source": "delivery",
    }


def test_signal_success_records_transport_up(state_dir, at, state_helpers):
    _, _, read_json, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")

    assert act.main(["signal", "--note", "hello"], now=now, opener=lambda *a, **k: Response()) == 0

    assert read_json(state_dir / "transport.json") == {
        "state": "up",
        "since": now.isoformat(),
        "failed": 0,
        "last_checked_at": now.isoformat(),
        "source": "delivery",
    }


def pent_up(item_id, created_at, note="pent up", **extra):
    return {
        "id": item_id,
        "created_at": created_at.isoformat(),
        "note": note,
        "blocked_by": "error",
        "surfaced_at": None,
        **extra,
    }


def test_outbox_send_success_removes_item_audits_and_marks_transport_up(state_dir, at, state_helpers):
    _, write_jsonl, read_json, read_jsonl = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    write_jsonl(state_dir / "outbox.jsonl", [pent_up("keep", now, "other"), pent_up("one", now, attempts=2)])
    calls = []

    def opener(request, timeout):
        calls.append(json.loads(request.data))
        return Response()

    assert act.main(["outbox", "--send", "one"], now=now, opener=opener) == 0

    assert calls[0]["signals"] == [{"kind": "desire", "note": "pent up"}]
    assert [item["id"] for item in read_jsonl(state_dir / "outbox.jsonl")] == ["keep"]
    assert read_json(state_dir / "budget.json")["signals"] == 1
    sent = read_jsonl(state_dir / "audit.jsonl")[-1]
    assert sent == {
        "at": now.isoformat(),
        "event": "signal_sent",
        "event_id": sent["event_id"],
        "note": "pent up",
        "outbox_id": "one",
    }
    assert read_json(state_dir / "transport.json")["state"] == "up"


def test_outbox_send_failure_updates_the_same_item_in_place(state_dir, at, state_helpers, capsys):
    _, write_jsonl, read_json, read_jsonl = state_helpers
    created = at("2026-08-25T06:00:00+09:00")
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    write_jsonl(state_dir / "outbox.jsonl", [pent_up("legacy", created)])

    def failing(*args, **kwargs):
        raise URLError("offline")

    assert act.main(["outbox", "--send", "legacy"], now=now, opener=failing) == 1

    assert capsys.readouterr().err.strip() == "signal delivery failed: offline"
    items = read_jsonl(state_dir / "outbox.jsonl")
    assert len(items) == 1
    assert items[0] == {
        **pent_up("legacy", created),
        "attempts": 2,
        "last_failed_at": now.isoformat(),
    }
    assert read_json(state_dir / "budget.json")["signals"] == 0
    failed = read_jsonl(state_dir / "audit.jsonl")[-1]
    assert (failed["event"], failed["outbox_id"], failed["reason"]) == ("signal_failed", "legacy", "offline")
    assert read_json(state_dir / "transport.json") == {
        "state": "down",
        "since": now.isoformat(),
        "failed": 1,
        "last_checked_at": now.isoformat(),
        "source": "delivery",
    }

    assert act.main(["outbox", "--send", "legacy"], now=now, opener=failing) == 1
    assert read_jsonl(state_dir / "outbox.jsonl")[0]["attempts"] == 3
    assert read_json(state_dir / "transport.json")["failed"] == 2


def test_outbox_send_unknown_id_exits_three(state_dir, at, capsys):
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)

    assert act.main(["outbox", "--send", "missing"], now=now, opener=lambda *a, **k: Response()) == 3
    assert capsys.readouterr().err.strip() == "unknown outbox item"


def test_outbox_send_over_budget_keeps_item_and_skips_post(state_dir, at, state_helpers, capsys):
    write_json, write_jsonl, read_json, read_jsonl = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    write_json(
        state_dir / "budget.json",
        {"date": "2026-08-25", "signals": 3, "issues": 0, "self_comments": 0, "prs": 0, "pending": {}},
    )
    write_jsonl(state_dir / "outbox.jsonl", [pent_up("one", now)])
    calls = []

    assert act.main(["outbox", "--send", "one"], now=now, opener=lambda *a, **k: calls.append(a)) == 1

    assert calls == []
    assert capsys.readouterr().err.strip() == "over budget"
    items = read_jsonl(state_dir / "outbox.jsonl")
    assert [(item["id"], item["blocked_by"]) for item in items] == [("one", "budget")]
    assert read_json(state_dir / "budget.json")["signals"] == 3
    blocked = read_jsonl(state_dir / "audit.jsonl")[-1]
    assert (blocked["event"], blocked["blocked_by"], blocked["outbox_id"]) == (
        "signal_blocked",
        "budget",
        "one",
    )


def test_outbox_send_preserves_malformed_lines(state_dir, at):
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    valid = json.dumps(pent_up("a", now))
    (state_dir / "outbox.jsonl").write_text(f"{{malformed}}\n{valid}\n", encoding="utf-8")

    def failing(*args, **kwargs):
        raise URLError("offline")

    assert act.main(["outbox", "--send", "a"], now=now, opener=failing) == 1

    lines = (state_dir / "outbox.jsonl").read_text(encoding="utf-8").splitlines()
    assert lines[0] == "{malformed}"
    assert json.loads(lines[1])["attempts"] == 2


def test_signal_refund_does_not_decrement_new_date(state_dir, at, state_helpers):
    write_json, _, read_json, _ = state_helpers
    now = at("2026-08-25T23:59:59+09:00")

    def reset_during_post(*args, **kwargs):
        write_json(
            state_dir / "budget.json",
            {"date": "2026-08-26", "signals": 2, "issues": 0, "self_comments": 0, "prs": 0, "pending": {}},
        )
        raise URLError("late failure")

    assert act.main(["signal", "--note", "cross midnight"], now=now, opener=reset_during_post) == 1
    assert read_json(state_dir / "budget.json")["signals"] == 2


def test_act_normalizes_budget_at_kst_midnight(state_dir, at, state_helpers):
    write_json, _, read_json, _ = state_helpers
    before = at("2026-08-25T23:59:59+09:00")
    desire_state.bootstrap(before)
    write_json(
        state_dir / "budget.json",
        {"date": "2026-08-25", "signals": 3, "issues": 2, "self_comments": 1, "prs": 0, "pending": {}},
    )

    assert act.main(["issue", "--reserve"], now=at("2026-08-26T00:00:00+09:00")) == 0

    budget = read_json(state_dir / "budget.json")
    assert budget["date"] == "2026-08-26"
    assert (budget["signals"], budget["issues"], budget["self_comments"]) == (0, 1, 0)


def test_issue_at_cap_is_rejected(state_dir, at, state_helpers, capsys):
    write_json, _, _, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    write_json(
        state_dir / "budget.json",
        {"date": "2026-08-25", "signals": 0, "issues": 2, "self_comments": 0, "prs": 0, "pending": {}},
    )
    assert act.main(["issue", "--reserve"], now=now) == 1
    assert capsys.readouterr().err.strip() == "over budget"


def test_reserve_release_round_trip_uses_printed_id(state_dir, at, state_helpers, capsys):
    _, _, read_json, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")

    assert act.main(["issue", "--reserve"], now=now) == 0
    reservation = capsys.readouterr().out.strip()
    assert len(reservation) == 36
    assert read_json(state_dir / "budget.json")["issues"] == 1

    assert act.main(["issue", "--release", reservation], now=now) == 0
    budget = read_json(state_dir / "budget.json")
    assert budget["issues"] == 0
    assert reservation not in budget["pending"]


def test_unknown_commit_and_release_are_rejected(state_dir, at, capsys):
    now = at("2026-08-25T12:00:00+09:00")
    assert act.main(["issue", "--commit", "unknown", "--url", "https://example.test/1"], now=now) == 1
    assert capsys.readouterr().err.strip() == "unknown reservation"
    assert act.main(["issue", "--release", "unknown"], now=now) == 1
    assert capsys.readouterr().err.strip() == "unknown reservation"


def test_yesterday_pending_survives_reset_and_can_commit(state_dir, at, state_helpers):
    write_json, _, read_json, read_jsonl = state_helpers
    now = at("2026-08-26T00:00:00+09:00")
    desire_state.bootstrap(now)
    write_json(
        state_dir / "budget.json",
        {
            "date": "2026-08-25",
            "signals": 3,
            "issues": 2,
            "self_comments": 1,
            "prs": 0,
            "pending": {"old": {"kind": "issue", "date": "2026-08-25"}},
        },
    )

    assert act.main(["issue", "--commit", "old", "--url", "https://example.test/issues/1"], now=now) == 0

    budget = read_json(state_dir / "budget.json")
    assert budget["issues"] == 0
    assert budget["pending"] == {}
    assert read_jsonl(state_dir / "audit.jsonl")[-1] == {
        "at": now.isoformat(),
        "event": "issue_filed",
        "url": "https://example.test/issues/1",
        "reservation_id": "old",
    }


def test_yesterday_pending_release_does_not_decrement_today(state_dir, at, state_helpers):
    write_json, _, read_json, _ = state_helpers
    now = at("2026-08-26T12:00:00+09:00")
    desire_state.bootstrap(now)
    write_json(
        state_dir / "budget.json",
        {
            "date": "2026-08-26",
            "signals": 0,
            "issues": 1,
            "self_comments": 0,
            "prs": 0,
            "pending": {"old": {"kind": "issue", "date": "2026-08-25"}},
        },
    )
    assert act.main(["issue", "--release", "old"], now=now) == 0
    budget = read_json(state_dir / "budget.json")
    assert budget["issues"] == 1
    assert budget["pending"] == {}


def test_comment_uses_its_own_one_per_day_budget(state_dir, at, capsys):
    now = at("2026-08-25T12:00:00+09:00")
    assert act.main(["comment", "--reserve"], now=now) == 0
    capsys.readouterr()
    assert act.main(["comment", "--reserve"], now=now) == 1
    assert capsys.readouterr().err.strip() == "over budget"


def test_pr_reserve_is_refused_at_a_zero_cap(state_dir, at, state_helpers, capsys):
    _, _, _, read_jsonl = state_helpers
    now = at("2026-08-25T12:00:00+09:00")

    assert act.main(["pr", "--reserve"], now=now) == 1

    assert capsys.readouterr().err.strip() == "over budget"
    blocked = read_jsonl(state_dir / "audit.jsonl")[-1]
    assert (blocked["event"], blocked["kind"]) == ("reservation_blocked", "pr")


def test_a_budget_carrying_a_dispatch_counter_loads_and_drops_it(state_dir, at, state_helpers):
    write_json, _, read_json, read_jsonl = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    stale = {"stale": {"kind": "dispatch", "date": "2026-08-25"}}
    budget = {"date": "2026-08-25", "signals": 0, "issues": 0, "self_comments": 0, "prs": 0}
    write_json(state_dir / "budget.json", {**budget, "dispatches": 1, "pending": stale})

    assert act.main(["issue", "--reserve"], now=now) == 0

    rebuilt = read_json(state_dir / "budget.json")
    assert "dispatches" not in rebuilt
    assert {key: rebuilt[key] for key in budget} == {**budget, "issues": 1}
    assert rebuilt["pending"]["stale"] == stale["stale"]
    assert not list(state_dir.glob("budget.json.corrupt-*"))
    assert not any(
        event["event"] == "state_corrupt_recovered" for event in read_jsonl(state_dir / "audit.jsonl")
    )


def test_report_posts_its_own_kind_without_touching_the_signal_budget(state_dir, at, state_helpers):
    _, _, read_json, read_jsonl = state_helpers
    now = at("2026-08-25T21:00:00+09:00")
    calls = []

    def opener(request, timeout):
        calls.append(request)
        return Response()

    assert act.main(["report", "--note", "one pull request today"], now=now, opener=opener) == 0

    body = json.loads(calls[0].data)
    assert body["signals"] == [{"kind": "report", "note": "one pull request today"}]
    assert body["envelope"]["source"] == f"{AGENT_NAME}-desire"
    assert body["envelope"]["event_type"] == "desire.report"
    assert read_json(state_dir / "budget.json") == {
        "date": "2026-08-25",
        "signals": 0,
        "issues": 0,
        "self_comments": 0,
        "prs": 0,
        "pending": {},
    }
    assert (state_dir / "outbox.jsonl").read_bytes() == b""
    sent = read_jsonl(state_dir / "audit.jsonl")[-1]
    assert (sent["event"], sent["note"]) == ("report_sent", "one pull request today")
    assert sent["event_id"] == body["envelope"]["event_id"]
    assert read_json(state_dir / "transport.json")["state"] == "up"


def test_report_failure_audits_and_keeps_the_signal_budget(state_dir, at, state_helpers, capsys):
    write_json, _, read_json, read_jsonl = state_helpers
    now = at("2026-08-25T21:00:00+09:00")
    desire_state.bootstrap(now)
    write_json(
        state_dir / "budget.json",
        {"date": "2026-08-25", "signals": 2, "issues": 0, "self_comments": 0, "prs": 0, "pending": {}},
    )

    assert act.main(["report", "--note", "nothing reached you"], now=now) == 1

    assert capsys.readouterr().err.startswith("report delivery failed: ")
    assert read_json(state_dir / "budget.json")["signals"] == 2
    assert (state_dir / "outbox.jsonl").read_bytes() == b""
    failed = read_jsonl(state_dir / "audit.jsonl")[-1]
    assert (failed["event"], failed["note"]) == ("report_failed", "nothing reached you")
    assert failed["reason"]
    assert read_json(state_dir / "transport.json")["state"] == "down"


@pytest.mark.parametrize("counter", ["signals", "issues", "self_comments", "prs"])
def test_invalid_budget_counter_is_quarantined_and_rebuilt(state_dir, at, state_helpers, counter):
    write_json, _, read_json, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    budget = {"date": "2026-08-25", "signals": 0, "issues": 0, "self_comments": 0, "prs": 0}
    write_json(state_dir / "budget.json", {**budget, counter: "many", "pending": {}})

    assert act.main(["issue", "--reserve"], now=now) == 0

    rebuilt = read_json(state_dir / "budget.json")
    assert {key: rebuilt[key] for key in budget} == {**budget, "issues": 1}
    assert len(rebuilt["pending"]) == 1
    assert len(list(state_dir.glob("budget.json.corrupt-*"))) == 1


def test_outbox_release_removes_item_and_audits(state_dir, at, state_helpers):
    _, write_jsonl, _, read_jsonl = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    write_jsonl(
        state_dir / "outbox.jsonl",
        [
            {
                "id": "keep",
                "created_at": now.isoformat(),
                "note": "keep me",
                "blocked_by": "budget",
                "surfaced_at": None,
            },
            {
                "id": "gone",
                "created_at": now.isoformat(),
                "note": "release me",
                "blocked_by": "budget",
                "surfaced_at": None,
            },
        ],
    )

    assert act.main(["outbox", "--release", "gone", "--why", "no longer true"], now=now) == 0

    remaining = desire_store.read_jsonl(state_dir / "outbox.jsonl")
    assert [item["id"] for item in remaining] == ["keep"]
    assert read_jsonl(state_dir / "audit.jsonl")[-1] == {
        "at": now.isoformat(),
        "event": "outbox_released",
        "id": "gone",
        "why": "no longer true",
    }


def test_outbox_release_unknown_id_exits_three(state_dir, at, capsys):
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)

    assert act.main(["outbox", "--release", "missing", "--why", "gone"], now=now) == 3
    assert capsys.readouterr().err.strip() == "unknown outbox item"


def test_outbox_list_and_release_are_mutually_exclusive(state_dir, at):
    import pytest

    with pytest.raises(SystemExit):
        act.main(["outbox", "--list", "--release", "x", "--why", "both"], now=at("2026-08-25T12:00:00+09:00"))


def test_outbox_release_preserves_malformed_lines_and_leaves_others_untouched(state_dir, at):
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    valid_a = json.dumps(
        {"id": "a", "created_at": now.isoformat(), "note": "a", "blocked_by": "budget", "surfaced_at": None}
    )
    valid_b = json.dumps(
        {"id": "b", "created_at": now.isoformat(), "note": "b", "blocked_by": "budget", "surfaced_at": None}
    )
    (state_dir / "outbox.jsonl").write_text(f"{valid_a}\n{{malformed}}\n{valid_b}\n", encoding="utf-8")

    assert act.main(["outbox", "--release", "a", "--why", "no longer true"], now=now) == 0

    lines = (state_dir / "outbox.jsonl").read_text(encoding="utf-8").splitlines()
    assert lines == ["{malformed}", valid_b]


def test_outbox_list_prints_the_active_items_without_auditing(state_dir, at, state_helpers, capsys):
    _, write_jsonl, _, read_jsonl = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    item = {
        "id": "one",
        "created_at": now.isoformat(),
        "note": "n",
        "blocked_by": "budget",
        "surfaced_at": None,
    }
    write_jsonl(state_dir / "outbox.jsonl", [item])
    audit_before = read_jsonl(state_dir / "audit.jsonl")
    assert act.main(["outbox", "--list"], now=now) == 0
    assert json.loads(capsys.readouterr().out) == [item]
    assert read_jsonl(state_dir / "audit.jsonl") == audit_before


def test_http_error_status_does_not_mark_transport_down(state_dir, at, state_helpers, capsys):
    _, _, read_json, read_jsonl = state_helpers
    now = at("2026-08-25T12:00:00+09:00")

    assert act.main(["signal", "--note", "rejected"], now=now, opener=lambda *a, **k: Response(500)) == 1

    assert capsys.readouterr().err.strip() == "signal delivery failed: HTTP 500"
    assert read_json(state_dir / "budget.json")["signals"] == 0
    assert read_jsonl(state_dir / "outbox.jsonl")[-1]["blocked_by"] == "error"
    assert read_json(state_dir / "transport.json") == {
        "state": "up",
        "since": now.isoformat(),
        "failed": 0,
        "last_checked_at": now.isoformat(),
        "source": "delivery",
    }


def test_corrupt_transport_json_is_quarantined_and_note_survives(state_dir, at, state_helpers, capsys):
    _, _, read_json, read_jsonl = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    (state_dir / "transport.json").write_text("[]", encoding="utf-8")

    def failing(*args, **kwargs):
        raise URLError("offline")

    assert act.main(["signal", "--note", "keep me"], now=now, opener=failing) == 1

    assert read_json(state_dir / "budget.json")["signals"] == 0
    item = read_jsonl(state_dir / "outbox.jsonl")[-1]
    assert item["note"] == "keep me"
    assert read_json(state_dir / "transport.json")["state"] == "down"
    assert list(state_dir.glob("transport.json.corrupt-*"))
    assert any(
        event["event"] == "state_corrupt_recovered" and event["file"] == "transport.json"
        for event in read_jsonl(state_dir / "audit.jsonl")
    )


def test_outbox_list_and_send_exclude_expired_items(state_dir, at, state_helpers, capsys):
    _, write_jsonl, _, read_jsonl = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    write_jsonl(
        state_dir / "outbox.jsonl",
        [pent_up("expired", now - timedelta(hours=48)), pent_up("active", now)],
    )

    assert act.main(["outbox", "--list"], now=now) == 0
    assert [item["id"] for item in json.loads(capsys.readouterr().out)] == ["active"]

    assert act.main(["outbox", "--send", "expired"], now=now, opener=lambda *a, **k: Response()) == 3
    assert capsys.readouterr().err.strip() == "unknown outbox item"
    assert [item["id"] for item in read_jsonl(state_dir / "outbox.jsonl")] == ["expired", "active"]


def test_empty_signals_url_env_falls_back_to_default(state_dir, at, monkeypatch):
    now = at("2026-08-25T12:00:00+09:00")
    monkeypatch.setenv("YUI_SIGNALS_URL", "")
    calls = []

    def opener(request, timeout):
        calls.append(request.full_url)
        return Response()

    assert act.main(["signal", "--note", "hello"], now=now, opener=opener) == 0
    assert calls == ["http://127.0.0.1:8770/signals"]


def test_outbox_send_failure_after_concurrent_release_audits_without_outbox_id(
    state_dir, at, state_helpers, capsys
):
    _, write_jsonl, read_json, read_jsonl = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    write_jsonl(state_dir / "outbox.jsonl", [pent_up("gone", now)])

    def release_then_fail(*args, **kwargs):
        assert act.main(["outbox", "--release", "gone", "--why", "raced"], now=now) == 0
        raise URLError("offline")

    assert act.main(["outbox", "--send", "gone"], now=now, opener=release_then_fail) == 1

    assert read_json(state_dir / "budget.json")["signals"] == 0
    assert read_jsonl(state_dir / "outbox.jsonl") == []
    failed = [event for event in read_jsonl(state_dir / "audit.jsonl") if event["event"] == "signal_failed"]
    assert len(failed) == 1
    assert "outbox_id" not in failed[0]


def test_signal_success_stamps_last_signal_at(state_dir, at, state_helpers):
    _, _, read_json, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")

    assert act.main(["signal", "--note", "hello"], now=now, opener=lambda *a, **k: Response()) == 0

    assert read_json(state_dir / "drives.json")["last_signal_at"] == now.isoformat()


def test_failed_signal_leaves_last_signal_at_empty(state_dir, at, state_helpers):
    _, _, read_json, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")

    def failing(*args, **kwargs):
        raise URLError("offline")

    assert act.main(["signal", "--note", "try later"], now=now, opener=failing) == 1

    assert read_json(state_dir / "drives.json")["last_signal_at"] is None


def test_outbox_send_success_stamps_last_signal_at(state_dir, at, state_helpers):
    _, write_jsonl, read_json, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    write_jsonl(state_dir / "outbox.jsonl", [pent_up("one", now)])

    assert act.main(["outbox", "--send", "one"], now=now, opener=lambda *a, **k: Response()) == 0

    drives = read_json(state_dir / "drives.json")
    assert drives["last_signal_at"] == now.isoformat()
    assert drives["last_signal_answered_at"] is None


def test_delivery_records_transport_with_the_delivery_source(state_dir, at, state_helpers):
    _, _, read_json, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")

    assert act.main(["signal", "--note", "hello"], now=now, opener=lambda *a, **k: Response()) == 0

    assert read_json(state_dir / "transport.json")["source"] == "delivery"


def test_outbox_repeat_keeps_the_item_unchanged_and_audits(state_dir, at, state_helpers):
    _, write_jsonl, _, read_jsonl = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    stored = pent_up("one", now, attempts=2, last_failed_at=now.isoformat())
    write_jsonl(state_dir / "outbox.jsonl", [stored])

    assert act.main(["outbox", "--repeat", "one", "--why", "still true"], now=now) == 0

    assert read_jsonl(state_dir / "outbox.jsonl") == [stored]
    assert read_jsonl(state_dir / "audit.jsonl")[-1] == {
        "at": now.isoformat(),
        "event": "outbox_disposition",
        "id": "one",
        "kind": "repeat",
        "why": "still true",
    }


def test_outbox_reword_replaces_only_the_note(state_dir, at, state_helpers):
    _, write_jsonl, _, read_jsonl = state_helpers
    created = at("2026-08-25T06:00:00+09:00")
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    write_jsonl(state_dir / "outbox.jsonl", [pent_up("one", created, attempts=2, last_failed_at=None)])

    result = act.main(
        ["outbox", "--reword", "one", "--note", "said again", "--why", "the return already happened"],
        now=now,
    )

    assert result == 0
    assert read_jsonl(state_dir / "outbox.jsonl") == [
        pent_up("one", created, "said again", attempts=2, last_failed_at=None)
    ]
    assert read_jsonl(state_dir / "audit.jsonl")[-1] == {
        "at": now.isoformat(),
        "event": "outbox_disposition",
        "id": "one",
        "kind": "reword",
        "why": "the return already happened",
    }


def test_outbox_postpone_hides_the_item_from_list_and_send_until_not_before(
    state_dir, at, state_helpers, capsys
):
    _, write_jsonl, _, read_jsonl = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    write_jsonl(state_dir / "outbox.jsonl", [pent_up("one", now)])
    until = now + timedelta(hours=2)

    result = act.main(["outbox", "--postpone", "one", "--until", "2", "--why", "not the moment"], now=now)

    assert result == 0
    stored = read_jsonl(state_dir / "outbox.jsonl")[0]
    assert stored == {**pent_up("one", now), "not_before": until.isoformat()}
    assert read_jsonl(state_dir / "audit.jsonl")[-1] == {
        "at": now.isoformat(),
        "event": "outbox_disposition",
        "id": "one",
        "kind": "postpone",
        "why": "not the moment",
        "until": until.isoformat(),
    }

    assert act.main(["outbox", "--list"], now=now) == 0
    assert json.loads(capsys.readouterr().out) == [{**stored, "postponed_until": "2026-08-25 14:00"}]
    assert act.main(["outbox", "--send", "one"], now=now, opener=lambda *a, **k: Response()) == 3
    assert capsys.readouterr().err.strip() == "unknown outbox item"

    assert act.main(["outbox", "--list"], now=until) == 0
    assert json.loads(capsys.readouterr().out) == [stored]
    assert act.main(["outbox", "--send", "one"], now=until, opener=lambda *a, **k: Response()) == 0


def test_outbox_postpone_defaults_to_twenty_four_hours(state_dir, at, state_helpers):
    _, write_jsonl, _, read_jsonl = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    write_jsonl(state_dir / "outbox.jsonl", [pent_up("one", now)])

    assert act.main(["outbox", "--postpone", "one", "--why", "tomorrow"], now=now) == 0

    assert read_jsonl(state_dir / "outbox.jsonl")[0]["not_before"] == (now + timedelta(hours=24)).isoformat()


def test_outbox_release_audits_the_disposition_and_the_release(state_dir, at, state_helpers):
    _, write_jsonl, _, read_jsonl = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    write_jsonl(state_dir / "outbox.jsonl", [pent_up("one", now)])

    assert act.main(["outbox", "--release", "one", "--why", "he said it first"], now=now) == 0

    assert read_jsonl(state_dir / "outbox.jsonl") == []
    events = [value for value in read_jsonl(state_dir / "audit.jsonl") if value["event"].startswith("outbox")]
    assert events == [
        {
            "at": now.isoformat(),
            "event": "outbox_disposition",
            "id": "one",
            "kind": "release",
            "why": "he said it first",
        },
        {"at": now.isoformat(), "event": "outbox_released", "id": "one", "why": "he said it first"},
    ]


def test_every_disposition_requires_a_reason(state_dir, at, capsys):
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)

    for kind in ("--repeat", "--reword", "--postpone", "--release"):
        assert act.main(["outbox", kind, "one"], now=now) == 2
        assert capsys.readouterr().err.strip() == "--why is required for an outbox disposition"

    assert act.main(["outbox", "--reword", "one", "--why", "different words"], now=now) == 2
    assert capsys.readouterr().err.strip() == "--note is required with --reword"


def test_every_disposition_exits_three_for_an_unknown_id(state_dir, at, capsys):
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    arguments = {
        "--repeat": [],
        "--reword": ["--note", "again"],
        "--postpone": [],
        "--release": [],
    }

    for kind, extra in arguments.items():
        assert act.main(["outbox", kind, "missing", *extra, "--why", "gone"], now=now) == 3
        assert capsys.readouterr().err.strip() == "unknown outbox item"


def test_dispositions_are_mutually_exclusive(state_dir, at):
    import pytest

    with pytest.raises(SystemExit):
        act.main(
            ["outbox", "--repeat", "a", "--postpone", "a", "--why", "both"],
            now=at("2026-08-25T12:00:00+09:00"),
        )


def test_an_empty_outbox_id_exits_three_instead_of_raising(state_dir, at, capsys):
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)

    for argv in (
        ["outbox", "--release", "", "--why", "gone"],
        ["outbox", "--repeat", "", "--why", "gone"],
        ["outbox", "--send", ""],
    ):
        assert act.main(argv, now=now, opener=lambda *a, **k: Response()) == 3
        assert capsys.readouterr().err.strip() == "unknown outbox item"


def test_postpone_rejects_a_delay_that_is_not_a_positive_number_of_hours(
    state_dir, at, state_helpers, capsys
):
    _, write_jsonl, _, read_jsonl = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    write_jsonl(state_dir / "outbox.jsonl", [pent_up("one", now)])

    for value in ("0", "-5", "nan", "inf", "1e12"):
        assert act.main(["outbox", "--postpone", "one", "--until", value, "--why", "later"], now=now) == 2
        assert capsys.readouterr().err.strip() == "--until must be between 0 and 8760 hours"

    assert "not_before" not in read_jsonl(state_dir / "outbox.jsonl")[0]
    assert [value["event"] for value in read_jsonl(state_dir / "audit.jsonl")] == []


def test_a_postponed_note_can_be_found_and_released_early(state_dir, at, state_helpers, capsys):
    _, write_jsonl, _, read_jsonl = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    write_jsonl(state_dir / "outbox.jsonl", [pent_up("one", now)])
    assert act.main(["outbox", "--postpone", "one", "--until", "2", "--why", "not the moment"], now=now) == 0

    assert act.main(["outbox", "--list"], now=now) == 0
    listed = json.loads(capsys.readouterr().out)
    assert [(value["id"], value["postponed_until"]) for value in listed] == [("one", "2026-08-25 14:00")]

    assert act.main(["outbox", "--release", listed[0]["id"], "--why", "he said it first"], now=now) == 0
    assert read_jsonl(state_dir / "outbox.jsonl") == []


def exit_code(argv, now):
    try:
        return act.main(argv, now=now)
    except SystemExit as stop:
        return stop.code


def test_feel_files_an_agent_event_with_its_reading(state_dir, at, capsys):
    now = at("2026-08-25T12:00:00+09:00")

    assert (
        act.main(["feel", "--fact", " I opened a PR ", "--text", "proud", "--source-ref", "url"], now=now)
        == 0
    )

    [event] = desire_events.events_view(state_dir)
    assert capsys.readouterr().out == f"event {event['id']} reading {event['reading']['id']}\n"
    assert (event["fact"], event["source"], event["source_ref"]) == ("I opened a PR", "agent", "url")
    assert event["reading"]["text"] == "proud"


def test_feel_reads_an_existing_event_and_refuses_an_unknown_or_retracted_one(state_dir, at, capsys):
    now = at("2026-08-25T12:00:00+09:00")
    event_id = desire_events.file_event(state_dir, "issue was closed", "monitor", "url", now)
    retracted = desire_events.file_event(state_dir, "wrong", "monitor", "other", now)
    desire_events.retract(state_dir, retracted, "not mine", now)

    assert act.main(["feel", "--event", event_id, "--text", "relieved"], now=now) == 0
    [event] = desire_events.events_view(state_dir)
    assert capsys.readouterr().out == f"reading {event['reading']['id']}\n"
    assert event["reading"]["text"] == "relieved"

    assert act.main(["feel", "--event", "e-999999", "--text", "x"], now=now) == 3
    assert capsys.readouterr().err == "unknown event\n"
    assert act.main(["feel", "--event", retracted, "--text", "x"], now=now) == 3
    assert capsys.readouterr().err == f"event {retracted} is retracted\n"


@pytest.mark.parametrize(
    ("argv", "message"),
    [
        (["feel", "--fact", "x"], None),
        (["feel", "--event", "e-000001", "--fact", "x", "--text", "y"], None),
        (["feel", "--event", "e-000001", "--text", "y", "--source-ref", "r"], None),
        (["feel", "--all"], None),
        (["feel", "--list", "--text", "y"], None),
        (["feel"], None),
        (["feel", "--fact", "x", "--text", "   "], "empty --text"),
        (["feel", "--fact", " ", "--text", "y"], "empty --fact"),
        (["feel", "--fact", "x", "--text", "y", "--source-ref", ""], "empty --source-ref"),
    ],
)
def test_feel_usage_errors_exit_two_and_write_nothing(state_dir, at, capsys, argv, message):
    assert exit_code(argv, at("2026-08-25T12:00:00+09:00")) == 2

    if message is not None:
        assert capsys.readouterr().err.strip() == message
    assert desire_events.events_view(state_dir) == []
    assert not (state_dir / "events.jsonl").exists()


def test_correct_and_retract_exit_codes_and_lines(state_dir, at, capsys):
    now = at("2026-08-25T12:00:00+09:00")
    event_id = desire_events.file_event(state_dir, "issue was closd", "monitor", "url", now)
    gone = desire_events.file_event(state_dir, "wrong", "monitor", "other", now)

    assert act.main(["correct", event_id, "--fact", "issue was closed"], now=now) == 0
    assert capsys.readouterr().out == f"corrected {event_id}\n"
    assert act.main(["retract", gone, "--why", "not mine"], now=now) == 0
    assert capsys.readouterr().out == f"retracted {gone}\n"
    assert act.main(["retract", gone, "--why", "again"], now=now) == 0
    assert capsys.readouterr().out == f"already retracted {gone}\n"
    assert act.main(["correct", gone, "--fact", "x"], now=now) == 1
    assert act.main(["correct", "e-999999", "--fact", "x"], now=now) == 3
    assert act.main(["retract", "e-999999", "--why", "x"], now=now) == 3
    before = (state_dir / "events.jsonl").read_bytes()
    capsys.readouterr()

    assert act.main(["correct", event_id, "--fact", "  "], now=now) == 2
    assert capsys.readouterr().err.strip() == "empty --fact"
    assert act.main(["retract", event_id, "--why", ""], now=now) == 2
    assert capsys.readouterr().err.strip() == "empty --why"
    assert (state_dir / "events.jsonl").read_bytes() == before
    assert [event["fact"] for event in desire_events.events_view(state_dir)] == ["issue was closed"]


def test_feel_list_prints_one_line_per_event_by_time_with_ties_in_file_order(
    state_dir, at, state_helpers, capsys
):
    _, write_jsonl, _, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    write_jsonl(
        state_dir / "events.jsonl",
        [
            {"id": "e-000003", "at": "2026-08-25T03:00:00+00:00", "fact": "late", "source": "monitor"},
            {"id": "e-000001", "at": "2026-08-24T09:00:00+09:00", "fact": "tie a", "source": "agent"},
            {"id": "e-000002", "at": "2026-08-24T00:00:00+00:00", "fact": 'tie b\n"x"', "source": "monitor"},
        ],
    )
    write_jsonl(
        state_dir / "readings.jsonl",
        [{"id": "r-000001", "event_id": "e-000001", "at": "2026-08-24T10:00:00+09:00", "text": "glad"}],
    )

    assert act.main(["feel", "--list"], now=now) == 0

    assert capsys.readouterr().out.splitlines() == [
        "e-000001 2026-08-24 09:00 [agent] tie a — glad",
        'e-000002 2026-08-24 09:00 [monitor] tie b "x" — (no reading)',
        "e-000003 2026-08-25 12:00 [monitor] late — (no reading)",
    ]


def test_feel_list_shows_the_twenty_most_recent_unless_all(state_dir, at, state_helpers, capsys):
    _, write_jsonl, _, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    write_jsonl(
        state_dir / "events.jsonl",
        [
            {
                "id": f"e-{index:06x}",
                "at": (now - timedelta(hours=30 - index)).isoformat(),
                "fact": f"fact {index}",
                "source": "monitor",
            }
            for index in range(25)
        ],
    )

    assert act.main(["feel", "--list"], now=now) == 0
    shown = capsys.readouterr().out.splitlines()
    assert act.main(["feel", "--list", "--all"], now=now) == 0
    every = capsys.readouterr().out.splitlines()

    assert [line.split()[0] for line in shown] == [f"e-{index:06x}" for index in range(5, 25)]
    assert len(every) == 25
