#!/usr/bin/env bash
# Starts a headless server with RCON on 127.0.0.1 from a fresh save in <workdir> or from --save, and prints key=value lines.
set -euo pipefail

BIN="${FACTORIO_BIN:-}"
PROBE=0
PORT=""
SAVE=""
WORKDIR=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --bin) BIN="$2"; shift 2 ;;
    --probe) PROBE=1; shift ;;
    --port) PORT="$2"; shift 2 ;;
    --save) SAVE="$2"; shift 2 ;;
    -*) echo "unknown option: $1" >&2; exit 2 ;;
    *) WORKDIR="$1"; shift ;;
  esac
done
[[ -n "$BIN" ]] || { echo "no Factorio binary: pass --bin or set FACTORIO_BIN" >&2; exit 2; }
[[ -n "$WORKDIR" ]] || { echo "usage: headless.sh [--bin PATH] [--probe] [--port PORT] [--save PATH] <workdir>" >&2; exit 2; }

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$WORKDIR/saves" "$WORKDIR/mods" "$WORKDIR/logs"
WORKDIR="$(cd "$WORKDIR" && pwd)"
ln -sfn "$HERE/coop-agent" "$WORKDIR/mods/coop-agent"
# a mod folder's name must match its info.json name
if [[ "$PROBE" == "1" ]]; then
  ln -sfn "$HERE/probe-mod" "$WORKDIR/mods/coop-probe"
fi

# write-data inside the workdir keeps the owner's real game data untouched
CONFIG="$WORKDIR/config.ini"
[[ -f "$CONFIG" ]] || printf '[path]\nwrite-data=%s\n' "$WORKDIR" > "$CONFIG"
SETTINGS="$WORKDIR/server-settings.json"
if [[ ! -f "$SETTINGS" ]]; then
  cp "$(dirname "$BIN")/../data/server-settings.example.json" "$SETTINGS"
  # auto_pause=false keeps the sim running with no players connected
  python3 -I - "$SETTINGS" <<'PY'
import json, sys
path = sys.argv[1]
data = json.load(open(path))
data["auto_pause"] = False
data["visibility"] = {"public": False, "lan": True, "steam": False}
with open(path, "w") as handle:
    json.dump(data, handle)
PY
fi

PORT="${PORT:-$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')}"
PASSWORD="pw$RANDOM$RANDOM"

if [[ -z "$SAVE" ]]; then
  SAVE="$WORKDIR/saves/probe.zip"
  "$BIN" --config "$CONFIG" --create "$SAVE" --mod-directory "$WORKDIR/mods" \
    --map-gen-seed 42 >"$WORKDIR/logs/create.log" 2>&1
fi

GAME_PORT="$(python3 -c 'import socket; s=socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')"
"$BIN" --config "$CONFIG" --start-server "$SAVE" --server-settings "$SETTINGS" --mod-directory "$WORKDIR/mods" \
  --bind "127.0.0.1:$GAME_PORT" --rcon-bind "127.0.0.1:$PORT" --rcon-password "$PASSWORD" \
  </dev/null >"$WORKDIR/logs/server.log" 2>&1 &
SERVER_PID=$!

echo "save=$SAVE"
echo "port=$PORT"
echo "password=$PASSWORD"
echo "pid=$SERVER_PID"

for _ in $(seq 1 240); do
  if python3 - "$PORT" <<'PY'
import socket, sys
s = socket.socket()
s.settimeout(0.5)
try:
    s.connect(("127.0.0.1", int(sys.argv[1])))
except OSError:
    sys.exit(1)
s.close()
PY
  then
    echo "ready"
    exit 0
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "server exited early; log tail:" >&2
    tail -20 "$WORKDIR/logs/server.log" >&2
    exit 1
  fi
  sleep 0.25
done
echo "server did not open the RCON port in time" >&2
exit 1
