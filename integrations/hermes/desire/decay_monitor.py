"""Persist desire drive decay/growth, derive satisfaction events, emit the hash-gated summary."""

from __future__ import annotations

import json
import os
import re
import subprocess
from datetime import datetime, timedelta
from pathlib import Path
from urllib import error as urllib_error
from urllib import parse as urllib_parse
from urllib import request as urllib_request

import desire_state

PROBE_TIMEOUT = 2
GH_TIMEOUT = 60
NOTES_TIMEOUT = 10
SATURATION_STEP = timedelta(hours=3)
DEFAULT_MEMORY_BASE_URL = "http://127.0.0.1:8010"
NOTE_KINDS = ("note", "decision")
NOTE_MEMORY = 500
BRANCH_PREFIX = "natsume/"
ISSUE_MARKER = "<!-- from-natsume -->"
FIRST_SIGHT = {"pr": "progressed", "issue": "progressed", "skill": "progressed", "note": "learned"}
SOURCE_OF = {"pr": "pr", "issue": "issue", "skill": "skill", "note": "notes"}
_ORIGIN_SECTION = re.compile(r'^\[remote "origin"\]\n(.*?)(?=^\[|\Z)', re.MULTILINE | re.DOTALL)
_ORIGIN_URL = re.compile(r"^\s*url\s*=\s*(\S+)", re.MULTILINE)
_GITHUB_SLUG = re.compile(r"(?:^|[@/.])github\.com[:/](?P<owner>[^/]+)/(?P<name>[^/]+?)(?:\.git)?/?$")


def probe_transport() -> bool:
    """Report whether the YUI signals ingress returns an HTTP response right now."""

    target = os.environ.get("YUI_SIGNALS_URL") or desire_state.DEFAULT_SIGNALS_URL
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


def fetch_notes(url: str, headers: dict[str, str]) -> bytes:
    with urllib_request.urlopen(urllib_request.Request(url, headers=headers), timeout=NOTES_TIMEOUT) as reply:
        return reply.read()


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
    """Return the repository's own pull requests that were opened from a `natsume/` branch."""

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
    return [
        pull
        for pull in json.loads(payload)
        if isinstance(pull, dict) and str(pull.get("headRefName", "")).startswith(BRANCH_PREFIX)
    ]


def repo_issues(repo: str, run_gh) -> list[dict]:
    """Return the repository's own issues whose body carries the Natsume marker."""

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
    return [
        issue
        for issue in json.loads(payload)
        if isinstance(issue, dict) and ISSUE_MARKER in str(issue.get("body", ""))
    ]


def profile_skills(skills_root: Path) -> list[str]:
    """Return every skill directory under the profile, by its path relative to the skills root."""

    skills_root = Path(skills_root)
    if not skills_root.is_dir():
        return []
    return sorted(str(path.parent.relative_to(skills_root)) for path in skills_root.rglob("SKILL.md"))


def memory_notes(since: str, fetch_notes) -> list[dict]:
    """Return the notes Natsume tagged `natsume` since the cursor, without her episodes."""

    base = os.environ.get("MEMORY_BASE_URL") or DEFAULT_MEMORY_BASE_URL
    query = urllib_parse.urlencode({"since": since, "limit": 200, "tags": "natsume"})
    headers = {"X-API-Key": os.environ.get("MEMORY_BASE_API_KEY", "")}
    payload = json.loads(fetch_notes(f"{base.rstrip('/')}/notes?{query}", headers))
    notes = payload.get("notes", []) if isinstance(payload, dict) else payload
    return [note for note in notes if isinstance(note, dict) and note.get("kind") in NOTE_KINDS]


def _derive_failed(state_dir: Path, now: datetime, source: str, repo: str | None, message: str, ref=None):
    named = {"ref": ref} if ref is not None else {}
    desire_state.append_jsonl(
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


def collect_artefacts(state_dir, now, *, workspace_root, skills_root, run_gh, fetch_notes) -> dict:
    """Read the four sources outside the state lock, so no `gh` call blocks a turn.

    Each kind maps to its ``(ref, delivered_at)`` pairs, or to ``None`` when the source did not
    answer at all. While a kind is still unbootstrapped one failing repository drops the whole kind,
    so a partial answer is never mistaken for the complete first sight; afterwards only the failing
    repository's own contribution is dropped. The list calls carry a fixed window, so delivery is
    read from each pending artefact's own view instead of waiting for it to appear in that window.
    """

    now = desire_state.normalize_now(now)
    state_dir = Path(state_dir)
    record = desire_state.read_artefacts(state_dir)
    bootstrapped = set(record["bootstrapped"]) if record else set()
    observed = {kind: [] for kind in desire_state.SEEN_KINDS}
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
    skills = _read_source(state_dir, now, "skill", None, lambda: profile_skills(skills_root))
    observed["skill"] = None if skills is None else [(relative, None) for relative in skills]
    since = (record["notes_since"] if record else None) or now.isoformat()
    notes = _read_source(state_dir, now, "notes", None, lambda: memory_notes(since, fetch_notes))
    observed["note"] = None if notes is None else [(note.get("id"), None) for note in notes]
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


def _states_of(record: dict, kind: str, ref: str, delivered_at: object) -> list[tuple[str, str, str]]:
    """Name the events an artefact owes: its first sight, then its delivery."""

    events = []
    if ref not in record["seen"][kind]:
        events.append((FIRST_SIGHT[kind], kind, ref))
    if delivered_at and ref not in record["shipped"]:
        events.append(("shipped", kind, ref))
    return events


def score_artefacts(state_dir, now, observed: dict) -> None:
    """Dose every collected artefact that has not been counted yet, and record what was scored.

    A source is scored only from the tick after its first answer, so an artefact that already
    existed is recorded as seen rather than dosed however late that source starts answering.
    """

    now = desire_state.normalize_now(now)
    state_dir = Path(state_dir)
    with desire_state.state_lock(state_dir):
        record = desire_state.read_artefacts(state_dir) or desire_state.default_artefacts(now)
        scored = set(record["bootstrapped"])
        candidates = []
        for kind in desire_state.SEEN_KINDS:
            if observed[kind] is None:
                continue
            for ref, delivered_at in observed[kind]:
                if not isinstance(ref, str) or not ref:
                    _derive_failed(state_dir, now, SOURCE_OF[kind], None, f"malformed ref: {ref!r}")
                    continue
                # One artefact can arrive from more than one source call in a tick; it owes one dose.
                for candidate in _states_of(record, kind, ref, delivered_at):
                    if candidate not in candidates:
                        candidates.append(candidate)
            record["bootstrapped"] = sorted({*record["bootstrapped"], kind})
        if observed["note"] is not None:
            record["notes_since"] = now.isoformat()

        try:
            for event, kind, ref in candidates:
                if event == "shipped":
                    record["shipped"].append(ref)
                else:
                    record["seen"][kind].append(ref)
                if kind not in scored:
                    continue
                try:
                    desire_state.satisfy(event, ref, now, kind=kind, state_dir=state_dir)
                except ValueError:
                    continue
                record["unreported"].append({"event": event, "kind": kind, "ref": ref, "at": now.isoformat()})
        finally:
            record["seen"]["note"] = record["seen"]["note"][-NOTE_MEMORY:]
            desire_state.write_json_atomic(state_dir / "artefacts.json", record)


def _starved(since: str | None, now: datetime) -> int:
    """Count the whole saturation steps a drive has stood at its ceiling."""

    if since is None:
        return 0
    return max(0, (now - desire_state.parse_timestamp(since)) // SATURATION_STEP)


def run(now: datetime) -> str:
    now = desire_state.normalize_now(now)
    profile = desire_state.profile_root()
    reachable = probe_transport()
    observed = collect_artefacts(
        desire_state.resolve_state_dir(),
        now,
        workspace_root=profile / "workspace",
        skills_root=profile / "skills",
        run_gh=run_gh,
        fetch_notes=fetch_notes,
    )
    with desire_state.state_lock() as state_dir:
        state = desire_state.bootstrap_locked(state_dir, now)

        drives = state["drives"]
        levels = desire_state.drive_levels(drives, now)
        for name in ("curiosity", "accomplishment"):
            drives[name] = {"level": levels[name], "anchor_at": now.isoformat()}
        desire_state.write_json_atomic(state_dir / "drives.json", drives)

        # A fallen bucket keeps its latched token, so a drive the agent just satisfied does not
        # wake the next tick; a rise re-snapshots every token and counts.
        monitor = state["monitor"]
        natural = {name: desire_state.bucket(levels[name]) for name in desire_state.DRIVES}
        rises = monitor["rises"] + sum(
            desire_state.BUCKETS.index(natural[name]) > desire_state.BUCKETS.index(monitor["natural"][name])
            for name in desire_state.DRIVES
        )
        latched = dict(natural) if rises > monitor["rises"] else monitor["latched"]
        # A drive pinned at the ceiling keeps its stamp, so its own starved count climbs every step.
        saturated = {
            name: (monitor["saturated_since"][name] or now.isoformat()) if levels[name] >= 100 else None
            for name in desire_state.DRIVES
        }
        starved = {name: _starved(since, now) for name, since in saturated.items()}
        desire_state.write_json_atomic(
            state_dir / "monitor.json",
            {"latched": latched, "natural": natural, "rises": rises, "saturated_since": saturated},
        )

        budget = desire_state.normalize_budget(state["budget"], now)
        cutoff = now.date() - timedelta(days=7)
        budget["pending"] = {
            reservation_id: reservation
            for reservation_id, reservation in budget["pending"].items()
            if not desire_state.reservation_is_older_than(reservation, cutoff)
        }
        desire_state.write_json_atomic(state_dir / "budget.json", budget)

        outbox_path = state_dir / "outbox.jsonl"
        outbox, dropped = desire_state.read_jsonl_with_dropped(outbox_path)
        valid = [item for item in outbox if desire_state.valid_outbox_item(item)]
        dropped += len(outbox) - len(valid)
        active = desire_state.active_outbox(valid, now)
        active_ids = {id(item) for item in active}
        expired = [item for item in valid if id(item) not in active_ids]
        desire_state.write_jsonl_atomic(outbox_path, active)

        for item in expired:
            desire_state.append_jsonl(
                state_dir / "audit.jsonl",
                {"at": now.isoformat(), "event": "outbox_expired", "item": item},
            )
        if dropped:
            desire_state.append_jsonl(
                state_dir / "audit.jsonl",
                {"at": now.isoformat(), "event": "jsonl_lines_dropped", "count": dropped},
            )

        transport = desire_state.record_transport(state_dir, reachable, now)
        visible = desire_state.visible_outbox(active, now)
        outbox_summary = str(len(visible))
        if visible:
            oldest = min(desire_state.parse_timestamp(item["created_at"]) for item in visible)
            outbox_summary += f"/{desire_state.pent_up_stage(oldest, now)}"

        desire_state.append_jsonl(
            state_dir / "ticks.jsonl",
            {
                "at": now.isoformat(),
                "social": round(levels["social"], 1),
                "curiosity": round(levels["curiosity"], 1),
                "accomplishment": round(levels["accomplishment"], 1),
                "transport": transport["state"],
                "outbox": len(visible),
                "last_interaction_at": drives["last_interaction_at"],
            },
        )

        score_artefacts(state_dir, now, observed)

        remaining_signals = max(0, desire_state.CAPS["signals"] - budget["signals"])
        remaining_issues = max(0, desire_state.CAPS["issues"] - budget["issues"])
        remaining_comments = max(0, desire_state.CAPS["self_comments"] - budget["self_comments"])
        remaining_prs = max(0, desire_state.CAPS["prs"] - budget["prs"])
        return (
            f"social:{latched['social']} "
            f"curiosity:{latched['curiosity']} "
            f"accomplishment:{latched['accomplishment']} "
            f"outbox:{outbox_summary} "
            f"transport:{transport['state']} "
            f"budget:{remaining_signals}/3sig {remaining_issues}/2iss {remaining_comments}/1cmt "
            f"{remaining_prs}/1pr "
            f"day:{desire_state.wake_day(now)} "
            f"rises:{rises} "
            f"starved:{starved['social']}/{starved['curiosity']}/{starved['accomplishment']}\n"
        )


def _fallback_summary() -> str:
    """Name the wake day so a sustained failure still wakes the tick once a day."""

    try:
        day = desire_state.wake_day(datetime.now(desire_state.KST))
    except Exception:  # noqa: BLE001 - an unreadable clock still owes the cron a summary
        day = "unknown"
    return (
        "social:low curiosity:mid accomplishment:mid outbox:0 transport:down "
        f"budget:3/3sig 2/2iss 1/1cmt 1/1pr day:{day} rises:0 starved:0/0/0\n"
    )


def main() -> None:
    try:
        now = datetime.now(desire_state.KST)
        summary = run(now)
    except Exception:  # noqa: BLE001 - the hash-gated cron must always receive a valid summary
        summary = _fallback_summary()
    print(summary, end="")


if __name__ == "__main__":
    main()
