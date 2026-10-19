import json
import os
import shutil
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


class Headless:
    """The headless server under test: launch, restart from a save, stop."""

    def __init__(self, bin_path):
        self.bin_path = bin_path
        self.workdir = Path(__file__).parent / ".headless-run"
        self.info = {}
        self.rcon = None

    def launch(self, *args):
        proc = subprocess.run(
            ["bash", str(HEADLESS), "--bin", self.bin_path, *args, str(self.workdir)],
            capture_output=True,
            text=True,
            timeout=300,
            check=True,
        )
        self.info = dict(line.split("=", 1) for line in proc.stdout.splitlines() if "=" in line)
        self.connect()

    def launch_fresh(self):
        if self.workdir.exists():
            shutil.rmtree(self.workdir)
        self.launch()
        # the first Lua command on a map only disables achievements and runs nothing
        self.command("/silent-command")

    def start_saved(self, save_path):
        self.launch("--save", str(save_path))

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

    def save(self, name, deadline_s=30):
        self.command(f"/save {name}")
        log = self.workdir / "logs" / "server.log"
        deadline = time.monotonic() + deadline_s
        while time.monotonic() < deadline:
            if (
                "Saving finished"
                in log.read_text().partition(f"Saving game as {self.workdir / 'saves' / name}")[2]
            ):
                return self.workdir / "saves" / f"{name}.zip"
            time.sleep(0.25)
        raise AssertionError(f"{name} was never saved")

    def research(self, name):
        self.command(f"/silent-command game.forces.player.technologies['{name}'].researched = true")

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


def research_event(name):
    return {"kind": "research_finished", "data": {"name": name}}


def without_ticks(events):
    return [{"kind": e["kind"], "data": e["data"]} for e in events]


def test_status_events_since_say_round_trip(server):
    # the tick-0 snapshot summary is the deterministic first event of a fresh map
    assert server.wait_head(MAP_ID, 1) == {"map_id": MAP_ID, "head_seq": 1, "events": [SUMMARY_EVENT]}

    status = server.rpc(v=1, id="it-1", op="status", args={})
    # tick follows the wall clock; a headless server has no host player, so host is absent
    assert status == {
        "v": 1,
        "id": "it-1",
        "ok": True,
        "r": {"mod_version": "0.1.0", "map_id": MAP_ID, "seq": 1, "tick": status["r"]["tick"]},
    }

    said = server.rpc(v=1, id="it-2", op="say", args={"text": "hello"}, map_id=MAP_ID)
    assert said == {"v": 1, "id": "it-2", "ok": True, "r": {}}

    # say raises no event kind, so the ring stays at head_seq 1
    events = server.rpc(v=1, id="it-3", op="events_since", args={"seq": 0}, map_id=MAP_ID)
    assert events == {
        "v": 1,
        "id": "it-3",
        "ok": True,
        "r": {"map_id": MAP_ID, "head_seq": 1, "events": [SUMMARY_EVENT]},
    }

    stale = server.rpc(v=1, id="it-4", op="say", args={"text": "hi"}, map_id="nope")
    assert stale == {
        "v": 1,
        "id": "it-4",
        "ok": False,
        "e": "stale_session",
        "m": "map_id does not match this map",
    }


def test_repeated_write_id_replays_and_conflicting_args_fail(server):
    request = {"v": 1, "id": "it-idem", "op": "say", "args": {"text": "once"}, "map_id": MAP_ID}
    assert server.rpc(**request) == server.rpc(**request) == {"v": 1, "id": "it-idem", "ok": True, "r": {}}

    conflict = server.rpc(**{**request, "args": {"text": "twice"}})
    assert conflict == {
        "v": 1,
        "id": "it-idem",
        "ok": False,
        "e": "id_conflict",
        "m": "id already used with different arguments",
    }


def test_find_then_inspect_a_chest_and_an_assembler(server):
    built = json.loads(
        server.command(
            "/silent-command local s = game.surfaces[1] "
            "local p = game.forces.player.get_spawn_position(s) "
            "local c = s.create_entity{name = 'wooden-chest', position = p, force = 'player'} "
            "c.insert{name = 'iron-plate', count = 5} "
            "local a = s.create_entity{name = 'assembling-machine-1', position = {p.x + 6, p.y}, force = 'player'} "
            "a.set_recipe('iron-gear-wheel') "
            "a.insert{name = 'iron-plate', count = 4} "
            "rcon.print(helpers.table_to_json({chest = c.unit_number, assembler = a.unit_number}))"
        )
    )
    area = {"left_top": {"x": -8, "y": -8}, "right_bottom": {"x": 8, "y": 8}}
    chest = {
        "unit_number": built["chest"],
        "name": "wooden-chest",
        "type": "container",
        "position": {"x": 0.5, "y": 0.5},
        "gps": "[gps=0,0]",
    }
    assembler = {
        "unit_number": built["assembler"],
        "name": "assembling-machine-1",
        "type": "assembling-machine",
        "position": {"x": 6.5, "y": 0.5},
        "gps": "[gps=6,0]",
    }

    found = server.rpc(v=1, id="f1", op="find", args={"area": area, "name": "wooden-chest"}, map_id=MAP_ID)
    assert found == {"v": 1, "id": "f1", "ok": True, "r": [{**chest, "owner": "player"}]}
    found = server.rpc(
        v=1, id="f2", op="find", args={"area": area, "type": "assembling-machine"}, map_id=MAP_ID
    )
    assert found == {"v": 1, "id": "f2", "ok": True, "r": [{**assembler, "owner": "player"}]}

    inspected = server.rpc(v=1, id="i1", op="inspect", args={"unit_number": built["chest"]}, map_id=MAP_ID)
    assert inspected["r"] == {
        **chest,
        "inventories": {"chest": [{"name": "iron-plate", "count": 5, "quality": "normal"}]},
        "fluids": {},
        "status": "normal",
    }
    inspected = server.rpc(
        v=1, id="i2", op="inspect", args={"unit_number": built["assembler"]}, map_id=MAP_ID
    )
    assert inspected["r"] == {
        **assembler,
        "inventories": {"crafter_input": [{"name": "iron-plate", "count": 4, "quality": "normal"}]},
        "fluids": {},
        "recipe": {"name": "iron-gear-wheel"},
        "status": "no_power",
    }


def test_a_save_reload_returns_the_head_seq_of_the_save(server):
    # say raises no event, so research completions move the ring around the save
    server.research("automation")
    server.research("logistics")
    saved = server.wait_head(MAP_ID, 3)
    assert without_ticks(saved["events"]) == [
        {"kind": "snapshot_summary", "data": SUMMARY_EVENT["data"]},
        research_event("automation"),
        research_event("logistics"),
    ]

    save_path = server.save("probe-reload")
    server.research("gun-turret")
    assert server.wait_head(MAP_ID, 4)["head_seq"] == 4

    server.stop()
    server.start_saved(save_path)

    reloaded = server.rpc(v=1, id="r-1", op="events_since", args={"seq": 0}, map_id=MAP_ID)
    assert reloaded == {"v": 1, "id": "r-1", "ok": True, "r": saved}
