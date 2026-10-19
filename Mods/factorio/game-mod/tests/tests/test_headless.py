import json
import math
import os
import shutil
import socket
import subprocess
import time
from pathlib import Path

import pytest
from rcon import wait_for_rcon

GAME_MOD = Path(__file__).parents[2]
HEADLESS = GAME_MOD / "scripts" / "headless.sh"
# deterministic: --map-gen-seed 42 and on_init at tick 0 always produce this id
MAP_ID = "0-22719105"
SUMMARY_EVENT = {
    "seq": 1,
    "tick": 0,
    "kind": "snapshot_summary",
    "data": {"power": {"production": 0, "consumption": 0}, "science": 0, "evolution": 0, "pollution": 0},
}


def free_udp_port():
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    return port


class Headless:
    """The headless server under test: launch, restart from a save, stop."""

    def __init__(self, bin_path):
        self.bin_path = bin_path
        self.workdir = Path(__file__).parent / ".headless-run"
        self.info = {}
        self.rcon = None

    def launch_fresh(self):
        if self.workdir.exists():
            shutil.rmtree(self.workdir)
        proc = subprocess.run(
            ["bash", str(HEADLESS), "--bin", self.bin_path, str(self.workdir)],
            capture_output=True,
            text=True,
            timeout=300,
            check=True,
        )
        self.info = {}
        for line in proc.stdout.splitlines():
            key, _, value = line.partition("=")
            self.info[key] = value
        self.connect()

    def start_saved(self, save_path):
        tcp_port, udp_port = free_udp_port(), free_udp_port()
        self.info["port"] = str(tcp_port)
        self.proc = subprocess.Popen(
            [
                self.bin_path,
                "--config",
                str(self.workdir / "config.ini"),
                "--start-server",
                str(save_path),
                "--server-settings",
                str(self.workdir / "server-settings.json"),
                "--mod-directory",
                str(self.workdir / "mods"),
                "--bind",
                f"127.0.0.1:{udp_port}",
                "--rcon-bind",
                f"127.0.0.1:{tcp_port}",
                "--rcon-password",
                "pw-reload",
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            stdin=subprocess.DEVNULL,
        )
        self.info["pid"] = str(self.proc.pid)
        self.info["password"] = "pw-reload"
        self.connect()

    def connect(self):
        self.rcon = wait_for_rcon("127.0.0.1", int(self.info["port"]), self.info["password"])

    def stop(self):
        if self.rcon is not None:
            self.rcon.close()
            self.rcon = None
        pid = int(self.info["pid"])
        subprocess.run(["kill", str(pid)], check=False, capture_output=True)
        for _ in range(60):
            if subprocess.run(["kill", "-0", str(pid)], check=False, capture_output=True).returncode != 0:
                return
            time.sleep(0.25)
        subprocess.run(["kill", "-9", str(pid)], check=False)

    def rpc(self, **request):
        return self.rcon.rpc(request)

    def command(self, text):
        return self.rcon.command(text)

    def wait_head(self, map_id, want, deadline_s=30):
        deadline = time.monotonic() + deadline_s
        while time.monotonic() < deadline:
            body = self.rpc(v=1, id="drain", op="events_since", args={"seq": 0}, map_id=map_id)["r"]
            if body["head_seq"] == want:
                return body
            time.sleep(0.25)
        raise AssertionError(f"event head never reached {want}")


@pytest.fixture(scope="module")
def server(request):
    bin_path = os.environ.get("FACTORIO_BIN") or request.config.getoption("--factorio-bin")
    if not bin_path:
        pytest.skip("FACTORIO_BIN not set; headless integration skipped")
    headless = Headless(bin_path)
    headless.launch_fresh()
    yield headless
    headless.stop()


def test_status_events_since_say_round_trip(server):
    # the tick-0 snapshot summary is the deterministic first event of a fresh map
    assert server.wait_head(MAP_ID, 1) == {
        "map_id": MAP_ID,
        "head_seq": 1,
        "events": [SUMMARY_EVENT],
    }

    status = server.rpc(v=1, id="it-1", op="status", args={})
    assert status["v"] == 1
    assert status["ok"] is True
    body = status["r"]
    assert body["mod_version"] == "0.1.0"
    assert body["map_id"] == MAP_ID
    assert body["seq"] == 1
    assert isinstance(body["tick"], int)
    assert body.get("host") is None  # headless: no players (absent means null)

    said = server.rpc(v=1, id="it-3", op="say", args={"text": "hello"}, map_id=MAP_ID)
    assert said == {"v": 1, "id": "it-3", "ok": True, "r": {}}

    # say prints to chat but raises no event kind; the ring stays at head_seq 1
    events = server.rpc(v=1, id="it-4", op="events_since", args={"seq": 0}, map_id=MAP_ID)
    assert events == {
        "v": 1,
        "id": "it-4",
        "ok": True,
        "r": {"map_id": MAP_ID, "head_seq": 1, "events": [SUMMARY_EVENT]},
    }

    # a wrong map_id is refused on the real server too
    stale = server.rpc(v=1, id="it-5", op="say", args={"text": "hi"}, map_id="nope")
    assert stale == {
        "v": 1,
        "id": "it-5",
        "ok": False,
        "e": "stale_session",
        "m": "map_id does not match this map",
    }


def test_repeated_id_replays_and_conflicting_args_fail(server):
    request = {"v": 1, "id": "it-idem", "op": "status", "args": {}}
    first = server.rpc(**request)
    second = server.rpc(**request)
    assert first == second

    conflict = server.rpc(v=1, id="it-idem", op="status", args={"x": 1})
    assert conflict == {
        "v": 1,
        "id": "it-idem",
        "ok": False,
        "e": "id_conflict",
        "m": "id already used with different arguments",
    }


def test_find_and_inspect_round_trip_a_built_chest(server):
    out = server.command(
        "/silent-command local s = game.surfaces[1] "
        "local p = game.forces.player.get_spawn_position(s) "
        "local c = s.create_entity{name = 'wooden-chest', position = p, force = 'player'} "
        "c.insert{name = 'iron-plate', count = 5} "
        "rcon.print(helpers.table_to_json({unit_number = c.unit_number, x = c.position.x, y = c.position.y}))"
    )
    chest = json.loads(out)

    area = {
        "left_top": {"x": chest["x"] - 8, "y": chest["y"] - 8},
        "right_bottom": {"x": chest["x"] + 8, "y": chest["y"] + 8},
    }
    found = server.rpc(v=1, id="f1", op="find", args={"area": area, "name": "wooden-chest"}, map_id=MAP_ID)
    assert found["ok"] is True
    assert found["r"] == [
        {
            "unit_number": chest["unit_number"],
            "name": "wooden-chest",
            "type": "container",
            "position": {"x": chest["x"], "y": chest["y"]},
            "gps": f"[gps={math.floor(chest['x'])},{math.floor(chest['y'])}]",
            "owner": "player",
        }
    ]

    inspected = server.rpc(
        v=1, id="f2", op="inspect", args={"unit_number": chest["unit_number"]}, map_id=MAP_ID
    )
    assert inspected["ok"] is True
    assert inspected["r"]["inventories"] == {
        "chest": [{"name": "iron-plate", "count": 5, "quality": "normal"}]
    }
    assert "recipe" not in inspected["r"]  # a chest has no recipe (absent means null)


def test_save_reload_keeps_map_id_and_the_ring(server):
    server.wait_head(MAP_ID, 1)
    assert server.rpc(v=1, id="r-s1", op="say", args={"text": "persist one"}, map_id=MAP_ID)["ok"] is True
    assert server.rpc(v=1, id="r-s2", op="say", args={"text": "persist two"}, map_id=MAP_ID)["ok"] is True

    server.command("/save reload-test")
    save_path = server.workdir / "saves" / "reload-test.zip"
    deadline = time.monotonic() + 30
    while not save_path.exists():
        assert time.monotonic() < deadline, "the /save never produced the file"
        time.sleep(0.25)

    server.stop()
    server.start_saved(save_path)

    status = server.rpc(v=1, id="r-1", op="status", args={})
    assert status["r"]["map_id"] == MAP_ID
    assert status["r"]["seq"] == 1

    assert server.rpc(v=1, id="r-s3", op="say", args={"text": "after reload"}, map_id=MAP_ID)["ok"] is True

    # the third say raises no event: the ring after reload is exactly the saved one
    events = server.rpc(v=1, id="r-2", op="events_since", args={"seq": 0}, map_id=MAP_ID)
    assert events == {
        "v": 1,
        "id": "r-2",
        "ok": True,
        "r": {"map_id": MAP_ID, "head_seq": 1, "events": [SUMMARY_EVENT]},
    }
