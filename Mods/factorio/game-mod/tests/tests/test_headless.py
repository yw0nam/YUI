import os
import shutil
import subprocess
import time
from pathlib import Path

import pytest
from rcon import wait_for_rcon

GAME_MOD = Path(__file__).parents[2]
HEADLESS = GAME_MOD / "scripts" / "headless.sh"


@pytest.fixture(scope="module")
def server(request):
    bin_path = os.environ.get("FACTORIO_BIN") or request.config.getoption("--factorio-bin")
    if not bin_path:
        pytest.skip("FACTORIO_BIN not set; headless integration skipped")
    workdir = Path(__file__).parent / ".headless-run"
    if workdir.exists():
        shutil.rmtree(workdir)
    proc = subprocess.run(
        ["bash", str(HEADLESS), "--bin", bin_path, str(workdir)],
        capture_output=True,
        text=True,
        timeout=300,
        check=True,
    )
    info = {}
    for line in proc.stdout.splitlines():
        key, _, value = line.partition("=")
        info[key] = value
    port, password, pid = int(info["port"]), info["password"], int(info["pid"])
    rcon = wait_for_rcon("127.0.0.1", port, password)
    yield rcon
    rcon.close()
    subprocess.run(["kill", str(pid)], check=False)
    for _ in range(40):
        if subprocess.run(["kill", "-0", str(pid)], check=False, capture_output=True).returncode != 0:
            break
        time.sleep(0.25)
    else:
        subprocess.run(["kill", "-9", str(pid)], check=False)


def test_status_events_since_say_round_trip(server):
    status = server.rpc({"v": 1, "id": "it-1", "op": "status", "args": {}})
    assert status["v"] == 1
    assert status["ok"] is True
    body = status["r"]
    assert body["mod_version"] == "0.1.0"
    assert isinstance(body["map_id"], str) and body["map_id"]
    assert isinstance(body["seq"], int)
    assert isinstance(body["tick"], int)
    assert body.get("host") is None  # headless: no players (absent means null)

    events = server.rpc(
        {"v": 1, "id": "it-2", "op": "events_since", "args": {"seq": 0}, "map_id": body["map_id"]}
    )
    assert events["ok"] is True, events
    assert set(events["r"]) == {"map_id", "head_seq", "events"}
    assert events["r"]["map_id"] == body["map_id"]
    # the engine may fire the on_nth_tick(3600) summary at tick 0, so the head
    # is only pinned as a baseline here, not as a literal
    head_seq = events["r"]["head_seq"]
    assert head_seq >= 0
    for event in events["r"]["events"]:
        assert set(event) == {"seq", "tick", "kind", "data"}

    said = server.rpc(
        {"v": 1, "id": "it-3", "op": "say", "args": {"text": "hello"}, "map_id": body["map_id"]}
    )
    assert said == {"v": 1, "id": "it-3", "ok": True, "r": {}}

    # say prints to chat but raises no event kind in P0; the ring stays at the same head
    events = server.rpc(
        {"v": 1, "id": "it-4", "op": "events_since", "args": {"seq": 0}, "map_id": body["map_id"]}
    )
    assert events["ok"] is True
    assert events["r"]["head_seq"] == head_seq

    # a wrong map_id is refused on the real server too
    stale = server.rpc({"v": 1, "id": "it-5", "op": "say", "args": {"text": "hi"}, "map_id": "nope"})
    assert stale == {
        "v": 1,
        "id": "it-5",
        "ok": False,
        "e": "stale_session",
        "m": "map_id does not match this map",
    }


def test_repeated_id_replays_and_conflicting_args_fail(server):
    request = {"v": 1, "id": "it-idem", "op": "status", "args": {}}
    first = server.rpc(request)
    second = server.rpc(request)
    assert first == second

    conflict = server.rpc({"v": 1, "id": "it-idem", "op": "status", "args": {"x": 1}})
    assert conflict["ok"] is False
    assert conflict["e"] == "id_conflict"
