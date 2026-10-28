"""PROTOTYPE #1661: joins the driver's frame log with the Hermes session in state.db per trial."""
import json, sqlite3, sys, os, re
from collections import defaultdict

DB = os.path.expanduser("~/.hermes/profiles/protobridge/state.db")
db = sqlite3.connect(DB)
routing = {}
for key, sid in []:
    routing.setdefault(key, sid)
sess = json.load(open(os.path.expanduser("~/.hermes/profiles/protobridge/sessions/sessions.json")))
for k, v in sess.items():
    if isinstance(v, dict) and "session_id" in v:
        routing[k] = v["session_id"]


def session_calls(chat_id):
    sid = routing.get(f"agent:main:yui:dm:{chat_id}")
    if not sid:
        return None, []
    rows = db.execute(
        "select role, tool_calls, tool_name, content from messages where session_id=? order by id", (sid,)
    ).fetchall()
    llm_calls, seq = 0, []
    for role, tc, tname, content in rows:
        if role == "assistant":
            llm_calls += 1
            for c in json.loads(tc or "[]"):
                fn = c["function"]
                name = fn["name"]
                try:
                    a = json.loads(fn["arguments"])
                except Exception:
                    a = fn["arguments"]
                if name == "tool_call":
                    for inner in a.get("calls", []):
                        seq.append(f"tool_call→{inner.get('name')}")
                else:
                    seq.append(name)
    return llm_calls, seq


rows = [json.loads(l) for l in open(sys.argv[1])]
labels = sys.argv[2:] or sorted({r["label"] for r in rows})
COLOR = re.compile(r"orange|green|black|circle|disc|dot", re.I)
for r in rows:
    if r["label"] not in labels:
        continue
    fr = r["frames"]
    calls = [f for f in fr if f["type"] == "tool_call"]
    results = {f["id"]: f for f in fr if f["type"] == "tool_result"}
    plugin = [(c["name"], c["arguments"], results.get(c["id"], {}).get("result", "")) for c in calls if c["name"].startswith("plugin_")]
    order = [c[0] + (f"({c[1].get('name')})") for c in plugin]
    pcalls = [c for c in plugin if c[0] == "plugin_call"]
    invalid = sum(1 for c in pcalls if c[2].startswith("error"))
    str_args = sum(1 for c in pcalls if isinstance(c[1].get("arguments"), str))
    first_call = next((i for i, c in enumerate(plugin) if c[0] == "plugin_call"), None)
    desc_first = None if first_call is None else any(c[0] == "plugin_describe" for c in plugin[:first_call])
    speech = " ".join(f["speech"] for f in fr if f["type"] in ("speech", "render"))
    speech = re.sub(r"I'm Yui.*$", "", speech)  # Hermes first-contact onboarding tail
    llm, seq = session_calls(r.get("chat_id"))
    print(json.dumps({
        "label": r["label"], "p": r["prompt"], "t": r["trial"], "ok": r["finished"],
        "plugin_order": order, "describe_first": desc_first,
        "calls": len(pcalls), "invalid": invalid, "string_args": str_args,
        "args": [c[1] for c in pcalls],
        "llm_calls": llm, "hermes_seq": seq,
        "image_named": bool(COLOR.search(speech)) if r["prompt"] == "b" else None,
        "reply": speech[:300],
    }, ensure_ascii=False))
