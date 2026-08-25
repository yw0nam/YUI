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
    rust_ingress_fixture = json.loads(
        '{"signals":[{"id":1}],"envelope":{"source":"n8n",'
        '"event_type":"workflow_done","delivery":"batched","event_id":"run-8812",'
        '"occurred_at":1787449000000,"extra":{"opaque":true}}}'
    )
    assert set(body) == set(rust_ingress_fixture)
    assert set(body["envelope"]) == set(rust_ingress_fixture["envelope"]) - {"extra"}
    assert body["signals"] == [{"kind": "desire", "note": "I want to explore"}]
    assert body["envelope"] == {
        "source": "natsume-desire",
        "event_type": "desire.impulse",
        "delivery": "immediate",
        "event_id": body["envelope"]["event_id"],
        "occurred_at": 1787628896000,
    }
    assert len(body["envelope"]["event_id"]) == 36


def test_action_and_monitor_share_budget_caps():
    assert act.CAPS is desire_state.CAPS
    assert desire_state.CAPS == {"signals": 3, "issues": 2, "self_comments": 1}


def test_satisfy_prints_event_and_reward(state_dir, at, capsys):
    result = act.main(
        ["satisfy", "learned", "--why", "understood reward shaping"],
        now=at("2026-08-25T12:00:00+09:00"),
    )

    captured = capsys.readouterr()
    assert result == 0
    assert captured.out == "satisfied learned reward=0.1004\n"
    assert captured.err == ""


def test_satisfy_cap_exits_one_with_clear_refusal(state_dir, at, capsys):
    now = at("2026-08-25T12:00:00+09:00")
    for index in range(3):
        assert act.main(["satisfy", "progressed", "--why", f"step {index}"], now=now) == 0
    capsys.readouterr()

    assert act.main(["satisfy", "progressed", "--why", "extra step"], now=now) == 1

    captured = capsys.readouterr()
    assert captured.out == ""
    assert captured.err == "over budget: progressed daily cap is 3\n"


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

    remaining = desire_state.read_jsonl(state_dir / "outbox.jsonl")
    assert [item["id"] for item in remaining] == ["keep"]
    assert read_jsonl(state_dir / "audit.jsonl")[-1] == {
        "at": now.isoformat(),
        "event": "outbox_released",
        "id": "gone",
        "why": "no longer true",
    }


def test_outbox_release_unknown_id_exits_one(state_dir, at, capsys):
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)

    assert act.main(["outbox", "--release", "missing"], now=now) == 1
    assert capsys.readouterr().err.strip() == "unknown outbox item"


def test_outbox_list_and_release_are_mutually_exclusive(state_dir, at):
    import pytest

    with pytest.raises(SystemExit):
        act.main(["outbox", "--list", "--release", "x"], now=at("2026-08-25T12:00:00+09:00"))


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

    assert act.main(["outbox", "--release", "a"], now=now) == 0

    lines = (state_dir / "outbox.jsonl").read_text(encoding="utf-8").splitlines()
    assert lines == ["{malformed}", valid_b]


def test_feedback_get_set_and_outbox_list(state_dir, at, state_helpers, capsys):
    _, write_jsonl, _, read_jsonl = state_helpers
    now = at("2026-08-25T12:00:00+09:00")
    desire_state.bootstrap(now)
    changed = "2026-08-25T11:30:00+09:00"
    assert act.main(["feedback", "--set", changed], now=now) == 0
    audit_after_set = read_jsonl(state_dir / "audit.jsonl")
    assert act.main(["feedback", "--get"], now=now) == 0
    assert capsys.readouterr().out.strip() == changed
    assert read_jsonl(state_dir / "audit.jsonl") == audit_after_set
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
    assert read_jsonl(state_dir / "audit.jsonl") == audit_after_set


def test_feedback_set_bad_date_returns_one_line_error(state_dir, at, capsys):
    result = act.main(
        ["feedback", "--set", "not-a-date"],
        now=at("2026-08-25T12:00:00+09:00"),
    )

    captured = capsys.readouterr()
    assert result == 1
    assert captured.out == ""
    assert captured.err.strip()
    assert len(captured.err.splitlines()) == 1
    assert "Traceback" not in captured.err
