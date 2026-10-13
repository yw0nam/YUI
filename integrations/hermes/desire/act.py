"""Budget-enforced action helper for the desire integration."""

from __future__ import annotations

import argparse
import json
import math
import sys
import uuid
from datetime import datetime, timedelta
from urllib import error as urllib_error
from urllib import request as urllib_request
from zoneinfo import ZoneInfo

import desire_config
import desire_events
import desire_judgments
import desire_outbox
import desire_render
import desire_state
import desire_store

KST = ZoneInfo("Asia/Seoul")
CAPS = desire_state.CAPS
RESERVATIONS = {
    "issue": ("issues", "issue_filed"),
    "comment": ("self_comments", "self_comment_filed"),
    "pr": ("prs", "pr_filed"),
}


def _audit(state_dir, now, event, **fields):
    desire_store.append_jsonl(state_dir / "audit.jsonl", {"at": now.isoformat(), "event": event, **fields})


def _outbox_item(note, blocked_by, now):
    failed = blocked_by == "error"
    return {
        "id": str(uuid.uuid4()),
        "created_at": now.isoformat(),
        "note": desire_render.sanitize_note(note),
        "blocked_by": blocked_by,
        "surfaced_at": None,
        "attempts": 1 if failed else 0,
        "last_failed_at": now.isoformat() if failed else None,
    }


def _normalized_state(state_dir, now):
    state = desire_state.bootstrap_locked(state_dir, now)
    budget = desire_state.normalize_budget(state["budget"], now)
    if budget != state["budget"]:
        desire_store.write_json_atomic(state_dir / "budget.json", budget)
    state["budget"] = budget
    return state


def _stamp_signal_delivery(state_dir, now):
    """Record the delivery the middleware compares the next user turn against."""

    drives = desire_state.bootstrap_locked(state_dir, now)["drives"]
    drives["last_signal_at"] = now.isoformat()
    desire_store.write_json_atomic(state_dir / "drives.json", drives)


def _reserve_signal(state_dir, now):
    """Take one signal from today's budget. The caller holds the state lock."""

    budget = _normalized_state(state_dir, now)["budget"]
    if budget["signals"] >= CAPS["signals"]:
        return False
    budget["signals"] += 1
    desire_store.write_json_atomic(state_dir / "budget.json", budget)
    return True


def _refund_signal(state_dir, now, reservation_date):
    budget = _normalized_state(state_dir, now)["budget"]
    if budget["date"] == reservation_date:
        budget["signals"] = max(0, budget["signals"] - 1)
        desire_store.write_json_atomic(state_dir / "budget.json", budget)


def _deliver(note, now, opener, kind="desire", event_type="desire.impulse"):
    event_id = str(uuid.uuid4())
    body = {
        "signals": [{"kind": kind, "note": note}],
        "envelope": {
            "source": desire_config.signal_source(),
            "event_type": event_type,
            "delivery": "immediate",
            "event_id": event_id,
            "occurred_at": int(now.timestamp() * 1000),
        },
    }
    target = desire_config.signals_url()
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
    state_dir = desire_config.resolve_state_dir()
    reservation_date = now.date().isoformat()
    with desire_store.state_lock(state_dir):
        if not _reserve_signal(state_dir, now):
            desire_store.append_jsonl(state_dir / "outbox.jsonl", _outbox_item(note, "budget", now))
            _audit(state_dir, now, "signal_blocked", blocked_by="budget", note=note)
            print("over budget", file=sys.stderr)
            return 1
        _audit(state_dir, now, "signal_reserved", note=note)

    event_id, failure, connected = _deliver(note, now, opener)

    with desire_store.state_lock(state_dir):
        if failure is None:
            _audit(state_dir, now, "signal_sent", event_id=event_id, note=note)
            _stamp_signal_delivery(state_dir, now)
            desire_store.record_transport(state_dir, connected, now, source="delivery")
            return 0
        _refund_signal(state_dir, now, reservation_date)
        desire_store.append_jsonl(state_dir / "outbox.jsonl", _outbox_item(note, "error", now))
        _audit(state_dir, now, "signal_failed", event_id=event_id, reason=failure, note=note)
        desire_store.record_transport(state_dir, connected, now, source="delivery")
    print(f"signal delivery failed: {failure}", file=sys.stderr)
    return 1


def _report(note, now, opener):
    """Deliver the daily report outside the signal budget and the outbox."""

    state_dir = desire_config.resolve_state_dir()
    event_id, failure, connected = _deliver(note, now, opener, "report", "desire.report")
    with desire_store.state_lock(state_dir):
        desire_state.bootstrap_locked(state_dir, now)
        desire_store.record_transport(state_dir, connected, now, source="delivery")
        if failure is None:
            _audit(state_dir, now, "report_sent", event_id=event_id, note=note)
            return 0
        _audit(state_dir, now, "report_failed", reason=failure, note=note)
    print(f"report delivery failed: {failure}", file=sys.stderr)
    return 1


def _outbox_send(item_id, now, opener):
    state_dir = desire_config.resolve_state_dir()
    outbox_path = state_dir / "outbox.jsonl"
    reservation_date = now.date().isoformat()
    with desire_store.state_lock(state_dir):
        _normalized_state(state_dir, now)
        visible = desire_outbox.visible_outbox(desire_store.read_jsonl(outbox_path), now)
        item = next((candidate for candidate in visible if candidate.get("id") == item_id), None)
        if item is None:
            print("unknown outbox item", file=sys.stderr)
            return 3
        note = item.get("note", "")
        if not _reserve_signal(state_dir, now):
            desire_outbox.update_outbox_item(outbox_path, item_id, {"blocked_by": "budget"})
            _audit(state_dir, now, "signal_blocked", blocked_by="budget", note=note, outbox_id=item_id)
            print("over budget", file=sys.stderr)
            return 1
        _audit(state_dir, now, "signal_reserved", note=note, outbox_id=item_id)

    event_id, failure, connected = _deliver(note, now, opener)

    with desire_store.state_lock(state_dir):
        if failure is None:
            desire_outbox.release_outbox_item(outbox_path, item_id)
            _audit(state_dir, now, "signal_sent", event_id=event_id, note=note, outbox_id=item_id)
            _stamp_signal_delivery(state_dir, now)
            desire_store.record_transport(state_dir, connected, now, source="delivery")
            return 0
        _refund_signal(state_dir, now, reservation_date)
        current = next(
            (
                candidate
                for candidate in desire_store.read_jsonl(outbox_path)
                if isinstance(candidate, dict) and candidate.get("id") == item_id
            ),
            None,
        )
        if current is None:
            _audit(state_dir, now, "signal_failed", event_id=event_id, reason=failure, note=note)
        else:
            attempts = current.get("attempts")
            attempts = attempts if isinstance(attempts, int) else 1
            desire_outbox.update_outbox_item(
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
        desire_store.record_transport(state_dir, connected, now, source="delivery")
    print(f"signal delivery failed: {failure}", file=sys.stderr)
    return 1


def _reservation_action(kind, operation, reservation_id, url, now):
    state_dir = desire_config.resolve_state_dir()
    counter, filed_event = RESERVATIONS[kind]
    with desire_store.state_lock(state_dir):
        budget = _normalized_state(state_dir, now)["budget"]
        if operation == "reserve":
            if budget[counter] >= CAPS[counter]:
                _audit(state_dir, now, "reservation_blocked", kind=kind)
                print("over budget", file=sys.stderr)
                return 1
            reservation_id = str(uuid.uuid4())
            budget[counter] += 1
            budget["pending"][reservation_id] = {"kind": kind, "date": now.date().isoformat()}
            desire_store.write_json_atomic(state_dir / "budget.json", budget)
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
        desire_store.write_json_atomic(state_dir / "budget.json", budget)
        if operation == "commit":
            _audit(state_dir, now, filed_event, url=url, reservation_id=reservation_id)
        else:
            _audit(state_dir, now, "reservation_released", kind=kind, reservation_id=reservation_id)
        return 0


def _listed_item(item, now):
    """Mark an item the block and ``--send`` cannot reach yet."""

    not_before = item.get("not_before")
    if not_before is None:
        return item
    waiting = desire_config.parse_timestamp(not_before)
    if waiting <= now:
        return item
    return {**item, "postponed_until": waiting.strftime("%Y-%m-%d %H:%M")}


def _outbox_list(now):
    state_dir = desire_config.resolve_state_dir()
    with desire_store.state_lock(state_dir):
        _normalized_state(state_dir, now)
        values = desire_outbox.active_outbox(desire_store.read_jsonl(state_dir / "outbox.jsonl"), now)
    print(json.dumps([_listed_item(value, now) for value in values], ensure_ascii=False))
    return 0


def _outbox_disposition(kind, item_id, why, note, until, now):
    """Apply one disposition to an active pent-up note and record the reason for it."""

    state_dir = desire_config.resolve_state_dir()
    outbox_path = state_dir / "outbox.jsonl"
    with desire_store.state_lock(state_dir):
        active = desire_outbox.active_outbox(desire_store.read_jsonl(outbox_path), now)
        if not any(item.get("id") == item_id for item in active):
            print("unknown outbox item", file=sys.stderr)
            return 3
        extra = {}
        if kind == "reword":
            desire_outbox.update_outbox_item(
                outbox_path, item_id, {"note": desire_render.sanitize_note(note)}
            )
        elif kind == "postpone":
            not_before = (now + timedelta(hours=until)).isoformat()
            desire_outbox.update_outbox_item(outbox_path, item_id, {"not_before": not_before})
            extra["until"] = not_before
        _audit(state_dir, now, "outbox_disposition", id=item_id, kind=kind, why=why, **extra)
        if kind == "release":
            desire_outbox.release_outbox_item(outbox_path, item_id)
            _audit(state_dir, now, "outbox_released", id=item_id, why=why)
    return 0


_FEEL_MODES = {
    "fact": ({"fact", "text"}, {"source_ref"}),
    "event": ({"event", "text"}, set()),
    "list": ({"list"}, {"all"}),
    "grounds": ({"grounds", "toward"}, set()),
}
_FEEL_USAGE = (
    "feel --fact TEXT --text TEXT [--source-ref TEXT] | feel --event ID --text TEXT | feel --list [--all]"
    " | feel --grounds NAME --toward TOWARD"
)


def _feel_mode(args):
    """Name the one mode the given options form, or ``None`` for any other combination."""

    given = {
        name
        for name in ("fact", "text", "source_ref", "event", "grounds", "toward")
        if getattr(args, name) is not None
    }
    given |= {name for name in ("list", "all") if getattr(args, name)}
    return next(
        (mode for mode, (needed, allowed) in _FEEL_MODES.items() if needed <= given <= needed | allowed),
        None,
    )


def _empty_option(args, names):
    """Name the first given option that is empty after stripping, as it is spelled on the command line."""

    for name in names:
        value = getattr(args, name, None)
        if value is not None and not value.strip():
            return "--" + name.replace("_", "-")
    return None


def _feel(args, now):
    mode = _feel_mode(args)
    if mode is None:
        print(f"usage: {_FEEL_USAGE}", file=sys.stderr)
        return 2
    empty = _empty_option(args, ("fact", "text", "source_ref"))
    if empty is not None:
        print(f"empty {empty}", file=sys.stderr)
        return 2
    state_dir = desire_config.resolve_state_dir()
    if mode == "list":
        return _feel_list(state_dir, args.all)
    if mode == "grounds":
        return _feel_grounds(state_dir, args.grounds.strip(), args.toward)
    if mode == "fact":
        event_id, reading_id = desire_events.file_event_with_reading(
            state_dir, args.fact, args.text, args.source_ref, now
        )
        print(f"event {event_id} reading {reading_id}")
        return 0
    try:
        reading_id = desire_events.file_reading(state_dir, args.event, args.text, now)
    except desire_events.UnknownEventError:
        print("unknown event", file=sys.stderr)
        return 3
    except desire_events.RetractedEventError:
        print(f"event {args.event} is retracted", file=sys.stderr)
        return 3
    print(f"reading {reading_id}")
    return 0


def _event_line(event):
    stamp = desire_config.parse_timestamp(event["at"]).strftime("%Y-%m-%d %H:%M")
    fact = desire_render.sanitize_note(event["fact"])
    reading = desire_render.sanitize_note(event["reading"]["text"]) if event["reading"] else "(no reading)"
    return f"{event['id']} {stamp} [{event['source']}] {fact} — {reading}"


def _feel_list(state_dir, show_all):
    events = desire_events.chronological(desire_events.events_view(state_dir))
    for event in events if show_all else events[-20:]:
        print(_event_line(event))
    return 0


def _feel_grounds(state_dir, name, toward):
    if (name, toward) not in desire_judgments.present(state_dir):
        print("no judgment")
        return 0
    events = desire_judgments.grounds(state_dir, name, toward)
    for event in events:
        print(_event_line(event))
    if not events:
        print("no events linked")
    return 0


_JUDGE_USAGE = (
    "judge NAME --toward TOWARD --level LEVEL [--event ID ...] [--why TEXT]"
    " | judge NAME --toward TOWARD --put-down [--why TEXT] | judge --list"
)


def _judge_shape(args):
    """Name the one shape the given arguments form, or ``None`` for any other combination."""

    if args.list:
        plain = args.name is None and args.toward is None and args.level is None and not args.put_down
        return "list" if plain and args.event is None and args.why is None else None
    if args.name is None or args.toward is None or (args.level is not None) == args.put_down:
        return None
    if args.put_down:
        return "put-down" if args.event is None else None
    return "level"


def _judge(args, now):
    shape = _judge_shape(args)
    if shape is None:
        print(f"usage: {_JUDGE_USAGE}", file=sys.stderr)
        return 2
    state_dir = desire_config.resolve_state_dir()
    if shape == "list":
        return _judge_list(state_dir)
    try:
        desire_judgments.judge(state_dir, args.name, args.toward, args.level, args.event or [], args.why, now)
    except (desire_events.UnknownEventError, desire_events.RetractedEventError) as error:
        print(str(error), file=sys.stderr)
        return 3
    except ValueError as error:
        print(str(error), file=sys.stderr)
        return 1
    name = args.name.strip()
    if shape == "put-down":
        print(f"put down {name} toward {args.toward}")
    else:
        print(f"judged {name} toward {args.toward}: {args.level}")
    return 0


def _judge_list(state_dir):
    held = desire_judgments.present(state_dir)
    for name, toward in sorted(held, key=lambda pair: (desire_judgments.TOWARDS.index(pair[1]), pair[0])):
        judgment = held[(name, toward)]
        day = desire_config.parse_timestamp(judgment["at"]).strftime("%Y-%m-%d")
        why = f" — {desire_render.sanitize_note(judgment['why'])}" if judgment["why"] is not None else ""
        print(f"{desire_render.sanitize_note(name)} toward {toward}: {judgment['level']} ({day}){why}")
    return 0


def _how(text):
    try:
        desire_judgments.write_how(desire_config.resolve_state_dir(), text)
    except ValueError as error:
        print(str(error), file=sys.stderr)
        return 1
    return 0


def _correct(event_id, fact, now):
    if not fact.strip():
        print("empty --fact", file=sys.stderr)
        return 2
    try:
        desire_events.correct(desire_config.resolve_state_dir(), event_id, fact, now)
    except desire_events.UnknownEventError:
        print("unknown event", file=sys.stderr)
        return 3
    except desire_events.RetractedEventError:
        print(f"event {event_id} is retracted", file=sys.stderr)
        return 1
    print(f"corrected {event_id}")
    return 0


def _retract(event_id, why, now):
    if not why.strip():
        print("empty --why", file=sys.stderr)
        return 2
    try:
        retracted = desire_events.retract(desire_config.resolve_state_dir(), event_id, why, now)
    except desire_events.UnknownEventError:
        print("unknown event", file=sys.stderr)
        return 3
    print(f"retracted {event_id}" if retracted else f"already retracted {event_id}")
    return 0


def _parser():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    signal = commands.add_parser("signal")
    signal.add_argument("--note", required=True)

    report = commands.add_parser("report")
    report.add_argument("--note", required=True)

    for name in RESERVATIONS:
        action = commands.add_parser(name)
        group = action.add_mutually_exclusive_group(required=True)
        group.add_argument("--reserve", action="store_true")
        group.add_argument("--commit", metavar="ID")
        group.add_argument("--release", metavar="ID")
        action.add_argument("--url")

    feel = commands.add_parser(
        "feel",
        description="Record how you took something that happened, or list what happened.",
        usage=_FEEL_USAGE,
    )
    feel.add_argument("--fact", help="what happened, filed as a new event with your reading of it")
    feel.add_argument("--text", help="how you took it")
    feel.add_argument("--source-ref", help="a link or name for where the fact comes from")
    feel.add_argument("--event", metavar="ID", help="an existing event to add your reading to")
    feel.add_argument("--list", action="store_true", help="print the twenty most recent events")
    feel.add_argument("--all", action="store_true", help="with --list, print every event")
    feel.add_argument("--grounds", metavar="NAME", help="print the events behind a present judgment")
    feel.add_argument("--toward", choices=desire_judgments.TOWARDS, help="with --grounds, what it is toward")

    judge = commands.add_parser(
        "judge", description="Hold, change or put down a judgment on a named feeling.", usage=_JUDGE_USAGE
    )
    judge.add_argument("name", nargs="?", help="a registered feeling name, quoted when it has spaces")
    judge.add_argument("--toward", choices=desire_judgments.TOWARDS)
    judge.add_argument("--level", choices=desire_judgments.LEVELS)
    judge.add_argument("--put-down", action="store_true", help="end the present judgment")
    judge.add_argument("--event", action="append", metavar="ID", help="an event behind it; may repeat")
    judge.add_argument("--why")
    judge.add_argument("--list", action="store_true", help="print every present judgment")

    how = commands.add_parser("how", description="Write how you are right now, at most 500 characters.")
    how.add_argument("text")

    correct = commands.add_parser("correct", description="Correct the fact of an event.")
    correct.add_argument("event_id", metavar="ID")
    correct.add_argument("--fact", required=True)

    retract = commands.add_parser("retract", description="Take back an event that did not happen.")
    retract.add_argument("event_id", metavar="ID")
    retract.add_argument("--why", required=True)

    outbox = commands.add_parser("outbox")
    outbox_group = outbox.add_mutually_exclusive_group(required=True)
    outbox_group.add_argument("--list", action="store_true")
    outbox_group.add_argument("--send", metavar="ID")
    outbox_group.add_argument("--repeat", metavar="ID")
    outbox_group.add_argument("--reword", metavar="ID")
    outbox_group.add_argument("--postpone", metavar="ID")
    outbox_group.add_argument("--release", metavar="ID")
    outbox.add_argument("--why")
    outbox.add_argument("--note")
    outbox.add_argument("--until", type=float, default=24.0)
    return parser


def main(argv=None, *, now=None, opener=urllib_request.urlopen):
    try:
        return _run(argv, now, opener)
    except desire_config.ConfigurationError as error:
        print(str(error), file=sys.stderr)
        return 1


def _run(argv, now, opener):
    # Identity is read before any state transaction, so a missing value costs no budget.
    desire_config.agent_name()
    now = desire_config.normalize_now(now or datetime.now(KST))
    args = _parser().parse_args(argv)
    if args.command == "signal":
        return _signal(args.note, now, opener)
    if args.command == "report":
        return _report(args.note, now, opener)
    if args.command in RESERVATIONS:
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
    if args.command == "feel":
        return _feel(args, now)
    if args.command == "correct":
        return _correct(args.event_id, args.fact, now)
    if args.command == "retract":
        return _retract(args.event_id, args.why, now)
    if args.command == "judge":
        return _judge(args, now)
    if args.command == "how":
        return _how(args.text)
    if args.list:
        return _outbox_list(now)
    if args.send is not None:
        return _outbox_send(args.send, now, opener)
    kind, item_id = next(
        (name, getattr(args, name))
        for name in ("repeat", "reword", "postpone", "release")
        if getattr(args, name) is not None
    )
    if not args.why:
        print("--why is required for an outbox disposition", file=sys.stderr)
        return 2
    if kind == "reword" and not args.note:
        print("--note is required with --reword", file=sys.stderr)
        return 2
    if kind == "postpone" and not (math.isfinite(args.until) and 0 < args.until <= 8760):
        print("--until must be between 0 and 8760 hours", file=sys.stderr)
        return 2
    return _outbox_disposition(kind, item_id, args.why, args.note, args.until, now)


if __name__ == "__main__":
    raise SystemExit(main())
