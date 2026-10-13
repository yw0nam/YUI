"""Pre-run gate for the Hermes cron job: state bookkeeping, then the two wake cases."""

from __future__ import annotations

import json
import re
import subprocess
from datetime import datetime, timedelta
from pathlib import Path
from urllib import error as urllib_error
from urllib import request as urllib_request

import desire_config
import desire_events
import desire_outbox
import desire_state
import desire_store

PROBE_TIMEOUT = 2
GH_TIMEOUT = 60
BATCH_INTERVAL = timedelta(hours=6)
BATCH_LIMIT = 3
NOTE_INTERVAL = timedelta(hours=6)
WAKE_UNREAD_EVENTS = "desire gate: unread events"
WAKE_HELD_NOTES = "desire gate: held notes"
NO_WAKE_LINE = '{"wakeAgent": false}'
SOURCE_OF = {"pr": "pr", "issue": "issue"}
_ORIGIN_SECTION = re.compile(r'^\[remote "origin"\]\n(.*?)(?=^\[|\Z)', re.MULTILINE | re.DOTALL)
_ORIGIN_URL = re.compile(r"^\s*url\s*=\s*(\S+)", re.MULTILINE)
_GITHUB_SLUG = re.compile(r"(?:^|[@/.])github\.com[:/](?P<owner>[^/]+)/(?P<name>[^/]+?)(?:\.git)?/?$")


def probe_transport() -> bool:
    """Report whether the YUI signals ingress returns an HTTP response right now."""

    target = desire_config.signals_url()
    try:
        with urllib_request.urlopen(urllib_request.Request(target, method="GET"), timeout=PROBE_TIMEOUT):
            return True
    except urllib_error.HTTPError:
        return True
    except Exception:  # noqa: BLE001 - transport implementations may raise arbitrary errors
        return False


def run_gh(args: list[str]) -> str:
    """Run one `gh` command and return its stdout, raising on any failure."""

    result = subprocess.run(["gh", *args], capture_output=True, text=True, timeout=GH_TIMEOUT, check=False)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or f"gh exited {result.returncode}")
    return result.stdout


def _github_slug(origin: str) -> str | None:
    match = _GITHUB_SLUG.search(origin)
    return f"{match['owner']}/{match['name']}" if match is not None else None


def workspace_repos(workspace_root: Path) -> list[str]:
    """Return each `owner/name` once, however many workspace directories clone it from GitHub."""

    repos = set()
    try:
        entries = sorted(entry for entry in Path(workspace_root).iterdir() if entry.is_dir())
    except OSError:
        return []
    for entry in entries:
        try:
            config = (entry / ".git" / "config").read_text(encoding="utf-8")
        except (OSError, UnicodeError):
            continue
        section = _ORIGIN_SECTION.search(config)
        origin = _ORIGIN_URL.search(section.group(1)) if section is not None else None
        slug = _github_slug(origin.group(1)) if origin is not None else None
        if slug is not None:
            repos.add(slug)
    return sorted(repos)


def repo_pull_requests(repo: str, run_gh) -> list[dict]:
    """Return the repository's own pull requests opened from a branch carrying the agent prefix."""

    payload = run_gh(
        [
            "pr",
            "list",
            "--repo",
            repo,
            "--author",
            "@me",
            "--state",
            "all",
            "--limit",
            "100",
            "--json",
            "number,url,headRefName,state,mergedAt",
        ]
    )
    prefix = desire_config.branch_prefix()
    return [
        pull
        for pull in json.loads(payload)
        if isinstance(pull, dict) and str(pull.get("headRefName", "")).startswith(prefix)
    ]


def repo_issues(repo: str, run_gh) -> list[dict]:
    """Return the repository's own issues whose body carries the agent's issue marker."""

    payload = run_gh(
        [
            "issue",
            "list",
            "--repo",
            repo,
            "--author",
            "@me",
            "--state",
            "all",
            "--limit",
            "100",
            "--json",
            "number,url,state,closedAt,body",
        ]
    )
    marker = desire_config.issue_marker()
    return [
        issue
        for issue in json.loads(payload)
        if isinstance(issue, dict) and marker in str(issue.get("body", ""))
    ]


def _derive_failed(state_dir: Path, now: datetime, source: str, repo: str | None, message: str, ref=None):
    named = {"ref": ref} if ref is not None else {}
    desire_store.append_jsonl(
        state_dir / "audit.jsonl",
        {
            "at": now.isoformat(),
            "event": "derive_failed",
            "source": source,
            "repo": repo,
            **named,
            "error": message.replace("\n", " ")[:200],
        },
    )


def _read_source(state_dir, now, source, repo, read, ref=None):
    """Return what one source reports, or ``None`` once it failed and was audited."""

    try:
        return read()
    except Exception as error:  # noqa: BLE001 - a failing source is skipped, never fatal
        _derive_failed(state_dir, now, source, repo, f"{type(error).__name__}: {error}", ref)
        return None


def artefact_delivery(kind: str, url: str, run_gh) -> object:
    """Return when this pull request merged or this issue closed, or ``None`` while it is open."""

    field = "mergedAt" if kind == "pr" else "closedAt"
    return json.loads(run_gh([kind, "view", url, "--json", f"state,{field}"])).get(field)


def collect_artefacts(state_dir, now, *, workspace_root, run_gh) -> dict:
    """Read both sources outside the state lock, so no `gh` call blocks a turn.

    Each kind maps to its ``(ref, delivered_at)`` pairs, or to ``None`` when the source did not
    answer at all. While a kind is still unbootstrapped one failing repository drops the whole kind,
    so a partial answer is never mistaken for the complete first sight; afterwards only the failing
    repository's own contribution is dropped. The list calls carry a fixed window, so delivery is
    read from each pending artefact's own view instead of waiting for it to appear in that window.
    """

    now = desire_config.normalize_now(now)
    state_dir = Path(state_dir)
    record = desire_store.read_artefacts(state_dir)
    bootstrapped = set(record["bootstrapped"]) if record else set()
    observed = {kind: [] for kind in desire_store.ARTEFACT_KINDS}
    for repo in workspace_repos(workspace_root):
        pulls = _read_source(state_dir, now, "pr", repo, lambda name=repo: repo_pull_requests(name, run_gh))
        observed["pr"] = _extend(observed["pr"], pulls, "url", "mergedAt", "pr" in bootstrapped)
        issues = _read_source(state_dir, now, "issue", repo, lambda name=repo: repo_issues(name, run_gh))
        observed["issue"] = _extend(observed["issue"], issues, "url", "closedAt", "issue" in bootstrapped)
    for kind in ("pr", "issue"):
        for url in _undelivered(record, kind):
            delivered = _read_source(
                state_dir,
                now,
                kind,
                None,
                lambda name=kind, target=url: artefact_delivery(name, target, run_gh),
                url,
            )
            if delivered is not None and observed[kind] is not None:
                observed[kind].append((url, delivered))
    return observed


def _undelivered(record: dict | None, kind: str) -> list[str]:
    """Name the artefacts of this kind that are counted but have not been delivered yet."""

    if record is None:
        return []
    shipped = set(record["shipped"])
    return [ref for ref in record["seen"][kind] if ref not in shipped]


def _extend(collected, items, ref_field: str, delivered_field: str, bootstrapped: bool):
    """Add one repository's answer, dropping the whole kind while it has never fully answered."""

    if collected is None:
        return None
    if items is None:
        return collected if bootstrapped else None
    return collected + [(item.get(ref_field), item.get(delivered_field)) for item in items]


def record_artefacts(state_dir, now, observed: dict) -> None:
    """Record every collected artefact's first sight and delivery under the lock."""

    now = desire_config.normalize_now(now)
    state_dir = Path(state_dir)
    with desire_store.state_lock(state_dir):
        record = desire_store.read_artefacts(state_dir) or desire_store.default_artefacts(now)
        for kind in desire_store.ARTEFACT_KINDS:
            if observed[kind] is None:
                continue
            for ref, delivered_at in observed[kind]:
                if not isinstance(ref, str) or not ref:
                    _derive_failed(state_dir, now, SOURCE_OF[kind], None, f"malformed ref: {ref!r}")
                    continue
                # One artefact can arrive from more than one source call in a run; it is recorded once.
                if ref not in record["seen"][kind]:
                    record["seen"][kind].append(ref)
                if delivered_at and ref not in record["shipped"]:
                    record["shipped"].append(ref)
            record["bootstrapped"] = sorted({*record["bootstrapped"], kind})
        desire_store.write_json_atomic(state_dir / "artefacts.json", record)


def _default_gate_state() -> dict:
    return {"batch": {"ids": [], "presented_at": []}, "notes_presented_at": None}


def _normalize_gate_state(value: object) -> dict:
    if not isinstance(value, dict):
        raise TypeError("gate state must be an object")
    batch = value["batch"]
    if not isinstance(batch, dict):
        raise TypeError("gate batch must be an object")
    ids = batch["ids"]
    if not isinstance(ids, list) or any(not isinstance(item, str) for item in ids):
        raise ValueError("batch ids must be a list of text")
    presented = [desire_config.parse_timestamp(stamp).isoformat() for stamp in batch["presented_at"]]
    notes = value["notes_presented_at"]
    return {
        "batch": {"ids": list(ids), "presented_at": presented},
        "notes_presented_at": None if notes is None else desire_config.parse_timestamp(notes).isoformat(),
    }


def _unread_events_lines(state_dir: Path, state: dict, now: datetime) -> list[str]:
    unread = desire_events.unread_event_ids(state_dir)
    batch = state["batch"]
    if not unread:
        state["batch"] = {"ids": [], "presented_at": []}
        return []
    if any(event_id not in batch["ids"] for event_id in unread):
        state["batch"] = {"ids": list(unread), "presented_at": [now.isoformat()]}
        return [f"{WAKE_UNREAD_EVENTS} ({len(unread)})"]
    batch["ids"] = unread
    presented = batch["presented_at"]
    if not presented:
        presented.append(now.isoformat())
    elif len(presented) >= BATCH_LIMIT or now - desire_config.parse_timestamp(presented[-1]) < BATCH_INTERVAL:
        return []
    else:
        presented.append(now.isoformat())
    return [f"{WAKE_UNREAD_EVENTS} ({len(unread)})"]


def _held_notes_lines(
    state_dir: Path, budget: dict, transport: dict, state: dict, now: datetime
) -> list[str]:
    eligible = desire_outbox.visible_outbox(desire_store.read_jsonl(state_dir / "outbox.jsonl"), now)
    budget_left = desire_state.CAPS["signals"] - budget["signals"] > 0
    if not eligible or transport["state"] != "up" or not budget_left:
        return []
    stamp = state["notes_presented_at"]
    if stamp is None:
        due = True
    else:
        presented = desire_config.parse_timestamp(stamp)
        due = now - presented >= NOTE_INTERVAL or any(
            desire_config.parse_timestamp(item["created_at"]) > presented for item in eligible
        )
    if not due:
        return []
    state["notes_presented_at"] = now.isoformat()
    return [f"{WAKE_HELD_NOTES} ({len(eligible)})"]


def run(now: datetime) -> str:
    """Do the bookkeeping, then return the exact stdout the wake decision calls for."""

    now = desire_config.normalize_now(now)
    profile = desire_config.profile_root()
    reachable = probe_transport()
    observed = collect_artefacts(
        desire_config.resolve_state_dir(),
        now,
        workspace_root=profile / "workspace",
        run_gh=run_gh,
    )
    with desire_store.state_lock() as state_dir:
        state = desire_state.bootstrap_locked(state_dir, now)

        budget = desire_state.normalize_budget(state["budget"], now)
        cutoff = now.date() - timedelta(days=7)
        budget["pending"] = {
            reservation_id: reservation
            for reservation_id, reservation in budget["pending"].items()
            if not desire_state.reservation_is_older_than(reservation, cutoff)
        }
        desire_store.write_json_atomic(state_dir / "budget.json", budget)

        outbox_path = state_dir / "outbox.jsonl"
        outbox, dropped = desire_store.read_jsonl_with_dropped(outbox_path)
        valid = [item for item in outbox if desire_outbox.valid_outbox_item(item)]
        dropped += len(outbox) - len(valid)
        active = desire_outbox.active_outbox(valid, now)
        active_ids = {id(item) for item in active}
        expired = [item for item in valid if id(item) not in active_ids]
        desire_store.write_jsonl_atomic(outbox_path, active)

        for item in expired:
            desire_store.append_jsonl(
                state_dir / "audit.jsonl",
                {"at": now.isoformat(), "event": "outbox_expired", "item": item},
            )
        if dropped:
            desire_store.append_jsonl(
                state_dir / "audit.jsonl",
                {"at": now.isoformat(), "event": "jsonl_lines_dropped", "count": dropped},
            )

        transport = desire_store.record_transport(state_dir, reachable, now)
        record_artefacts(state_dir, now, observed)

        path = state_dir / "gate.json"
        gate_state = desire_store.load_json(path, _default_gate_state, now)
        try:
            gate_state = _normalize_gate_state(gate_state)
        except (KeyError, TypeError, ValueError):
            gate_state = desire_store._recover_invalid_json_locked(path, _default_gate_state, now)
        lines = _unread_events_lines(state_dir, gate_state, now)
        lines.extend(_held_notes_lines(state_dir, budget, transport, gate_state, now))
        desire_store.write_json_atomic(path, gate_state)

        if not lines:
            return f"{NO_WAKE_LINE}\n"
        return "".join(f"{line}\n" for line in lines)


def _record_gate_error(error: Exception) -> None:
    try:
        desire_store.append_jsonl(
            desire_config.resolve_state_dir() / "audit.jsonl",
            {
                "at": datetime.now(desire_config.KST).isoformat(),
                "event": "gate_error",
                "error": f"{type(error).__name__}: {error}",
            },
        )
    except Exception:  # noqa: BLE001, S110 - the audit write is best effort; the no-wake line still prints
        pass


def main() -> None:
    # A missing identity is a misconfiguration the fail-safe line must not hide.
    try:
        desire_config.agent_name()
    except desire_config.ConfigurationError as error:
        raise SystemExit(str(error)) from error
    try:
        output = run(datetime.now(desire_config.KST))
    except Exception as error:  # noqa: BLE001 - a non-zero exit would run the agent with an error block
        _record_gate_error(error)
        output = f"{NO_WAKE_LINE}\n"
    print(output, end="")


if __name__ == "__main__":
    main()
