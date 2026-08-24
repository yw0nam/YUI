import json
from urllib.error import URLError

import act
import desire_state


class Response:
    def __init__(self, status=204):
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


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
    assert body == {
        "signals": [{"kind": "desire", "note": "I want to explore"}],
        "envelope": {
            "source": "natsume-desire",
            "event_type": "desire.impulse",
            "delivery": "immediate",
            "event_id": body["envelope"]["event_id"],
            "occurred_at": 1787628896000,
        },
    }
    assert len(body["envelope"]["event_id"]) == 36


def test_fourth_signal_is_blocked_without_post_and_queued(state_dir, at, state_helpers, capsys):
    write_json, _, read_json, read_jsonl = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    write_json(
        state_dir / "budget.json",
        {"date": "2026-08-25", "signals": 3, "issues": 0, "self_comments": 0, "pending": {}},
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


def test_signal_refund_does_not_decrement_new_date(state_dir, at, state_helpers):
    write_json, _, read_json, _ = state_helpers
    now = at("2026-08-25T23:59:59+09:00")

    def reset_during_post(*args, **kwargs):
        write_json(
            state_dir / "budget.json",
            {"date": "2026-08-26", "signals": 2, "issues": 0, "self_comments": 0, "pending": {}},
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
        {"date": "2026-08-25", "signals": 3, "issues": 2, "self_comments": 1, "pending": {}},
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
        {"date": "2026-08-25", "signals": 0, "issues": 2, "self_comments": 0, "pending": {}},
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


def test_feedback_get_set_and_outbox_list(state_dir, at, state_helpers, capsys):
    _, write_jsonl, _, _ = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    changed = "2026-08-25T11:30:00+09:00"
    assert act.main(["feedback", "--set", changed], now=now) == 0
    assert act.main(["feedback", "--get"], now=now) == 0
    assert capsys.readouterr().out.strip() == changed
    item = {
        "id": "one",
        "created_at": now.isoformat(),
        "note": "n",
        "blocked_by": "budget",
        "surfaced_at": None,
    }
    write_jsonl(state_dir / "outbox.jsonl", [item])
    assert act.main(["outbox", "--list"], now=now) == 0
    assert json.loads(capsys.readouterr().out) == [item]
