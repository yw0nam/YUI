# SPIKE #1971 (never merged): one line per behaviour run.  python3 summarize-behaviour.py > results/behaviour-summary.json
import json
import os

D = os.path.join(os.path.dirname(os.path.abspath(__file__)), "results")
out = {}
for r in (1, 2, 3):
    s = json.load(open(f"{D}/behaviour-{r}/result.json"))["steps"]
    allp = s["B_interactive"] + s["B_input_reps"]
    stage_id = s["A_stage_window"]["id"]
    leave = sorted(i["leave_latency_ms"] for i in allp if i["leave_latency_ms"] is not None)
    out[f"run{r}"] = {
        "transparent_not_stage": f"{sum(t['window'] != stage_id for t in s['B_transparent'])}/10",
        "interactive_take_clicks": f"{sum(i['takes_click'] for i in allp)}/{len(allp)}",
        "misses": [i["name"] for i in allp if not i["takes_click"]],
        "enter_ms": sorted(i["enter_latency_ms"] for i in allp if i["enter_latency_ms"] is not None),
        "leave_ms": leave,
        "keys": {
            "abc": s["C3_after_abc"]["inputs"][0],
            "tab_to": s["C3_after_tab"]["active"],
            "xy": s["C3_after_xy"][1],
            "escape_closed_panel": not s["C3_after_escape"]["panel_open"],
        },
        "front_after_setFocus": s["C2_after_setFocus"]["front"]["name"],
        "front_after_close_unfocusable": s["C4_closed_unfocusable"]["front"]["name"],
        "front_after_deactivate": s["C5_after_deactivate"]["front"]["name"],
        "front_after_hide_app": s.get("C6_after_hide", {}).get("front", {}).get("name"),
        "stage_on_screen_after_hide_app": s.get("C6_after_hide", {}).get("stage_on_screen"),
        "front_after_unhide_quiet": s.get("C6_after_unhide", {}).get("front", {}).get("name"),
        "D_floating_other_active": s["D1_floating"]["zorder"],
        "D_blur_after_other_activates_ms": [b["after_ms"] for b in s["D1_floating"]["blur"]][:1],
        "D_normal_other_reactivated": s["D2_normal_level_other_reactivated"]["zorder"],
        "D_normal_yui_focused": s["D2_normal_level_yui_focused"]["zorder"],
        "D_normal_back_to_other": s["D2_normal_level_back_to_other"]["zorder"],
        "D_floating_again": s["D3_floating_again"]["zorder"],
        "stage_move_frame_ms_p95_max": [(round(m["rendered_interval_ms"]["p95"]), round(m["rendered_interval_ms"]["max"])) for m in s["E_stage_moves"]],
        "os_move_frame_ms_p95_max": [(round(m["rendered_interval_ms"]["p95"]), round(m["rendered_interval_ms"]["max"])) for m in s["E_os_moves"]],
        "stage_setViewWindow_call_ms_max": max(m["move_call_ms"]["max"] for m in s["E_stage_moves"]),
        "os_setPosition_call_ms_max": max(m["move_call_ms"]["max"] for m in s["E_os_moves"]),
    }
out["notes"] = [
    "run1 used the first scenario version: leave latency unmeasured (it waited for the cover, which an owner window covered)",
    "run2: the owner's own input reached YUI during B (a Control keydown in the keylog); its C/D readings are confounded",
]
print(json.dumps(out, indent=1))
