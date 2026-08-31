"""Budget-enforced action helper for the Natsume desire integration."""

from __future__ import annotations

import argparse
import json
import os
import sys
import uuid
from datetime import datetime
from urllib import error as urllib_error
from urllib import request as urllib_request
from zoneinfo import ZoneInfo

import desire_state

KST = ZoneInfo("Asia/Seoul")
CAPS = desire_state.CAPS


def _audit(state_dir, now, event, **fields):
    desire_state.append_jsonl(state_dir / "audit.jsonl", {"at": now.isoformat(), "event": event, **fields})


def _outbox_item(note, blocked_by, now):
    failed = blocked_by == "error"
    return {
        "id": str(uuid.uuid4()),
        "created_at": now.isoformat(),
        "note": desire_state.sanitize_note(note),
        "blocked_by": blocked_by,
        "surfaced_at": None,
        "attempts": 1 if failed else 0,
        "last_failed_at": now.isoformat() if failed else None,
    }


def _normalized_state(state_dir, now):
    state = desire_state.bootstrap_locked(state_dir, now)
    budget = desire_state.normalize_budget(state["budget"], now)
    if budget != state["budget"]:
        desire_state.write_json_atomic(state_dir / "budget.json", budget)
    state["budget"] = budget
    return state


def _reserve_signal(state_dir, now):
    """Take one signal from today's budget. The caller holds the state lock."""

    budget = _normalized_state(state_dir, now)["budget"]
    if budget["signals"] >= CAPS["signals"]:
        return False
    budget["signals"] += 1
    desire_state.write_json_atomic(state_dir / "budget.json", budget)
    return True


def _refund_signal(state_dir, now, reservation_date):
    budget = _normalized_state(state_dir, now)["budget"]
    if budget["date"] == reservation_date:
        budget["signals"] = max(0, budget["signals"] - 1)
        desire_state.write_json_atomic(state_dir / "budget.json", budget)


def _deliver(note, now, opener):
    event_id = str(uuid.uuid4())
    body = {
        "signals": [{"kind": "desire", "note": note}],
        "envelope": {
            "source": "natsume-desire",
            "event_type": "desire.impulse",
            "delivery": "immediate",
            "event_id": event_id,
            "occurred_at": int(now.timestamp() * 1000),
        },
    }
    target = os.environ.get("YUI_SIGNALS_URL") or desire_state.DEFAULT_SIGNALS_URL
    outgoing = urllib_request.Request(
        target,
        data=json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    failure = None
    connected = True
    try:
        with opener(outgoing, timeout=10) as response:
            status = getattr(response, "status", 200)
            if not 200 <= status < 300:
                failure = f"HTTP {status}"
    except urllib_error.HTTPError as error:
        failure = f"HTTP {error.code}"
    except Exception as error:  # noqa: BLE001 - transport implementations may raise arbitrary errors
        connected = False
        failure = str(getattr(error, "reason", error)).replace("\r", " ").replace("\n", " ")
    return event_id, failure, connected


def _signal(note, now, opener):
    state_dir = desire_state.resolve_state_dir()
    reservation_date = now.date().isoformat()
    with desire_state.state_lock(state_dir):
        if not _reserve_signal(state_dir, now):
            desire_state.append_jsonl(state_dir / "outbox.jsonl", _outbox_item(note, "budget", now))
            _audit(state_dir, now, "signal_blocked", blocked_by="budget", note=note)
            print("over budget", file=sys.stderr)
            return 1
        _audit(state_dir, now, "signal_reserved", note=note)

    event_id, failure, connected = _deliver(note, now, opener)

    with desire_state.state_lock(state_dir):
        if failure is None:
            _audit(state_dir, now, "signal_sent", event_id=event_id, note=note)
            desire_state.record_transport(state_dir, connected, now)
            return 0
        _refund_signal(state_dir, now, reservation_date)
        desire_state.append_jsonl(state_dir / "outbox.jsonl", _outbox_item(note, "error", now))
        _audit(state_dir, now, "signal_failed", event_id=event_id, reason=failure, note=note)
        desire_state.record_transport(state_dir, connected, now)
    print(f"signal delivery failed: {failure}", file=sys.stderr)
    return 1


def _outbox_send(item_id, now, opener):
    state_dir = desire_state.resolve_state_dir()
    outbox_path = state_dir / "outbox.jsonl"
    reservation_date = now.date().isoformat()
    with desire_state.state_lock(state_dir):
        _normalized_state(state_dir, now)
        active = desire_state.active_outbox(desire_state.read_jsonl(outbox_path), now)
        item = next((candidate for candidate in active if candidate.get("id") == item_id), None)
        if item is None:
            print("unknown outbox item", file=sys.stderr)
            return 3
        note = item.get("note", "")
        if not _reserve_signal(state_dir, now):
            desire_state.update_outbox_item(outbox_path, item_id, {"blocked_by": "budget"})
            _audit(state_dir, now, "signal_blocked", blocked_by="budget", note=note, outbox_id=item_id)
            print("over budget", file=sys.stderr)
            return 1
        _audit(state_dir, now, "signal_reserved", note=note, outbox_id=item_id)

    event_id, failure, connected = _deliver(note, now, opener)

    with desire_state.state_lock(state_dir):
        if failure is None:
            desire_state.release_outbox_item(outbox_path, item_id)
            _audit(state_dir, now, "signal_sent", event_id=event_id, note=note, outbox_id=item_id)
            desire_state.record_transport(state_dir, connected, now)
            return 0
        _refund_signal(state_dir, now, reservation_date)
        current = next(
            (
                candidate
                for candidate in desire_state.read_jsonl(outbox_path)
                if isinstance(candidate, dict) and candidate.get("id") == item_id
            ),
            None,
        )
        if current is None:
            _audit(state_dir, now, "signal_failed", event_id=event_id, reason=failure, note=note)
        else:
            attempts = current.get("attempts")
            attempts = attempts if isinstance(attempts, int) else 1
            desire_state.update_outbox_item(
                outbox_path,
                item_id,
                {"blocked_by": "error", "attempts": attempts + 1, "last_failed_at": now.isoformat()},
            )
            _audit(
                state_dir,
                now,
                "signal_failed",
                event_id=event_id,
                reason=failure,
                note=note,
                outbox_id=item_id,
            )
        desire_state.record_transport(state_dir, connected, now)
    print(f"signal delivery failed: {failure}", file=sys.stderr)
    return 1


def _reservation_action(kind, operation, reservation_id, url, now):
    state_dir = desire_state.resolve_state_dir()
    counter = "issues" if kind == "issue" else "self_comments"
    filed_event = "issue_filed" if kind == "issue" else "self_comment_filed"
    with desire_state.state_lock(state_dir):
        budget = _normalized_state(state_dir, now)["budget"]
        if operation == "reserve":
            if budget[counter] >= CAPS[counter]:
                _audit(state_dir, now, "reservation_blocked", kind=kind)
                print("over budget", file=sys.stderr)
                return 1
            reservation_id = str(uuid.uuid4())
            budget[counter] += 1
            budget["pending"][reservation_id] = {"kind": kind, "date": now.date().isoformat()}
            desire_state.write_json_atomic(state_dir / "budget.json", budget)
            _audit(state_dir, now, "reservation_created", kind=kind, reservation_id=reservation_id)
            print(reservation_id)
            return 0

        pending = budget["pending"].get(reservation_id)
        if not isinstance(pending, dict) or pending.get("kind") != kind:
            _audit(state_dir, now, "reservation_unknown", kind=kind, reservation_id=reservation_id)
            print("unknown reservation", file=sys.stderr)
            return 1
        del budget["pending"][reservation_id]
        if operation == "release" and pending.get("date") == now.date().isoformat():
            budget[counter] = max(0, budget[counter] - 1)
        desire_state.write_json_atomic(state_dir / "budget.json", budget)
        if operation == "commit":
            _audit(state_dir, now, filed_event, url=url, reservation_id=reservation_id)
        else:
            _audit(state_dir, now, "reservation_released", kind=kind, reservation_id=reservation_id)
        return 0


def _feedback(operation, value, now):
    state_dir = desire_state.resolve_state_dir()
    with desire_state.state_lock(state_dir):
        state = _normalized_state(state_dir, now)
        if operation == "get":
            print(state["cursor"]["last_feedback_check_at"])
            return 0
        try:
            parsed = datetime.fromisoformat(value)
            if parsed.tzinfo is None or parsed.utcoffset() is None:
                raise ValueError("feedback timestamp must be timezone-aware")
        except (TypeError, ValueError) as error:
            print(f"invalid feedback timestamp: {error}", file=sys.stderr)
            return 1
        stamp = parsed.astimezone(KST).isoformat()
        desire_state.write_json_atomic(state_dir / "cursor.json", {"last_feedback_check_at": stamp})
        _audit(state_dir, now, "feedback_cursor_set", value=stamp)
        return 0


def _outbox_list(now):
    state_dir = desire_state.resolve_state_dir()
    with desire_state.state_lock(state_dir):
        _normalized_state(state_dir, now)
        values = desire_state.active_outbox(desire_state.read_jsonl(state_dir / "outbox.jsonl"), now)
    print(json.dumps(values, ensure_ascii=False))
    return 0


def _outbox_release(item_id, why, now):
    state_dir = desire_state.resolve_state_dir()
    with desire_state.state_lock(state_dir):
        if not desire_state.release_outbox_item(state_dir / "outbox.jsonl", item_id):
            print("unknown outbox item", file=sys.stderr)
            return 3
        _audit(state_dir, now, "outbox_released", id=item_id, why=why)
    return 0


def _parser():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    signal = commands.add_parser("signal")
    signal.add_argument("--note", required=True)

    for name in ("issue", "comment"):
        action = commands.add_parser(name)
        group = action.add_mutually_exclusive_group(required=True)
        group.add_argument("--reserve", action="store_true")
        group.add_argument("--commit", metavar="ID")
        group.add_argument("--release", metavar="ID")
        action.add_argument("--url")

    satisfy = commands.add_parser("satisfy")
    satisfy.add_argument("event", choices=desire_state.EVENT_DOSES)
    satisfy.add_argument("--why", required=True)

    feedback = commands.add_parser("feedback")
    feedback_group = feedback.add_mutually_exclusive_group(required=True)
    feedback_group.add_argument("--get", action="store_true")
    feedback_group.add_argument("--set", metavar="ISO")

    outbox = commands.add_parser("outbox")
    outbox_group = outbox.add_mutually_exclusive_group(required=True)
    outbox_group.add_argument("--list", action="store_true")
    outbox_group.add_argument("--release", metavar="ID")
    outbox_group.add_argument("--send", metavar="ID")
    outbox.add_argument("--why")
    return parser


def main(argv=None, *, now=None, opener=urllib_request.urlopen):
    now = desire_state.normalize_now(now or datetime.now(KST))
    args = _parser().parse_args(argv)
    if args.command == "signal":
        return _signal(args.note, now, opener)
    if args.command in ("issue", "comment"):
        if args.reserve:
            operation, reservation_id = "reserve", None
        elif args.commit:
            operation, reservation_id = "commit", args.commit
            if not args.url:
                print("--url is required with --commit", file=sys.stderr)
                return 1
        else:
            operation, reservation_id = "release", args.release
        return _reservation_action(args.command, operation, reservation_id, args.url, now)
    if args.command == "satisfy":
        try:
            reward = desire_state.satisfy(args.event, args.why, now)
        except ValueError as error:
            print(str(error), file=sys.stderr)
            return 1
        print(f"satisfied {args.event} reward={reward:.4f}")
        return 0
    if args.command == "feedback":
        return _feedback("get" if args.get else "set", args.set, now)
    if args.list:
        return _outbox_list(now)
    if args.send:
        return _outbox_send(args.send, now, opener)
    return _outbox_release(args.release, args.why, now)


if __name__ == "__main__":
    raise SystemExit(main())
