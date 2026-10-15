#!/usr/bin/env python3
"""Keeps daily briefings as markdown files in day folders, records which ones the agent has spoken, and publishes them."""
import argparse
import datetime
import errno
import glob
import json
import os
import re
import subprocess
import sys
import unicodedata
import urllib.parse

if os.name == "nt":
    import msvcrt
else:
    import fcntl

SUMMARY_MAX = 200
SOURCES_MAX = 10
NAME_MAX = 40
REFS_MAX = 30
KIND_MAX = 40
TITLE_MAX = 200
EXCERPT_MAX = 280
URL_MAX = 2048
TIME_MAX = 64
STATUSES = ("ok", "stale", "failed", "disabled")
LEDGER = "spoken.json"
BRIEFING_PATH = re.compile(r"reports/\d{4}/\d{2}/W[1-5]/\d{2}/[^./\\][^/\\]*\.md")
OLD_DAY = re.compile(r"\d{4}-\d{2}-\d{2}")


def spool_relative(path, spool):
    return os.path.relpath(path, spool).replace(os.sep, "/")


def day_folder(date):
    # W1 holds days 1-7, W2 8-14, W3 15-21, W4 22-28, W5 29-31.
    return f"reports/{date:%Y}/{date:%m}/W{(date.day - 1) // 7 + 1}/{date:%d}"


def unwritable(char):
    # Control characters, lone surrogates, and U+FFFE/U+FFFF break YAML or UTF-8.
    return unicodedata.category(char) in ("Cc", "Cs") or char in "￾￿"


def one_line(value):
    return " ".join("".join(" " if unwritable(char) else char for char in str(value)).split())


def clip(value, cap):
    cleaned = one_line(value if value is not None else "")
    return cleaned[: cap - 1] + "…" if len(cleaned) > cap else cleaned


def http_url(value):
    return (isinstance(value, str) and value.startswith(("http://", "https://")) and len(value) <= URL_MAX
            and not any(unwritable(char) for char in value))


def source_entry(raw):
    if not isinstance(raw, dict) or raw.get("status") not in STATUSES:
        raise ValueError(f"source needs a name and a status in {STATUSES}: {json.dumps(raw)[:80]}")
    entry = {"name": clip(raw.get("name"), NAME_MAX), "status": raw["status"]}
    if not entry["name"]:
        raise ValueError("source without a name")
    if raw.get("last_ok"):
        entry["last_ok"] = clip(raw["last_ok"], TIME_MAX)
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
        "at": clip(raw.get("at") or now_iso, TIME_MAX),
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
        url = re.sub(r"[\s<>\\]", lambda match: urllib.parse.quote(match.group()), ref["url"])
        lines += [f"{number}. [{title}](<{url}>)", f"   {ref['kind']} · {ref['at']}"]
        if ref["excerpt"]:
            lines.append(f"   {ref['excerpt']}")
    return "\n".join(lines) + "\n"


def lock(spool):
    os.makedirs(spool, exist_ok=True)
    handle = open(os.path.join(spool, ".lock"), "a+b")
    if os.name == "nt":
        handle.seek(0)
        while True:
            try:
                msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK, 1)
                break
            except OSError as error:
                # LK_LOCK gives up after ten one-second tries with EDEADLK.
                if error.errno != errno.EDEADLK:
                    raise
    else:
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
    with open(path + ".tmp", "w", encoding="utf-8", newline="") as file:
        file.write(text)
    os.replace(path + ".tmp", path)


def write(spool, source):
    stdin = sys.stdin.buffer.read()
    now = datetime.datetime.now().astimezone()
    date, now_iso = now.date().isoformat(), now.isoformat(timespec="seconds")
    try:
        briefing, error = compose(json.loads(stdin), now_iso), None
    except Exception as caught:
        briefing, error = failed(source, caught), caught
    with lock(spool):
        spoken = load_ledger(spool, set_aside=False)
        day = os.path.join(spool, *day_folder(now.date()).split("/"))
        existing = glob.glob(os.path.join(day, f"{source}.md")) + glob.glob(os.path.join(day, f"{source}.{'[0-9]' * 12}.md"))
        # Each source keeps at most one unspoken briefing per day; a spoken one never changes.
        unspoken = [path for path in existing if spool_relative(path, spool) not in spoken]
        path = unspoken[0] if unspoken else os.path.join(day, f"{source}.{now:%H%M%S%f}.md" if existing else f"{source}.md")
        # An unspoken briefing from an earlier run of the day outranks a failed one.
        if error is None or not unspoken:
            write_file(path, render(briefing, source, date, now_iso))
    if error is not None:
        print(f"{type(error).__name__}: {error}", file=sys.stderr)
        return 1
    return 0


def briefings(spool):
    pattern = os.path.join(spool, "reports", "????", "??", "W?", "??", "*.md")
    paths = (spool_relative(path, spool) for path in sorted(glob.glob(pattern)))
    return [path for path in paths if BRIEFING_PATH.fullmatch(path)]


def pending(spool):
    spoken = load_ledger(spool, set_aside=False)
    for relative in briefings(spool):
        if relative in spoken:
            continue
        with open(os.path.join(spool, relative), encoding="utf-8", errors="replace") as file:
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


def git(spool, *args):
    return subprocess.run(["git", "-C", spool, *args], capture_output=True, encoding="utf-8", errors="replace")


def git_failed(result):
    lines = (result.stderr + result.stdout).strip().splitlines() or [f"exit {result.returncode}"]
    reason = next((line for line in lines if line.startswith(("fatal:", "error:"))), lines[0])
    print(f"git {result.args[3]} failed: {reason}", file=sys.stderr)
    return 1


def own_work_tree(spool):
    try:
        top = git(spool, "rev-parse", "--show-toplevel")
    except FileNotFoundError:
        return None
    # A spool nested in another work tree would commit and push that repository.
    return top.returncode == 0 and os.path.samefile(top.stdout.strip(), spool)


def publish(spool):
    work_tree = own_work_tree(spool)
    if work_tree is None:
        print("git is not on PATH", file=sys.stderr)
        return 2
    if not work_tree:
        print(f"the spool is not the top of a git work tree: {spool}", file=sys.stderr)
        return 2
    remotes = git(spool, "remote").stdout.split()
    if not remotes:
        print(f"the spool repository has no remote: {spool}", file=sys.stderr)
        return 2
    paths = briefings(spool)
    if os.path.isfile(os.path.join(spool, ".gitignore")):
        paths.append(".gitignore")
    if paths:
        added = git(spool, "add", "--", *paths)
        if added.returncode != 0:
            return git_failed(added)
        # Pathspecs keep anything else in the index out of the commit.
        if git(spool, "diff", "--cached", "--quiet", "--", *paths).returncode != 0:
            committed = git(spool, "commit", "--quiet", "-m", datetime.date.today().isoformat(), "--", *paths)
            if committed.returncode != 0:
                return git_failed(committed)
    pushed = git(spool, "push", "--quiet", remotes[0], "HEAD")
    return git_failed(pushed) if pushed.returncode != 0 else 0


def old_days(spool):
    days = []
    for name in sorted(os.listdir(spool)):
        if OLD_DAY.fullmatch(name) and os.path.isdir(os.path.join(spool, name)):
            try:
                days.append((name, datetime.date.fromisoformat(name)))
            except ValueError:
                continue
    return days


def new_path(path):
    day, _, rest = path.partition("/")
    try:
        return f"{day_folder(datetime.date.fromisoformat(day))}/{rest}" if OLD_DAY.fullmatch(day) and rest else path
    except ValueError:
        return path


def migrate(spool):
    with lock(spool):
        moves = [(f"{name}/{file}", f"{day_folder(date)}/{file}")
                 for name, date in old_days(spool) for file in sorted(os.listdir(os.path.join(spool, name)))]
        for _, new in moves:
            if os.path.lexists(os.path.join(spool, new)):
                print(f"a file already sits at {new}; nothing was moved", file=sys.stderr)
                return 2
        work_tree = own_work_tree(spool)
        tracked = set(git(spool, "ls-files", "-z").stdout.split("\0")) if work_tree else set()
        for old, new in moves:
            os.makedirs(os.path.dirname(os.path.join(spool, new)), exist_ok=True)
            # git mv records the move as a rename, so `git log --follow` crosses it.
            moved = git(spool, "mv", "--", old, new) if old in tracked else None
            if moved is None:
                os.replace(os.path.join(spool, old), os.path.join(spool, new))
            elif moved.returncode != 0:
                return git_failed(moved)
        for name, _ in old_days(spool):
            os.rmdir(os.path.join(spool, name))
        # Every old-form key is rewritten, so a run cut short by a git failure is healed by the next one.
        ledger = load_ledger(spool, set_aside=False)
        if any(new_path(path) != path for path in ledger):
            ledger = {new_path(path): stamp for path, stamp in ledger.items()}
            write_file(os.path.join(spool, LEDGER), json.dumps(ledger, ensure_ascii=False, indent=1) + "\n")
        old_in_head = [name for name in git(spool, "ls-tree", "--name-only", "HEAD").stdout.split("\n")
                       if OLD_DAY.fullmatch(name)] if work_tree else []
        if old_in_head:
            committed = git(spool, "commit", "--quiet", "-m", "Move briefings into reports/", "--", *old_in_head, "reports")
            if committed.returncode != 0:
                return git_failed(committed)
    return 0


def main():
    if os.name == "nt" and hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", newline="\n")
        sys.stderr.reconfigure(encoding="utf-8", errors="backslashreplace", newline="\n")
    parser = argparse.ArgumentParser(description="Keep YUI daily briefings as markdown files in day folders.")
    parser.add_argument("--spool", default=os.environ.get("YUI_BRIEFING_SPOOL"), help="spool directory; default $YUI_BRIEFING_SPOOL")
    commands = parser.add_subparsers(dest="command", required=True)
    write_parser = commands.add_parser("write", help="write today's briefing from the gather JSON on stdin")
    write_parser.add_argument("--source", required=True, help="producer name of 1-40 letters, digits, '_' or '-'")
    commands.add_parser("pending", help="print every briefing not yet spoken")
    mark_parser = commands.add_parser("mark-spoken", help="record briefings as spoken")
    mark_parser.add_argument("paths", nargs="+", metavar="PATH", help="path relative to the spool, as pending prints it")
    commands.add_parser("publish", help="commit the briefings and push them to the spool's git remote")
    commands.add_parser("migrate", help="move <YYYY-MM-DD>/ folders at the spool root into reports/")
    args = parser.parse_args()
    spool = args.spool
    if not spool:
        print("set YUI_BRIEFING_SPOOL or pass --spool", file=sys.stderr)
        return 2
    if not os.path.isabs(spool):
        print(f"the spool path must be absolute: {spool}", file=sys.stderr)
        return 2
    if args.command != "write" and not os.path.isdir(spool):
        print(f"no spool directory at {spool}", file=sys.stderr)
        return 2
    os.umask(0o077)
    if args.command == "write":
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,40}", args.source):
            write_parser.error("--source takes 1 to 40 letters, digits, '_' or '-'")
        return write(spool, args.source)
    if args.command == "pending":
        return pending(spool)
    if args.command == "publish":
        return publish(spool)
    if args.command == "migrate":
        return migrate(spool)
    return mark_spoken(spool, args.paths)


if __name__ == "__main__":
    sys.exit(main())
