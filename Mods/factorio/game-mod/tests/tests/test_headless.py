import json
import math
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
MAP_ID = "42-0"
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
            ["bash", str(HEADLESS), "--bin", self.bin_path, "--probe", *args, str(self.workdir)],
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
    tick = status["r"].pop("tick")  # follows the wall clock
    assert isinstance(tick, int) and tick >= 0
    # a headless server has no host player and the dev host is unset, so host is absent
    assert status == {
        "v": 1,
        "id": "it-1",
        "ok": True,
        "r": {
            "mod_version": "0.1.5",
            "map_id": MAP_ID,
            "seq": 1,
            "body": {"alive": False},
            "stopped": False,
            "queue": {"length": 0},
            "idle": {"mode": "follow"},
        },
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


def test_snapshot_reports_power_in_watts_and_the_research_queue(server):
    server.command(
        "/silent-command local s = game.surfaces[1] "
        "local e = s.create_entity{name = 'electric-energy-interface', position = {20, 20}, force = 'player'} "
        "e.power_production = 1000 e.power_usage = 0 e.electric_buffer_size = 100000 "
        "s.create_entity{name = 'medium-electric-pole', position = {22, 20}, force = 'player'} "
        "s.create_entity{name = 'radar', position = {25, 20}, force = 'player'}"
    )
    time.sleep(2)
    server.command("/silent-command game.tick_paused = true")
    # the game's own per-tick joules for the network, read at the same paused tick
    flow = json.loads(
        server.command(
            "/silent-command local pole = game.surfaces[1].find_entities_filtered{name = 'medium-electric-pole'}[1] "
            "local st, p = pole.electric_network_statistics, defines.flow_precision_index.one_minute "
            "local out, inp = 0, 0 "
            "for n in pairs(st.output_counts) do "
            "out = out + st.get_flow_count{name = n, category = 'output', precision_index = p} end "
            "for n in pairs(st.input_counts) do "
            "inp = inp + st.get_flow_count{name = n, category = 'input', precision_index = p} end "
            "rcon.print(helpers.table_to_json({id = pole.electric_network_id, out = out, inp = inp}))"
        )
    )
    snapshot = server.rpc(
        v=1, id="sn", op="snapshot", args={"sections": ["power", "research"]}, map_id=MAP_ID
    )
    server.command("/silent-command game.tick_paused = false")

    assert flow["out"] > 0
    assert snapshot == {
        "v": 1,
        "id": "sn",
        "ok": True,
        "r": {
            "power": [
                {
                    "id": flow["id"],
                    "production": pytest.approx(flow["out"] * 60),
                    "consumption": pytest.approx(flow["inp"] * 60),
                }
            ],
            "research": {"queue": {}},
        },
    }


def test_recipe_lists_parts_and_machines(server):
    recipe = server.rpc(v=1, id="rc", op="recipe", args={"name": "iron-gear-wheel"}, map_id=MAP_ID)
    assert recipe == {
        "v": 1,
        "id": "rc",
        "ok": True,
        "r": {
            "name": "iron-gear-wheel",
            "category": "crafting",
            "energy": 0.5,
            "ingredients": [{"name": "iron-plate", "type": "item", "amount": 2}],
            "products": [{"name": "iron-gear-wheel", "type": "item", "amount": 1, "probability": 1}],
            "machines": [
                {"name": "assembling-machine-1", "crafting_speed": 0.5},
                {"name": "assembling-machine-2", "crafting_speed": 0.75},
                {"name": "assembling-machine-3", "crafting_speed": 1.25},
                {"name": "character", "crafting_speed": 1},
            ],
        },
    }


def test_ping_places_a_chart_tag(server):
    pinged = server.rpc(
        v=1, id="pg", op="ping", args={"pos": {"x": 10, "y": -5}, "text": "look here"}, map_id=MAP_ID
    )
    # chart tag numbers start at 0 on a fresh map
    assert pinged == {"v": 1, "id": "pg", "ok": True, "r": {"tag_id": 0}}

    tags = server.command(
        "/silent-command local out = {} "
        "for _, t in ipairs(game.forces.player.find_chart_tags(game.surfaces[1])) do "
        "out[#out + 1] = {tag_number = t.tag_number, text = t.text, x = t.position.x, y = t.position.y} end "
        "rcon.print(helpers.table_to_json(out))"
    )
    assert json.loads(tags) == [{"tag_number": 0, "text": "look here", "x": 10, "y": -5}]


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


BODY_ENABLED = "settings.global['coop-agent-body-enabled']"
CHARACTERS = "game.surfaces[1].find_entities_filtered{type = 'character'}"
# freeplay's starter items that land in the main inventory; the pistol and ammo take their own slots
KIT_MAIN = [
    {"name": "iron-plate", "count": 8},
    {"name": "burner-mining-drill", "count": 1},
    {"name": "stone-furnace", "count": 1},
    {"name": "wood", "count": 1},
]


def set_body_enabled(server, value):
    """Writes the setting from coop-agent's own Lua state (only the owning mod may) and returns the tick."""
    code = f"{BODY_ENABLED} = {{value = {str(value).lower()}}} rcon.print(game.tick)"
    return int(server.command(f"/silent-command __coop-agent__ {code}"))


def wait_status(server, done, deadline_s=60):
    deadline = time.monotonic() + deadline_s
    while time.monotonic() < deadline:
        status = server.rpc(v=1, id="poll", op="status", args={})["r"]
        if done(status):
            return status
        time.sleep(0.05)
    raise AssertionError("status never reached the wanted state")


def body_events(server, seq):
    """Events after seq without the 3600-tick snapshot_summary, which may land in any window."""
    events = server.rpc(v=1, id="ev", op="events_since", args={"seq": seq}, map_id=MAP_ID)["r"]["events"]
    return [e for e in events if e["kind"] != "snapshot_summary"]


def body_ready(server):
    """Sets the dev host at (0, 0) and enables the body; returns the enabling tick and the first live status."""
    assert json.loads(server.command("/coop-probe host 0 0")) == {"ok": True, "host": {"x": 0, "y": 0}}
    enabled_tick = set_body_enabled(server, True)
    return enabled_tick, wait_status(server, lambda s: s["body"]["alive"])


def labels(server):
    return json.loads(
        server.command(
            "/silent-command local out = {} "
            "for _, o in ipairs(rendering.get_all_objects('coop-agent')) do out[#out + 1] = o.text end "
            "rcon.print(helpers.table_to_json(out))"
        )
    )


def test_body_spawns_beside_the_dev_host_with_the_starter_kit(server):
    enabled_tick, status = body_ready(server)
    assert status["tick"] - enabled_tick <= 60
    position = status["body"].pop("position")
    assert math.dist((position["x"], position["y"]), (0, 0)) <= 3
    assert status["body"] == {"alive": True, "health": 250, "inventory": KIT_MAIN}
    assert status["host"] == {"name": "dev-host", "connected": True, "position": {"x": 0, "y": 0}}
    assert labels(server) == ["Buddy · Standing by"]


def test_stop_latches_and_emits_stopped(server):
    seq = body_ready(server)[1]["seq"]
    assert server.rpc(v=1, id="stop-1", op="stop", args={}, map_id=MAP_ID) == {
        "v": 1,
        "id": "stop-1",
        "ok": True,
        "r": {},
    }
    assert server.rpc(v=1, id="s1", op="status", args={})["r"]["stopped"] is True
    assert without_ticks(body_events(server, seq)) == [{"kind": "stopped", "data": {}}]
    assert labels(server) == ["Buddy · Stopped"]


def test_a_dead_body_leaves_its_items_and_respawns_empty_1800_ticks_later(server):
    seq = body_ready(server)[1]["seq"]
    server.command(f"/silent-command for _, c in pairs({CHARACTERS}) do c.die() end")
    corpse = json.loads(
        server.command(
            "/silent-command local c = game.surfaces[1].find_entities_filtered{type = 'character-corpse'}[1] "
            "rcon.print(helpers.table_to_json(c.get_inventory(defines.inventory.character_corpse).get_contents()))"
        )
    )
    assert sorted((item["name"], item["count"]) for item in corpse) == [
        ("burner-mining-drill", 1),
        ("firearm-magazine", 10),
        ("iron-plate", 8),
        ("pistol", 1),
        ("stone-furnace", 1),
        ("wood", 1),
    ]

    server.command("/silent-command game.speed = 10")
    try:
        status = wait_status(server, lambda s: s["body"]["alive"])
    finally:
        server.command("/silent-command game.speed = 1")
    died, respawned = body_events(server, seq)
    assert (died["kind"], died["data"], respawned["kind"], respawned["data"]) == (
        "body_died",
        {},
        "body_respawned",
        {},
    )
    assert 1800 <= respawned["tick"] - died["tick"] < 1860
    assert status["body"]["inventory"] == {}


def test_disabling_the_body_spills_its_items_removes_it_and_it_stays_gone(server):
    seq = body_ready(server)[1]["seq"]
    server.command(f"/silent-command {CHARACTERS}[1].insert{{name = 'coal', count = 5}}")
    disabled_tick = set_body_enabled(server, False)
    status = wait_status(server, lambda s: not s["body"]["alive"])
    assert status["tick"] - disabled_tick <= 60
    on_ground = json.loads(
        server.command(
            "/silent-command local out = {} "
            "for _, e in pairs(game.surfaces[1].find_entities_filtered{name = 'item-on-ground'}) do "
            "out[#out + 1] = {name = e.stack.name, count = e.stack.count, looted = e.to_be_looted} end "
            "rcon.print(helpers.table_to_json(out))"
        )
    )
    coal = [item for item in on_ground if item["name"] == "coal"]
    assert coal == [{"name": "coal", "count": 1, "looted": True}] * 5

    server.command("/silent-command game.speed = 10")
    try:
        status = wait_status(server, lambda s: s["tick"] >= disabled_tick + 1900)
    finally:
        server.command("/silent-command game.speed = 1")
    assert status["body"] == {"alive": False}
    assert int(server.command(f"/silent-command rcon.print(#{CHARACTERS})")) == 0
    assert body_events(server, seq) == []


# a cleared box north of the dev host: a furnace enclosure around (0, -100) whose one way in is a 2-tile
# gap at x = 30 in its south wall at y = -50, and a closed furnace ring around (-30, -20)
COURSE = (
    "/silent-command local s = game.surfaces[1] local box = {{-64, -154}, {64, 4}} "
    "s.request_to_generate_chunks({0, -100}, 4) s.force_generate_chunk_requests() "
    "for _, e in pairs(s.find_entities_filtered{area = box, type = {'tree', 'simple-entity'}}) do e.destroy() end "
    "local tiles = {} "
    "for _, t in pairs(s.find_tiles_filtered{area = box, collision_mask = 'water_tile'}) do "
    "tiles[#tiles + 1] = {name = 'grass-1', position = t.position} end "
    "s.set_tiles(tiles) "
    "local function furnace(x, y) s.create_entity{name = 'stone-furnace', position = {x, y}, force = 'player'} end "
    "for x = -60, 60, 2 do furnace(x, -150) if x ~= 30 then furnace(x, -50) end end "
    "for y = -148, -52, 2 do furnace(-60, y) furnace(60, y) end "
    "for i = -40, -20, 2 do furnace(i, -30) furnace(i, -10) end "
    "for j = -28, -12, 2 do furnace(-40, j) furnace(-20, j) end"
)
BODY_STATE = (
    "/silent-command __coop-agent__ local b = storage.body.entity rcon.print(helpers.table_to_json("
    "{tick = game.tick, walking = b.walking_state.walking, x = b.position.x, y = b.position.y}))"
)


def enqueue(server, id_, *jobs):
    return server.rpc(v=1, id=id_, op="jobs_enqueue", args={"jobs": list(jobs)}, map_id=MAP_ID)


def enqueued_id(server, id_, job):
    (job_id,) = enqueue(server, id_, job)["r"]["ids"]
    return job_id


def walk_to(x, y, radius):
    return {"kind": "walk_to", "args": {"pos": {"x": x, "y": y}, "radius": radius}}


def body_state(server):
    return json.loads(server.command(BODY_STATE))


def wait_for(read, done, what, deadline_s=120):
    deadline = time.monotonic() + deadline_s
    while time.monotonic() < deadline:
        value = read()
        if done(value):
            return value
        time.sleep(0.02)
    raise AssertionError(f"timed out waiting for {what}")


def wait_events(server, seq, count):
    return wait_for(
        lambda: body_events(server, seq), lambda e: len(e) >= count, f"{count} events after {seq}"
    )


def wait_walking(server):
    return wait_for(lambda: body_state(server), lambda s: s["walking"], "the body to walk", 30)


def jobs_by_id(server):
    return {job["id"]: job for job in server.rpc(v=1, id="jobs", op="jobs", args={}, map_id=MAP_ID)["r"]}


def test_walk_to_reaches_a_furnace_enclosure_through_its_one_gap(server):
    _, status = body_ready(server)
    server.command(COURSE)
    job_id = enqueued_id(server, "walk-1", walk_to(0, -100, 2))

    running = wait_status(server, lambda s: "running" in s["queue"])["queue"]
    assert (running["length"], running["running"]["id"], running["running"]["kind"]) == (1, job_id, "walk_to")
    assert 95 <= running["running"]["progress"]["distance"] <= 103
    assert labels(server) == ["Buddy · Walking to 0,-100"]

    server.command("/silent-command game.speed = 10")
    try:
        done, idle = wait_events(server, status["seq"], 2)
    finally:
        server.command("/silent-command game.speed = 1")
    assert without_ticks([done, idle]) == [
        {"kind": "job_done", "data": {"id": job_id, "kind": "walk_to"}},
        {"kind": "queue_idle", "data": {"last_job_id": job_id}},
    ]
    state = body_state(server)
    assert math.dist((state["x"], state["y"]), (0, -100)) <= 2
    assert state["walking"] is False
    # idle takes over 100 tiles from the host and waits inside the leash
    assert labels(server) == ["Buddy · Waiting for dev-host"]


def test_walk_to_into_a_closed_ring_fails_no_path_after_the_retries(server):
    _, status = body_ready(server)
    job_id = enqueued_id(server, "walk-2", walk_to(-30, -20, 1))
    (failed,) = wait_events(server, status["seq"], 1)
    assert without_ticks([failed]) == [
        {"kind": "job_failed", "data": {"id": job_id, "kind": "walk_to", "reason": "no_path"}}
    ]
    # five retries 30 ticks apart
    assert failed["tick"] >= jobs_by_id(server)[job_id]["started_tick"] + 5 * 30


def test_jobs_cancel_all_while_walking_halts_the_body_by_the_next_tick(server):
    _, status = body_ready(server)
    job_id = enqueued_id(server, "walk-3", walk_to(0, 0, 2))
    wait_walking(server)

    assert server.rpc(v=1, id="cancel-1", op="jobs_cancel", args={"all": True}, map_id=MAP_ID) == {
        "v": 1,
        "id": "cancel-1",
        "ok": True,
        "r": {},
    }
    halted = body_state(server)
    later = wait_for(lambda: body_state(server), lambda s: s["tick"] > halted["tick"], "the next tick", 10)
    assert (halted["walking"], later["walking"]) == (False, False)
    assert (later["x"], later["y"]) == (halted["x"], halted["y"])
    assert (jobs_by_id(server)[job_id]["state"], jobs_by_id(server)[job_id]["reason"]) == (
        "cancelled",
        "cancelled",
    )
    assert body_events(server, status["seq"]) == []


def test_stop_while_walking_fails_the_job_stopped(server):
    _, status = body_ready(server)
    job_id = enqueued_id(server, "walk-4", walk_to(0, 0, 2))
    wait_walking(server)

    assert server.rpc(v=1, id="stop-2", op="stop", args={}, map_id=MAP_ID)["ok"] is True
    assert without_ticks(wait_events(server, status["seq"], 2)) == [
        {"kind": "stopped", "data": {}},
        {"kind": "job_failed", "data": {"id": job_id, "kind": "walk_to", "reason": "stopped"}},
    ]
    assert body_state(server)["walking"] is False


def test_a_repeated_jobs_enqueue_replays_and_other_args_conflict(server):
    body_ready(server)
    request = {"kind": "wait", "args": {"ticks": 60}}
    before = len(jobs_by_id(server))
    first = enqueue(server, "wait-1", request)
    assert first["ok"] is True
    assert enqueue(server, "wait-1", request) == first
    assert len(jobs_by_id(server)) == before + 1

    assert enqueue(server, "wait-1", {"kind": "wait", "args": {"ticks": 61}}) == {
        "v": 1,
        "id": "wait-1",
        "ok": False,
        "e": "id_conflict",
        "m": "id already used with different arguments",
    }


# a cleared field around the dev host at (0, 200) for the mine scenes: nothing within 72 tiles but what a scene
# places, no water
FIELD = (
    "/silent-command local s = game.surfaces[1] local box = {{-72, 128}, {72, 272}} "
    "s.request_to_generate_chunks({0, 200}, 3) s.force_generate_chunk_requests() "
    "for _, e in pairs(s.find_entities_filtered{area = box}) do e.destroy() end "
    "local tiles = {} "
    "for _, t in pairs(s.find_tiles_filtered{area = box, collision_mask = 'water_tile'}) do "
    "tiles[#tiles + 1] = {name = 'grass-1', position = t.position} end "
    "s.set_tiles(tiles) "
)
COAL_PATCH = (
    "for x = -2, 2 do for y = 198, 202 do "
    "s.create_entity{name = 'coal', position = {x, y}, amount = 1000} end end"
)
BODY_ITEMS = "/silent-command __coop-agent__ rcon.print(storage.body.entity.get_item_count('{}'))"


def mine(name, count, **extra):
    return {"kind": "mine", "args": {"name": name, "count": count, **extra}}


def field(server, scene):
    """A fresh empty body beside the dev host at (0, 200) on the cleared field with the scene's entities."""
    set_body_enabled(server, False)
    wait_status(server, lambda s: not s["body"]["alive"])
    # an earlier spawn may or may not have handed out the starter kit; no body of a scene gets it
    server.command("/silent-command __coop-agent__ storage.body.kit_given = true")
    server.command(FIELD + scene)
    assert json.loads(server.command("/coop-probe host 0 200")) == {"ok": True, "host": {"x": 0, "y": 200}}
    set_body_enabled(server, True)
    return wait_status(server, lambda s: s["body"]["alive"])


def run_job(server, seq, id_, job, count=1):
    """Enqueues one job, runs the game at 10x until its events land, and returns them with the job record."""
    job_id = enqueued_id(server, id_, job)
    server.command("/silent-command game.speed = 10")
    try:
        ends = wait_events(server, seq, count)
    finally:
        server.command("/silent-command game.speed = 1")
    return ends, jobs_by_id(server)[job_id]


def test_mine_50_coal_natively_in_50_mining_times(server):
    status = field(server, COAL_PATCH)
    (done, idle), record = run_job(server, status["seq"], "mine-coal", mine("coal", 50), 2)
    assert without_ticks([done, idle]) == [
        {"kind": "job_done", "data": {"id": record["id"], "kind": "mine"}},
        {"kind": "queue_idle", "data": {"last_job_id": record["id"]}},
    ]
    assert record["progress"] == {"gained": 50, "count": 50, "path": "native"}
    # the body spawns on the patch, so no walking: 50 x 121 ticks, within 10 %
    assert 5445 <= done["tick"] - record["started_tick"] <= 6655
    assert int(server.command(BODY_ITEMS.format("coal"))) == 50
    assert labels(server) == ["Buddy · Holding: coal 50"]


@pytest.mark.parametrize(
    ("scene", "name", "count", "held"),
    [
        (
            "for _, y in ipairs({197, 200, 203}) do s.create_entity{name = 'tree-01', position = {6, y}} end",
            "wood",
            10,
            (12, 12),
        ),
        # a huge rock yields 24 to 50 stone
        ("s.create_entity{name = 'huge-rock', position = {0, 206}}", "stone", 5, (24, 50)),
    ],
)
def test_mine_wood_from_trees_and_stone_from_a_rock(server, scene, name, count, held):
    status = field(server, scene)
    (done, _idle), record = run_job(server, status["seq"], f"mine-{name}", mine(name, count), 2)
    assert done["kind"] == "job_done"
    items = int(server.command(BODY_ITEMS.format(name)))
    assert held[0] <= items <= held[1]
    assert record["progress"] == {"gained": items, "count": count, "path": "native"}


def test_a_host_furnace_is_mined_only_once_marked_for_deconstruction(server):
    status = field(
        server,
        "for _, x in ipairs({3, 6}) do "
        "s.create_entity{name = 'stone-furnace', position = {x, 200}, force = 'player'} end",
    )
    area = {"left_top": {"x": -8, "y": 192}, "right_bottom": {"x": 8, "y": 208}}

    def furnaces():
        found = server.rpc(
            v=1, id="ff", op="find", args={"area": area, "name": "stone-furnace"}, map_id=MAP_ID
        )
        return {entry["position"]["x"]: entry["unit_number"] for entry in found["r"]}

    near = furnaces()[3]
    (gone,), _ = run_job(server, status["seq"], "mine-f1", mine("stone-furnace", 1))
    (refused,), _ = run_job(server, gone["seq"], "mine-f2", mine("stone-furnace", 1, entity=near))
    assert [(e["kind"], e["data"]["reason"]) for e in (gone, refused)] == [
        ("job_failed", "target_gone"),
        ("job_failed", "not_permitted"),
    ]
    assert int(server.command(BODY_ITEMS.format("stone-furnace"))) == 0

    # the nearer furnace stays unmarked, the farther one is marked
    marked = server.command(
        "/silent-command rcon.print(game.surfaces[1].find_entity('stone-furnace', {6, 200})"
        ".order_deconstruction('player'))"
    )
    assert json.loads(marked) is True
    (done, _idle), _ = run_job(server, refused["seq"], "mine-f3", mine("stone-furnace", 1), 2)
    assert done["kind"] == "job_done"
    assert int(server.command(BODY_ITEMS.format("stone-furnace"))) == 1
    assert furnaces() == {3: near}


def test_mine_with_a_full_inventory_fails_target_full(server):
    status = field(server, COAL_PATCH)
    server.command(
        "/silent-command __coop-agent__ storage.body.entity.insert{name = 'iron-chest', count = 10000}"
    )
    (failed,), record = run_job(server, status["seq"], "mine-full", mine("coal", 1))
    assert without_ticks([failed]) == [
        {"kind": "job_failed", "data": {"id": record["id"], "kind": "mine", "reason": "target_full"}}
    ]
    assert record["progress"] == {"gained": 0, "count": 1, "path": "native"}


GROUND_COAL = (
    "/silent-command local out = {} "
    "for _, e in pairs(game.surfaces[1].find_entities_filtered{name = 'item-on-ground'}) do "
    "if e.stack.name == 'coal' then "
    "out[#out + 1] = {count = e.stack.count, looted = e.to_be_looted, x = e.position.x, y = e.position.y} end end "
    "rcon.print(helpers.table_to_json(out))"
)


def clear_ground(server):
    server.command(
        "/silent-command for _, e in pairs(game.surfaces[1].find_entities_filtered"
        "{name = 'item-on-ground'}) do e.destroy() end"
    )


def ground_coal(server):
    return json.loads(server.command(GROUND_COAL))


def body_coal(server):
    return int(
        server.command(
            "/silent-command __coop-agent__ rcon.print(storage.body.entity.get_item_count('coal'))"
        )
    )


def host_coal(server):
    """The dev host is a probe fake with no inventory; a real host's coal would be counted here."""
    return 0


def deliver(item, count):
    return {"kind": "deliver", "args": {"item": item, "count": count}}


def test_mine_then_deliver_spills_at_the_host_and_the_body_does_not_re_pick(server):
    status = field(server, COAL_PATCH)
    (done, idle), _ = run_job(server, status["seq"], "deliver-mine", mine("coal", 20), 2)
    assert done["kind"] == "job_done"

    # the body teleports 1 tile beside the dev host: the re-pick case that measured 5 of 20 taken back
    server.command("/silent-command __coop-agent__ storage.body.entity.teleport({x = 0, y = 199})")
    clear_ground(server)
    assert (body_coal(server), host_coal(server), len(ground_coal(server))) == (20, 0, 0)
    (done, idle), record = run_job(server, idle["seq"], "deliver-job", deliver("coal", 20), 2)
    assert without_ticks([done, idle]) == [
        {"kind": "job_done", "data": {"id": record["id"], "kind": "deliver"}},
        {"kind": "queue_idle", "data": {"last_job_id": record["id"]}},
    ]

    wait_status(server, lambda s: s["tick"] >= done["tick"] + 60)
    ground = ground_coal(server)
    assert body_coal(server) == 0
    assert len(ground) == 20
    assert all(item["looted"] for item in ground)
    assert all(math.dist((item["x"], item["y"]), (0, 200)) <= 3 for item in ground)
    assert body_coal(server) + sum(item["count"] for item in ground) + host_coal(server) == 20
    assert host_coal(server) == 0


def test_deliver_with_fewer_coal_than_asked_fails_no_item_and_keeps_the_body_s_coal(server):
    status = field(server, "")
    server.command("/silent-command __coop-agent__ storage.body.entity.insert{name = 'coal', count = 3}")
    (failed,), record = run_job(server, status["seq"], "deliver-noitem", deliver("coal", 5), 1)
    assert without_ticks([failed]) == [
        {
            "kind": "job_failed",
            "data": {
                "id": record["id"],
                "kind": "deliver",
                "reason": "no_item",
                "item": "coal",
                "count": 5,
                "held": 3,
            },
        }
    ]
    assert body_coal(server) == 3
def idle_set(server, id_, args):
    return server.rpc(v=1, id=id_, op="idle_set", args=args, map_id=MAP_ID)


def bring_body_home(server):
    """Parks the body within 3 tiles of the origin; a follow beyond the leash waits, a walk_to does not."""
    enqueue(server, f"home-{time.monotonic_ns()}", walk_to(0, 0, 3))
    server.command("/silent-command game.speed = 10")
    try:
        wait_status(
            server,
            lambda s: (
                s["queue"]["length"] == 0
                and math.dist((s["body"]["position"]["x"], s["body"]["position"]["y"]), (0, 0)) <= 3
            ),
            deadline_s=120,
        )
    finally:
        server.command("/silent-command game.speed = 1")


def wait_position(server, done, what, deadline_s=120):
    return wait_for(
        lambda: server.rpc(v=1, id="pos", op="status", args={})["r"],
        lambda status: done(status["body"]["position"]),
        what,
        deadline_s,
    )


def test_idle_follow_brings_the_body_within_15_tiles_of_a_moved_host(server):
    body_ready(server)
    bring_body_home(server)
    assert idle_set(server, "idle-1", {"mode": "follow"}) == {"v": 1, "id": "idle-1", "ok": True, "r": {}}
    before = server.rpc(v=1, id="idle-s0", op="status", args={})["r"]["tick"]
    assert json.loads(server.command("/coop-probe host 40 0")) == {"ok": True, "host": {"x": 40, "y": 0}}
    server.command("/silent-command game.speed = 10")
    try:
        status = wait_position(
            server, lambda p: math.dist((p["x"], p["y"]), (40, 0)) <= 15, "the body within 15 of 40,0"
        )
    finally:
        server.command("/silent-command game.speed = 1")
    assert status["tick"] - before <= 600
    assert status["idle"] == {"mode": "follow"}


def test_beyond_the_leash_the_body_stops_and_asks_for_the_host(server):
    body_ready(server)
    idle_set(server, "idle-2", {"mode": "follow"})
    bring_body_home(server)
    wait_position(
        server, lambda p: math.dist((p["x"], p["y"]), (0, 0)) <= 15, "the body back within 15 of the origin"
    )
    assert json.loads(server.command("/coop-probe host 80 0")) == {"ok": True, "host": {"x": 80, "y": 0}}
    server.command("/silent-command game.speed = 10")
    try:
        wait_for(
            lambda: labels(server),
            lambda texts: texts == ["Buddy · Waiting for dev-host"],
            "the waiting label",
        )
        before = server.rpc(v=1, id="leash-p1", op="status", args={})["r"]
        after = wait_for(
            lambda: server.rpc(v=1, id="leash-p2", op="status", args={})["r"],
            lambda status: status["tick"] >= before["tick"] + 120,
            "120 ticks",
        )
    finally:
        server.command("/silent-command game.speed = 1")
    assert after["body"]["position"] == before["body"]["position"]
    assert after["idle"] == {"mode": "follow"}
    assert labels(server) == ["Buddy · Waiting for dev-host"]


def test_idle_set_stay_walks_once_and_ignores_the_host(server):
    _, status = body_ready(server)
    seq = status["seq"]
    assert idle_set(server, "stay-1", {"mode": "stay", "pos": {"x": -10, "y": 0}}) == {
        "v": 1,
        "id": "stay-1",
        "ok": True,
        "r": {},
    }
    server.command("/silent-command game.speed = 10")
    try:
        (changed,) = wait_events(server, seq, 1)
        wait_for(
            lambda: body_state(server),
            lambda state: not state["walking"] and math.dist((state["x"], state["y"]), (-10, 0)) <= 2,
            "the body standing at -10,0",
        )
    finally:
        server.command("/silent-command game.speed = 1")
    assert without_ticks([changed]) == [{"kind": "idle_changed", "data": {"mode": "stay"}}]
    assert server.rpc(v=1, id="stay-s", op="status", args={})["r"]["idle"] == {"mode": "stay"}

    assert json.loads(server.command("/coop-probe host 40 40")) == {"ok": True, "host": {"x": 40, "y": 40}}
    before = server.rpc(v=1, id="stay-p1", op="status", args={})["r"]
    server.command("/silent-command game.speed = 10")
    try:
        after = wait_for(
            lambda: server.rpc(v=1, id="stay-p2", op="status", args={})["r"],
            lambda status: status["tick"] >= before["tick"] + 120,
            "120 ticks",
        )
    finally:
        server.command("/silent-command game.speed = 1")
    assert after["body"]["position"] == before["body"]["position"]


def test_stop_latches_until_an_idle_set_follow_clears_it(server):
    body_ready(server)
    assert server.rpc(v=1, id="stop-idle", op="stop", args={}, map_id=MAP_ID) == {
        "v": 1,
        "id": "stop-idle",
        "ok": True,
        "r": {},
    }
    assert server.rpc(v=1, id="idle-s2", op="status", args={})["r"]["stopped"] is True
    assert idle_set(server, "idle-4", {"mode": "follow"}) == {"v": 1, "id": "idle-4", "ok": True, "r": {}}
    assert server.rpc(v=1, id="idle-s3", op="status", args={})["r"]["stopped"] is False
