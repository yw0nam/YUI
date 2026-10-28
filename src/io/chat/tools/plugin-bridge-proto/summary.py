"""PROTOTYPE #1661: one row per (label, prompt) from analyze.py's JSON lines on stdin."""
import json, sys, statistics as st
from collections import defaultdict
g = defaultdict(list)
for l in sys.stdin:
    r = json.loads(l); g[(r["label"], r["p"])].append(r)
print("label | prompt | n | describe-first | plugin_call valid 1st try | invalid calls | answered | LLM calls (median, range) | hermes bridge calls | image named")
for (lab, p), rs in g.items():
    rs = rs[-5:]
    n = len(rs)
    used = [r for r in rs if r["calls"]]
    df = sum(1 for r in used if r["describe_first"])
    first_ok = sum(1 for r in used if r["invalid"] == 0)
    inv = sum(r["invalid"] for r in rs)
    llm = [r["llm_calls"] for r in rs]
    hb = sum(sum(1 for s in r["hermes_seq"] if s in ("tool_search", "tool_describe")) for r in rs)
    img = sum(1 for r in rs if r["image_named"]) if p == "b" else "-"
    nocall = sum(1 for r in rs if not r["calls"])
    ans = n - sum(1 for r in rs if r["reply"].startswith("I couldn't"))
    print(f"{lab} | {p} | {n} | {df}/{len(used)} | {first_ok}/{len(used)} | {inv} | {ans}/{n} | {st.median(llm)} ({min(llm)}-{max(llm)}) | {hb} | {img} | no-plugin-call {nocall}/{n}")
