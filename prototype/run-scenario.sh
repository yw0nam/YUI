#!/usr/bin/env bash
# One measurement scenario against the verify bundle (issue #1648 prototype, throwaway).
#   run-scenario.sh <name> <responses|push> <snapshot|slow> <marker> <poll_seconds>
# Mocks must already be running (mock 18434, recorder 18440, gateway 18450/18451).
# Leaves: /tmp/proto-mcp/run-<name>.json (wdio result), run-<name>.stderr (app+server stderr).
set -uo pipefail
WT=/Users/nam-young-woo/Desktop/codes/waifu/2026/YUI-proto-host
S=/Users/nam-young-woo/Desktop/codes/waifu/2026/YUI/.claude/skills/yui-runtime-evidence/scripts
OUT=/tmp/proto-mcp
NAME=$1; TRANSPORT=$2; TOOL=$3; MARKER=$4; POLL=${5:-90}

# ── seed ──
if [ "$TRANSPORT" = responses ]; then
  BASE="http://127.0.0.1:18440/v1"
else
  BASE="http://127.0.0.1:18450"
fi
cat > "$OUT/seed-$NAME.json" <<EOF
{
  "yui.endpoints": { "chat_base_url": "$BASE", "chat_api": "$TRANSPORT", "chat_model": "qwen3:8b" },
  "yui.chat-key": { "apiKey": "mock-key" },
  "yui.agentNotify": { "enabled": true, "port": 18770 },
  "yui.presence": { "value": 86400000 },
  "yui.proactive-pacer-gap": { "value": 0 },
  "yui.schedule": { "enabled": false, "entries": [] },
  "yui.filler": { "enabled": false, "language": "en", "customPools": {} },
  "yui.bed-scene": { "enabled": false, "wakeTimeoutS": 10 }
}
EOF

# ── queue the scripted reply: the tool call first, then the marker text ──
# The bridge tool names what the client declares; express:null keeps the mock's default
# generate_express out of the measurement.
BRIDGE=$TOOL
[ "$TOOL" = snapshot ] && BRIDGE=proto_snapshot
[ "$TOOL" = slow ] && BRIDGE=proto_slow
if [ "$TRANSPORT" = responses ]; then
  curl -s -X POST http://127.0.0.1:18434/__reset > /dev/null
  : > "$OUT/responses-requests.jsonl"
  curl -s -X POST http://127.0.0.1:18434/__next -d "{\"tool_calls\":[{\"name\":\"$BRIDGE\",\"arguments\":{}}],\"text\":\"\",\"express\":null}" > /dev/null
  curl -s -X POST http://127.0.0.1:18434/__next -d "{\"text\":\"측정 완료 $MARKER\",\"express\":null}" > /dev/null
else
  curl -s -X POST http://127.0.0.1:18451/__reset > /dev/null
fi

# ── run the bundle; the eval polls the bubble for the marker, keeping the session alive ──
# YUI_PROTO_SLOW_SECS reaches the app and thus the spawned MCP server (a slow run sets it to 40
# so the client's 32 s tool wait passes first and aborts the call).
EVAL="(async()=>{ for (let i=0;i<$POLL;i++){ await new Promise(r=>setTimeout(r,1000)); const el=document.querySelector('.yui-bubble__text')??document.querySelector('.yui-bubble'); const t=el?.textContent??''; if (t.includes('측정 완료')) return 'done@'+i+'s: '+t.slice(0,100); } return 'timeout: no marker'; })()"
echo "[$NAME] launching bundle ($TRANSPORT, $TOOL)"
YUI_INGRESS_PORT=18770 YUI_PROTO_SLOW_SECS="${SLOW_SECS:-20}" node $S/wdio-run.mjs --wt "$WT" --seed "$OUT/seed-$NAME.json" --eval "$EVAL" \
  > "$OUT/run-$NAME.json" 2> "$OUT/run-$NAME.stderr" &
WDIO_PID=$!

# ── wait for the seeded boot's ingress, then trigger the turn from the shell ──
READY=0
for i in $(seq 1 90); do
  if curl -s -m 1 http://127.0.0.1:18770/avatar/state | grep -q posture; then READY=1; break; fi
  if ! kill -0 $WDIO_PID 2>/dev/null; then break; fi
  sleep 1
done
echo "[$NAME] ingress ready=$READY after ${i}s"
if [ $READY = 1 ]; then
  NOW=$(python3 -c 'import time; print(int(time.time()*1000))')
  curl -s -X POST http://127.0.0.1:18770/signals -H 'content-type: application/json' -d "{
    \"signals\": [{\"kind\": \"workflow\", \"status\": \"complete\"}],
    \"envelope\": {\"source\": \"proto-mcp\", \"event_type\": \"proto_$TOOL\", \"delivery\": \"urgent\", \"event_id\": \"$NAME\", \"occurred_at\": $NOW}
  }"
  echo " [$NAME] trigger posted"
  if [ "$TRANSPORT" = push ]; then
    # Wait for the client's turn frame, then send the tool call under that turn id.
    TURN_ID=""
    for i in $(seq 1 30); do
      TURN_ID=$(curl -s http://127.0.0.1:18451/__frames | python3 -c '
import json,sys
frames = json.load(sys.stdin)
turns = [f["frame"]["turn_id"] for f in frames if f["type"] == "turn"]
print(turns[-1] if turns else "")' 2>/dev/null)
      [ -n "$TURN_ID" ] && break
      kill -0 $WDIO_PID 2>/dev/null || break
      sleep 1
    done
    echo "[$NAME] push turn_id=$TURN_ID"
    if [ -n "$TURN_ID" ]; then
      curl -s -X POST http://127.0.0.1:18451/__toolcall -d "{\"name\":\"$BRIDGE\",\"arguments\":{},\"turn_id\":\"$TURN_ID\"}" > /dev/null
      echo "[$NAME] tool_call sent"
      # The render closes the turn; send it only once the tool_result came back.
      for i in $(seq 1 60); do
        GOT=$(curl -s http://127.0.0.1:18451/__frames | python3 -c '
import json,sys
frames = json.load(sys.stdin)
results = [f for f in frames if f["type"] == "tool_result"]
print("yes" if results else "")' 2>/dev/null)
        [ -n "$GOT" ] && break
        sleep 1
      done
      echo "[$NAME] tool_result seen=$GOT"
      sleep 1
      curl -s -X POST http://127.0.0.1:18451/__render -d "{\"turn_id\":\"$TURN_ID\",\"speech\":\"측정 완료 $MARKER\"}" > /dev/null
    fi
  fi
fi
wait $WDIO_PID
echo "[$NAME] wdio exit=$?"
cat "$OUT/run-$NAME.json"
