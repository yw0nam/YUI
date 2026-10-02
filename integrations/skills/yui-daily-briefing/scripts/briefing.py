#!/usr/bin/env python3
"""Keeps daily briefings as dated markdown files and records which ones the agent has spoken."""
import argparse
import datetime
import fcntl
import glob
import json
import os
import re
import sys
import urllib.parse

SUMMARY_MAX = 200
SOURCES_MAX = 10
NAME_MAX = 40
REFS_MAX = 30
KIND_MAX = 40
TITLE_MAX = 200
EXCERPT_MAX = 280
URL_MAX = 2048
STATUSES = ("ok", "stale", "failed", "disabled")
LEDGER = "spoken.json"
BRIEFING_PATH = re.compile(r"\d{4}-\d{2}-\d{2}/[^/\\]+\.md")


def clip(value, cap):
    cleaned = " ".join(str(value if value is not None else "").split())
    return cleaned[: cap - 1] + "…" if len(cleaned) > cap else cleaned


def one_line(value):
    return " ".join(str(value).split())


def http_url(value):
    return isinstance(value, str) and value.startswith(("http://", "https://")) and len(value) <= URL_MAX


def source_entry(raw):
    if not isinstance(raw, dict) or raw.get("status") not in STATUSES:
        raise ValueError(f"source needs a name and a status in {STATUSES}: {json.dumps(raw)[:80]}")
    entry = {"name": clip(raw.get("name"), NAME_MAX), "status": raw["status"]}
    if not entry["name"]:
        raise ValueError("source without a name")
    if raw.get("last_ok"):
        entry["last_ok"] = one_line(raw["last_ok"])
    if http_url(raw.get("run_url")):
        entry["run_url"] = raw["run_url"]
    return entry


def ref_entry(raw, now_iso):
    if not isinstance(raw, dict) or not http_url(raw.get("url")):
        return None
    return {
        "kind": clip(raw.get("kind"), KIND_MAX) or "other",
        "title": clip(raw.get("title"), TITLE_MAX) or clip(raw["url"], TITLE_MAX),
        "url": raw["url"],
        "at": one_line(raw.get("at") or now_iso),
        "excerpt": clip(raw.get("excerpt"), EXCERPT_MAX),
    }


def compose(raw, now_iso):
    if not isinstance(raw, dict) or not isinstance(raw.get("sources"), list) or not isinstance(raw.get("refs"), list):
        raise ValueError("stdin must hold a JSON object with sources[] and refs[]")
    sources = [source_entry(entry) for entry in raw["sources"][:SOURCES_MAX]]
    refs = []
    seen = set()
    for entry in raw["refs"]:
        ref = ref_entry(entry, now_iso)
        if ref is None or ref["url"] in seen:
            continue
        seen.add(ref["url"])
        refs.append(ref)
    summary = clip(raw.get("summary"), SUMMARY_MAX) or f"{len(refs)} items"
    return {"summary": summary, "sources": sources, "refs": refs[:REFS_MAX]}


def failed(source, error):
    return {"summary": clip(f"{source} run failed: {type(error).__name__}: {error}", SUMMARY_MAX),
            "sources": [{"name": source, "status": "failed"}], "refs": []}


def render(briefing, source, date, now_iso):
    # JSON strings are valid YAML double-quoted scalars.
    q = lambda value: json.dumps(value, ensure_ascii=False)
    lines = ["---", f"source: {q(source)}", f"date: {q(date)}", f"generated_at: {q(now_iso)}",
             f"summary: {q(briefing['summary'])}", "sources:" if briefing["sources"] else "sources: []"]
    for entry in briefing["sources"]:
        lines.append("  - {" + ", ".join(f"{key}: {q(value)}" for key, value in entry.items()) + "}")
    lines += ["---", "", f"# {briefing['summary']}", ""]
    for number, ref in enumerate(briefing["refs"], 1):
        title = re.sub(r"([\[\]\\])", r"\\\1", ref["title"])
        url = re.sub(r"[\s<>]", lambda match: urllib.parse.quote(match.group()), ref["url"])
        lines += [f"{number}. [{title}](<{url}>)", f"   {ref['kind']} · {ref['at']}"]
        if ref["excerpt"]:
            lines.append(f"   {ref['excerpt']}")
    return "\n".join(lines) + "\n"


def lock(spool):
    os.makedirs(spool, exist_ok=True)
    handle = open(os.path.join(spool, ".lock"), "w")
    fcntl.flock(handle, fcntl.LOCK_EX)
    return handle


def load_ledger(spool, set_aside):
    path = os.path.join(spool, LEDGER)
    try:
        with open(path, encoding="utf-8") as file:
            ledger = json.load(file)
        if isinstance(ledger, dict):
            return ledger
    except FileNotFoundError:
        return {}
    except (OSError, ValueError):
        pass
    if set_aside:
        os.replace(path, path + ".bad")
        print(f"unreadable ledger, set aside as {path}.bad", file=sys.stderr)
    else:
        print(f"unreadable ledger {path}, reading every briefing as unspoken", file=sys.stderr)
    return {}


def write_file(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path + ".tmp", "w", encoding="utf-8") as file:
        file.write(text)
    os.replace(path + ".tmp", path)


def write(spool, source):
    now = datetime.datetime.now().astimezone()
    date = now.date().isoformat()
    error = None
    try:
        briefing = compose(json.load(sys.stdin), now.isoformat(timespec="seconds"))
    except Exception as caught:
        error = caught
        briefing = failed(source, caught)
    with lock(spool):
        name = f"{source}.md"
        if f"{date}/{name}" in load_ledger(spool, set_aside=True):
            name = f"{source}.{now:%H%M%S}.md"
        path = os.path.join(spool, date, name)
        # An unspoken briefing from an earlier run of the day outranks a failed one.
        if error is None or not os.path.exists(path):
            write_file(path, render(briefing, source, date, now.isoformat(timespec="seconds")))
    if error is not None:
        print(f"{type(error).__name__}: {error}", file=sys.stderr)
        return 1
    return 0


def pending(spool):
    spoken = load_ledger(spool, set_aside=False)
    for path in sorted(glob.glob(os.path.join(spool, "????-??-??", "*.md"))):
        relative = os.path.relpath(path, spool)
        if relative in spoken:
            continue
        with open(path, encoding="utf-8") as file:
            print(f"=== {relative} ===\n{file.read()}")
    return 0


def mark_spoken(spool, paths):
    for path in paths:
        if not BRIEFING_PATH.fullmatch(path) or not os.path.isfile(os.path.join(spool, path)):
            print(f"not a briefing in the spool: {path}", file=sys.stderr)
            return 2
    with lock(spool):
        ledger = load_ledger(spool, set_aside=True)
        stamp = datetime.datetime.now().astimezone().isoformat(timespec="seconds")
        ledger.update({path: stamp for path in paths})
        write_file(os.path.join(spool, LEDGER), json.dumps(ledger, ensure_ascii=False, indent=1) + "\n")
    return 0


def main():
    parser = argparse.ArgumentParser(description="Keep YUI daily briefings as dated markdown files.")
    parser.add_argument("--spool", default=os.environ.get("YUI_BRIEFING_SPOOL") or "~/.local/state/yui-daily-briefing/spool",
                        help="spool directory; default $YUI_BRIEFING_SPOOL")
    commands = parser.add_subparsers(dest="command", required=True)
    write_parser = commands.add_parser("write", help="write today's briefing from the gather JSON on stdin")
    write_parser.add_argument("--source", required=True, help="producer name of 1-40 letters, digits, '_' or '-'")
    commands.add_parser("pending", help="print every briefing not yet spoken")
    mark_parser = commands.add_parser("mark-spoken", help="record briefings as spoken")
    mark_parser.add_argument("paths", nargs="+", metavar="PATH", help="path relative to the spool, as pending prints it")
    args = parser.parse_args()
    os.umask(0o077)
    spool = os.path.expanduser(args.spool)
    if args.command == "write":
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,40}", args.source):
            write_parser.error("--source takes 1 to 40 letters, digits, '_' or '-'")
        return write(spool, args.source)
    if args.command == "pending":
        return pending(spool)
    return mark_spoken(spool, args.paths)


if __name__ == "__main__":
    sys.exit(main())
