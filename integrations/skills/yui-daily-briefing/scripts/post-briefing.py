#!/usr/bin/env python3
"""Reads a briefing item from stdin, applies the contract's caps, and posts it to YUI."""
import argparse
import datetime
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


def clip(value, cap):
    cleaned = " ".join(str(value if value is not None else "").split())
    return cleaned[: cap - 1] + "…" if len(cleaned) > cap else cleaned


def iso(ms):
    moment = datetime.datetime(1970, 1, 1, tzinfo=datetime.timezone.utc) + datetime.timedelta(milliseconds=ms)
    return moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{ms % 1000:03d}Z"


def http_url(value):
    return isinstance(value, str) and value.startswith(("http://", "https://")) and len(value) <= URL_MAX


def serialize(summary, sources, refs, envelope):
    item = {"skill": "yui-daily-briefing", "summary": summary, "sources": sources, "refs": refs}
    return json.dumps({"signals": [item], "envelope": envelope}, ensure_ascii=False, separators=(",", ":"))


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


def ref_entry(raw, now_ms):
    if not isinstance(raw, dict) or not http_url(raw.get("url")):
        return None
    return {
        "kind": clip(raw.get("kind"), KIND_MAX) or "other",
        "title": clip(raw.get("title"), TITLE_MAX) or clip(raw["url"], TITLE_MAX),
        "url": raw["url"],
        "at": str(raw.get("at") or iso(now_ms)),
        "excerpt": clip(raw.get("excerpt"), EXCERPT_MAX),
    }


def compose(item, source, event_id, now_ms):
    if not isinstance(item, dict) or not isinstance(item.get("sources"), list) or not isinstance(item.get("refs"), list):
        raise ValueError("stdin must hold a JSON object with sources[] and refs[]")
    sources = [source_entry(raw) for raw in item["sources"][:SOURCES_MAX]]
    refs = []
    seen = set()
    for raw in item["refs"]:
        ref = ref_entry(raw, now_ms)
        if ref is None or ref["url"] in seen:
            continue
        seen.add(ref["url"])
        refs.append(ref)
        if len(refs) == REFS_MAX:
            break
    summary = clip(item.get("summary"), SUMMARY_MAX) or f"{len(refs)} items"
    envelope = {"source": source, "event_type": "daily_briefing", "delivery": "immediate",
                "event_id": event_id, "occurred_at": now_ms}
    body = serialize(summary, sources, refs, envelope)
    while len(body.encode("utf-8")) > BODY_MAX_BYTES and refs:
        refs.pop()
        body = serialize(summary, sources, refs, envelope)
    if len(body.encode("utf-8")) > BODY_MAX_BYTES:
        raise ValueError("briefing body stays over the size cap with no refs left to drop")
    return body


def post(url, body):
    request = urllib.request.Request(url, data=body.encode("utf-8"), headers={"content-type": "application/json"}, method="POST")
    with urllib.request.urlopen(request, timeout=10):
        pass


def post_error(url, source, error):
    # A raised run reports itself as a failed source; a failed report still exits 1.
    now_ms = int(time.time() * 1000)
    summary = clip(f"{source} run failed: {type(error).__name__}: {error}", SUMMARY_MAX)
    envelope = {"source": source, "event_type": "source_health", "delivery": "immediate",
                "event_id": f"source-health:{source}:{now_ms}", "occurred_at": now_ms}
    try:
        post(url, serialize(summary, [{"name": clip(source, NAME_MAX), "status": "failed"}], [], envelope))
    except Exception:
        pass


def main():
    parser = argparse.ArgumentParser(description="Post a YUI daily briefing item read from stdin.")
    parser.add_argument("--url", default=os.environ.get("YUI_SIGNALS_URL") or "http://127.0.0.1:8770", help="signals ingress base URL")
    parser.add_argument("--source", default="cron", help="producer name for the envelope")
    parser.add_argument("--event-id", default=None, help="envelope event id; default daily-briefing:<today>")
    parser.add_argument("--dry-run", action="store_true", help="print the request instead of posting it")
    args = parser.parse_args()
    url = args.url.rstrip("/") + "/signals"
    now_ms = int(time.time() * 1000)
    event_id = args.event_id or "daily-briefing:" + datetime.datetime.fromtimestamp(now_ms // 1000).strftime("%Y-%m-%d")
    try:
        body = compose(json.load(sys.stdin), args.source, event_id, now_ms)
        if args.dry_run:
            print(body)
            return 0
        post(url, body)
    except urllib.error.HTTPError as error:
        print(f"yui answered {error.code}", file=sys.stderr)
        return 1
    except (urllib.error.URLError, TimeoutError):
        print("yui unreachable", file=sys.stderr)
        return 0
    except Exception as error:
        if not args.dry_run:
            post_error(url, args.source, error)
        print(f"{type(error).__name__}: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
