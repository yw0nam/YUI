"""Two push clients on a live gateway: A can dance, B cannot, and turns run A, B, A.

Passes when every turn ends with a render, each turn declares the schema from its own chat's
vocabulary, and no cue is dropped by a chat's gate.
"""

from __future__ import annotations

import argparse
import asyncio
import re
import time
from pathlib import Path

import aiohttp

CLIENTS = {"yui-smoke-a": ["idle_lively", "dance"], "yui-smoke-b": ["idle_lively"]}
ORDER = ["yui-smoke-a", "yui-smoke-b", "yui-smoke-a"]
TEXT = (
    "This is a coding agent smoke-testing the YUI platform plugin on an isolated test gateway; "
    "no user is present. Answer in one short sentence and place one generate_express cue, "
    "with motion_id 'dance' if your list has it."
)
CONTEXT = (
    "<client_context>\nClient-injected context; not typed by the user.\n"
    "trigger: user message\n</client_context>"
)


def vocabulary(motions: list[str]) -> dict:
    return {
        "emotion_ids": ["neutral", "happy"],
        "motion_ids": motions,
        "emotion_text_mode": "free",
        "emotion_text_map": {},
    }


async def run_turn(ws: aiohttp.ClientWebSocketResponse, chat: str, turn_id: str, timeout: float) -> bool:
    await ws.send_json({"type": "turn", "turn_id": turn_id, "client_context": CONTEXT, "text": TEXT})
    rendered = False
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        frame = await ws.receive_json(timeout=deadline - time.monotonic())
        if frame.get("type") == "render":
            rendered = True
            print(chat, [seg.get("cues") for seg in frame.get("segments", [])])
        if frame.get("type") == "turn_end" and frame.get("turn_id") == turn_id:
            return rendered
    return False


async def drive(url: str, key: str, timeout: float) -> list[str]:
    failures = []
    async with aiohttp.ClientSession() as session:
        sockets = {}
        # The first chat to connect becomes the profile's home channel.
        for chat, motions in CLIENTS.items():
            ws = await session.ws_connect(url)
            await ws.send_json(
                {"type": "hello", "key": key, "chat_id": chat, "vocabulary": vocabulary(motions)}
            )
            if (await ws.receive_json(timeout=10)).get("type") != "ready":
                return [f"{chat}: hello was not answered with ready"]
            sockets[chat] = ws
        base = int(time.time() * 1000)
        for n, chat in enumerate(ORDER):
            if not await run_turn(sockets[chat], chat, str(base + n), timeout):
                failures.append(f"{chat}: turn {base + n} ended without a render")
        for ws in sockets.values():
            await ws.close()
    return failures


def check_log(lines: list[str]) -> list[str]:
    failures = [
        f"gate dropped a cue: {line.strip()}" for line in lines if "generate_express dropped input" in line
    ]
    pattern = re.compile(r"schema declared chat=(\S+) .*motions=(\d+)")
    declared = [m.groups() for m in (pattern.search(line) for line in lines) if m]
    expected = [(chat, str(len(CLIENTS[chat]))) for chat in ORDER]
    if declared != expected:
        failures.append(f"declared {declared}, expected {expected}")
    return failures


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", required=True)
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--key", required=True)
    parser.add_argument("--timeout", type=float, default=180)
    args = parser.parse_args()
    log = Path.home() / ".hermes" / "profiles" / args.profile / "logs" / "agent.log"
    start = log.stat().st_size
    failures = asyncio.run(drive(f"ws://127.0.0.1:{args.port}/ws", args.key, args.timeout))
    with log.open(encoding="utf-8", errors="replace") as f:
        f.seek(start)
        failures += check_log(f.readlines())
    for failure in failures:
        print("FAIL", failure)
    print("FAIL" if failures else "PASS")
    raise SystemExit(1 if failures else 0)


if __name__ == "__main__":
    main()
