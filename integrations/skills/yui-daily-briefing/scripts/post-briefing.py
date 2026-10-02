#!/usr/bin/env python3
"""Spools a briefing item read from stdin under its day, then posts every pending item to YUI."""
import argparse
import datetime
import fcntl
import glob
import json
import os
import sys
import time
import urllib.error
import urllib.request

SUMMARY_MAX = 200
SOURCES_MAX = 10
NAME_MAX = 40
REFS_MAX = 30
KIND_MAX = 40
TITLE_MAX = 200
EXCERPT_MAX = 280
URL_MAX = 2048
BODY_MAX_BYTES = 48 * 1024
STATUSES = ("ok", "stale", "failed", "disabled")
SPOOL = os.environ.get("YUI_BRIEFING_SPOOL") or "~/.local/state/yui-daily-briefing/spool"


def clip(value, cap):
    cleaned = " ".join(str(value if value is not None else "").split())
    return cleaned[: cap - 1] + "…" if len(cleaned) > cap else cleaned


def http_url(value):
    return isinstance(value, str) and value.startswith(("http://", "https://")) and len(value) <= URL_MAX


def body(items, source, now_ms):
    envelope = {"source": source, "event_type": "daily_briefing", "delivery": "immediate",
                "event_id": "daily-briefing:" + max(item["date"] for item in items), "occurred_at": now_ms}
    return json.dumps({"signals": items, "envelope": envelope}, ensure_ascii=False, separators=(",", ":"))


def fits(items, source, now_ms):
    return len(body(items, source, now_ms).encode("utf-8")) <= BODY_MAX_BYTES


def source_entry(raw):
    if not isinstance(raw, dict) or raw.get("status") not in STATUSES:
        raise ValueError(f"source needs a name and a status in {STATUSES}: {json.dumps(raw)[:80]}")
    entry = {"name": clip(raw.get("name"), NAME_MAX), "status": raw["status"]}
    if not entry["name"]:
        raise ValueError("source without a name")
    if raw.get("last_ok"):
        entry["last_ok"] = str(raw["last_ok"])
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
        "at": str(raw.get("at") or now_iso),
        "excerpt": clip(raw.get("excerpt"), EXCERPT_MAX),
    }


def compose(raw, date, source, now_ms):
    if not isinstance(raw, dict) or not isinstance(raw.get("sources"), list) or not isinstance(raw.get("refs"), list):
        raise ValueError("stdin must hold a JSON object with sources[] and refs[]")
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
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
    item = {"skill": "yui-daily-briefing", "date": date, "summary": summary, "sources": sources, "refs": refs[:REFS_MAX]}
    while not fits([item], source, now_ms) and item["refs"]:
        item["refs"].pop()
    if not fits([item], source, now_ms):
        raise ValueError("briefing body stays over the size cap with no refs left to drop")
    return item


def failed_item(date, source, error):
    return {"skill": "yui-daily-briefing", "date": date,
            "summary": clip(f"{source} run failed: {type(error).__name__}: {error}", SUMMARY_MAX),
            "sources": [{"name": clip(source, NAME_MAX), "status": "failed"}], "refs": []}


def pending(spool):
    paths = sorted(path for path in glob.glob(os.path.join(spool, "????-??-??", "*.json")) if not path.endswith(".sent.json"))
    entries = []
    for path in paths:
        with open(path, encoding="utf-8") as file:
            entries.append((path, json.load(file)))
    return entries


def groups(entries, source, now_ms):
    packed = []
    for path, item in entries:
        if packed and fits([queued for _, queued in packed[-1]] + [item], source, now_ms):
            packed[-1].append((path, item))
        else:
            packed.append([(path, item)])
    return packed


def post(url, payload):
    request = urllib.request.Request(url, data=payload.encode("utf-8"), headers={"content-type": "application/json"}, method="POST")
    with urllib.request.urlopen(request, timeout=10):
        pass


def deliver(url, entries, source, quiet):
    now_ms = int(time.time() * 1000)
    for group in groups(entries, source, now_ms):
        try:
            post(url, body([item for _, item in group], source, now_ms))
        except urllib.error.HTTPError as error:
            print(f"yui answered {error.code}", file=sys.stderr)
            return 1
        except OSError:
            if not quiet:
                print("yui unreachable", file=sys.stderr)
            return 0
        for path, _ in group:
            os.replace(path, path[: -len(".json")] + ".sent.json")
    return 0


def lock(spool, wait):
    os.makedirs(spool, exist_ok=True)
    handle = open(os.path.join(spool, ".lock"), "w")
    try:
        fcntl.flock(handle, fcntl.LOCK_EX if wait else fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        return None
    return handle


def write_item(path, item):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path + ".tmp", "w", encoding="utf-8") as file:
        json.dump(item, file, ensure_ascii=False)
    os.replace(path + ".tmp", path)


def main():
    parser = argparse.ArgumentParser(description="Spool a YUI daily briefing item read from stdin and post every pending item.")
    parser.add_argument("--url", default=os.environ.get("YUI_SIGNALS_URL") or "http://127.0.0.1:8770", help="signals ingress base URL")
    parser.add_argument("--source", default="cron", help="producer name: the spool file name and the envelope source")
    parser.add_argument("--spool", default=SPOOL, help="spool directory; default $YUI_BRIEFING_SPOOL")
    parser.add_argument("--flush", action="store_true", help="read no stdin; post the pending items only")
    parser.add_argument("--dry-run", action="store_true", help="print the request bodies; write and post nothing")
    args = parser.parse_args()
    url = args.url.rstrip("/") + "/signals"
    spool = os.path.expanduser(args.spool)
    date = datetime.date.today().isoformat()
    path = os.path.join(spool, date, args.source + ".json")
    entries = []
    reason = None
    if not args.flush:
        try:
            item = compose(json.load(sys.stdin), date, args.source, int(time.time() * 1000))
        except Exception as error:
            reason = f"{type(error).__name__}: {error}"
            item = failed_item(date, args.source, error)
        entries = [(path, item)]
    if args.dry_run:
        if reason:
            print(reason, file=sys.stderr)
            return 1
        now_ms = int(time.time() * 1000)
        entries = sorted([entry for entry in pending(spool) if entry[0] != path or args.flush] + entries)
        for group in groups(entries, args.source, now_ms):
            print(body([item for _, item in group], args.source, now_ms))
        return 0
    # A run waits for the lock so a flush never marks sent an item the run rewrote meanwhile.
    held = lock(spool, wait=not args.flush)
    if held is None:
        return 0
    for entry_path, item in entries:
        write_item(entry_path, item)
    status = deliver(url, pending(spool), args.source, quiet=args.flush)
    if reason:
        print(reason, file=sys.stderr)
        return 1
    return status


if __name__ == "__main__":
    sys.exit(main())
