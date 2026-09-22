#!/usr/bin/env python3
"""Posts the YUI daily briefing from a JSONL queue, then marks its rows sent."""
import argparse
import datetime
import json
import os
import shutil
import sys
import tempfile
import time
import urllib.error
import urllib.request

STALE_HOURS = 72
MAX_REFS = 30
TITLE_MAX = 200
EXCERPT_MAX = 280
SUMMARY_MAX = 200
URL_MAX = 2048
BODY_MAX_BYTES = 48 * 1024
SOURCES_MAX = 10
NAME_MAX = 40
KIND = {"github_pr": "pull_request", "github_issue": "issue", "gmail": "mail"}
LABEL = {"pull_request": "pull request", "issue": "issue", "mail": "mail", "other": "other"}

def parse_ms(value):
    # Epoch milliseconds for an ISO-8601 instant; a value without a zone reads as UTC, else None.
    if not isinstance(value, str):
        return None
    text = value.strip()
    if text[-1:] in ("Z", "z"):
        text = text[:-1] + "+00:00"
    if len(text) > 19 and text[19] == ".":
        end = 20
        while end < len(text) and text[end].isdigit():
            end += 1
        text = text[:19] + "." + (text[20:end] + "000")[:6] + text[end:]
    try:
        parsed = datetime.datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        # A value without a zone reads as UTC.
        parsed = parsed.replace(tzinfo=datetime.timezone.utc)
    return round(parsed.timestamp() * 1000)

def iso(ms):
    # JavaScript Date.prototype.toISOString() shape.
    moment = datetime.datetime(1970, 1, 1, tzinfo=datetime.timezone.utc) + datetime.timedelta(milliseconds=ms)
    return moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{ms % 1000:03d}Z"

def clip(value, cap):
    cleaned = " ".join(str(value or "").split())
    return cleaned[: cap - 1] + "…" if len(cleaned) > cap else cleaned

def load_rows(path):
    rows = []
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            row = json.loads(line)
            if not isinstance(row, dict):
                raise ValueError(f"queue line is not a JSON object: {line.strip()[:60]}")
            rows.append(row)
    return rows

def serialize(summary, sources, refs, envelope):
    item = {"skill": "yui-daily-briefing", "summary": summary, "sources": sources, "refs": refs}
    return json.dumps({"signals": [item], "envelope": envelope}, ensure_ascii=False, separators=(",", ":"))

def compose(rows, names, stale_hours, now_ms):
    pending = sorted((row for row in rows if row.get("status") == "pending"),
                     key=lambda row: parse_ms(row.get("createdAt")) or 0, reverse=True)
    refs = []
    counts = {}
    seen = set()
    for row in pending:
        try:
            payload = json.loads(row.get("payload"))
        except (TypeError, ValueError):
            payload = None
        if not isinstance(payload, dict):
            payload = {}
        kind = KIND.get(payload.get("source"), "other")
        url = payload.get("url") or ""
        if not url and payload.get("source") == "gmail" and payload.get("thread_id"):
            url = "https://mail.google.com/mail/#inbox/" + str(payload["thread_id"])
        url = str(url) if url and not isinstance(url, str) else url
        if url in seen:
            continue
        if url:
            seen.add(url)
        counts[kind] = counts.get(kind, 0) + 1
        if not url.startswith(("http://", "https://")) or len(url) > URL_MAX or len(refs) >= MAX_REFS:
            continue
        stamps = (parse_ms(payload.get("updated_at")), parse_ms(payload.get("date")), parse_ms(row.get("createdAt")))
        at = next((stamp for stamp in stamps if stamp is not None), now_ms)
        title = clip(payload.get("title") or payload.get("subject") or row.get("key"), TITLE_MAX)
        excerpt = clip(payload.get("snippet"), EXCERPT_MAX)
        refs.append({"kind": kind, "title": title, "url": url, "at": iso(at), "excerpt": excerpt})
    oldest = pending[-1].get("createdAt") if pending else None
    since = oldest[:16].replace("T", " ") if isinstance(oldest, str) else (
        datetime.datetime.now().astimezone() - datetime.timedelta(days=1)
    ).strftime("%Y-%m-%d %H:%M")
    parts = [f"{count} {LABEL[kind]}" + ("" if count == 1 else "s") for kind, count in counts.items()]
    summary = clip((", ".join(parts) or "nothing new") + " since " + since, SUMMARY_MAX)
    sources = []
    for name in names:
        stamps = [
            ms for ms in (parse_ms(row.get("createdAt")) for row in rows if row.get("source") == name)
            if ms is not None
        ]
        if not stamps:
            sources.append({"name": name, "status": "stale"})
            continue
        newest = max(stamps)
        status = "ok" if now_ms - newest <= stale_hours * 3600 * 1000 else "stale"
        sources.append({"name": name, "status": status, "last_ok": iso(newest)})
    day = datetime.datetime.fromtimestamp(now_ms // 1000).strftime("%Y-%m-%d")
    envelope = {"source": "cron", "event_type": "daily_briefing", "delivery": "immediate",
                "event_id": "daily-briefing:" + day, "occurred_at": now_ms}
    body = serialize(summary, sources, refs, envelope)
    while len(body.encode("utf-8")) > BODY_MAX_BYTES and refs:
        refs.pop()
        body = serialize(summary, sources, refs, envelope)
    if len(body.encode("utf-8")) > BODY_MAX_BYTES:
        raise ValueError("briefing body stays over the size cap with no refs left to drop")
    return body, len(pending), len(refs)

def post(url, body):
    request = urllib.request.Request(url, data=body.encode("utf-8"), headers={"content-type": "application/json"}, method="POST")
    with urllib.request.urlopen(request, timeout=10):
        pass

def post_error(url, error):
    # A raised run posts the contract's source_health group itself; a failed post still exits 1.
    now_ms = int(time.time() * 1000)
    summary = clip(f"daily-briefing run failed: {type(error).__name__}: {error}", SUMMARY_MAX)
    envelope = {"source": "cron", "event_type": "source_health", "delivery": "immediate",
                "event_id": f"source-health:daily-briefing:{now_ms}", "occurred_at": now_ms}
    try:
        post(url, serialize(summary, [{"name": "daily-briefing", "status": "failed"}], [], envelope))
    except Exception:
        pass

def mark_sent(path, keys, sent_at):
    # Collectors may append lines during the post, so re-read instead of writing back step 1's rows.
    with open(path, encoding="utf-8") as handle:
        lines = handle.readlines()
    marked = 0
    rewritten = []
    for line in lines:
        text = line.rstrip("\n")
        if not text.strip():
            continue
        try:
            row = json.loads(text)
        except ValueError:
            row = None
        if not isinstance(row, dict):
            # A collector may append a torn line during the post, so write it back verbatim.
            rewritten.append(text)
            continue
        if row.get("status") == "pending" and row.get("key") in keys:
            row["status"] = "sent"
            row["sent_at"] = sent_at
            marked += 1
        rewritten.append(json.dumps(row, ensure_ascii=False))
    handle, temp = tempfile.mkstemp(dir=os.path.dirname(os.path.abspath(path)), suffix=".jsonl")
    with os.fdopen(handle, "w", encoding="utf-8") as sink:
        sink.write("".join(entry + "\n" for entry in rewritten))
    shutil.copymode(path, temp)
    os.replace(temp, path)
    return marked

def main():
    parser = argparse.ArgumentParser(description="Post the YUI daily briefing from a JSONL queue and mark its rows sent.")
    parser.add_argument("--queue", required=True, help="path of the JSONL queue file")
    parser.add_argument("--url", default=os.environ.get("YUI_SIGNALS_URL") or "http://127.0.0.1:8770", help="signals ingress base URL")
    parser.add_argument("--sources", default="repo-status,gmail", help="comma-separated source names")
    parser.add_argument("--stale-hours", type=float, default=STALE_HOURS, help="source freshness window in hours")
    args = parser.parse_args()
    names = []
    for name in (part.strip()[:NAME_MAX] for part in args.sources.split(",")):
        if name and name not in names:
            names.append(name)
    names = names[:SOURCES_MAX]
    url = args.url + "/signals"
    pending_count = 0
    try:
        rows = load_rows(args.queue)
        body, pending_count, ref_count = compose(rows, names, args.stale_hours, int(time.time() * 1000))
        post(url, body)
    except urllib.error.HTTPError as error:
        print(f"yui answered {error.code}, {pending_count} rows left pending", file=sys.stderr)
        return 1
    except urllib.error.URLError:
        print(f"yui unreachable, {pending_count} rows left pending", file=sys.stderr)
        return 0
    except Exception as error:
        post_error(url, error)
        print(f"{type(error).__name__}: {error}", file=sys.stderr)
        return 1
    try:
        keys = {row.get("key") for row in rows if row.get("status") == "pending"}
        marked = mark_sent(args.queue, keys, iso(int(time.time() * 1000)))
    except Exception as error:
        # The briefing already posted, so a marking failure must not post a false run-failure.
        print(f"marked 0 rows: {type(error).__name__}: {error}", file=sys.stderr)
        return 1
    print(f"sent {marked} rows, {ref_count} refs")
    return 0

if __name__ == "__main__":
    sys.exit(main())
