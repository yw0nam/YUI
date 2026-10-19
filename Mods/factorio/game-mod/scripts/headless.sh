#!/usr/bin/env bash
# Create a fresh Factorio save with only the coop-agent mod and start a headless
# server with RCON bound to 127.0.0.1. Prints key=value lines; the caller kills
# the printed pid. The game's config lives inside <workdir>, so the owner's real
# game data is never touched.
#
# Usage: headless.sh [--bin PATH] [--probe] [--port PORT] <workdir>
set -euo pipefail

BIN="${FACTORIO_BIN:-}"
PROBE=0
PORT=""
WORKDIR=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --bin) BIN="$2"; shift 2 ;;
    --probe) PROBE=1; shift ;;
    --port) PORT="$2"; shift 2 ;;
    -*) echo "unknown option: $1" >&2; exit 2 ;;
    *) WORKDIR="$1"; shift ;;
  esac
done
[[ -n "$BIN" ]] || { echo "no Factorio binary: pass --bin or set FACTORIO_BIN" >&2; exit 2; }
[[ -n "$WORKDIR" ]] || { echo "usage: headless.sh [--bin PATH] [--probe] [--port PORT] <workdir>" >&2; exit 2; }

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$WORKDIR/saves" "$WORKDIR/mods" "$WORKDIR/logs"
WORKDIR="$(cd "$WORKDIR" && pwd)"
ln -sfn "$HERE/coop-agent" "$WORKDIR/mods/coop-agent"
# the symlink name must match the mod's info.json name
if [[ "$PROBE" == "1" ]]; then
  ln -sfn "$HERE/probe-mod" "$WORKDIR/mods/coop-probe"
fi

# --config needs an existing file; redirect write-data into the workdir so the
# owner's real game data is never touched. auto_pause=false keeps the sim
# running with no players connected, which the multi-tick probes need.
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

SAVE="$WORKDIR/saves/probe.zip"
PORT="${PORT:-$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')}"
PASSWORD="pw$RANDOM$RANDOM"

"$BIN" --config "$CONFIG" --create "$SAVE" --mod-directory "$WORKDIR/mods" \
  --map-gen-seed 42 >"$WORKDIR/logs/create.log" 2>&1

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
