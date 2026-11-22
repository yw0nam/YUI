#!/usr/bin/env bash
# SPIKE #1971 (never merged): one launch of a scenario on this worktree's verify bundle.
#   run.sh <scenario.mjs> <seed.json> <outdir> [mode]
# Records the WebKit pids alive before the launch, so the scenario can tell the app's own WebKit processes apart.
set -u
WT=$(cd "$(dirname "$0")/../.." && pwd)
: "${SPIKE_SCRATCH:?set SPIKE_SCRATCH}"
mkdir -p "$3"
pgrep -f 'com.apple.WebKit.(WebContent|GPU)' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.stringify(s.split("\n").filter(Boolean).map(Number))))' > "$3/pre.json"
TAURI_WEBDRIVER_PORT=4446 SPIKE_PRE="$3/pre.json" SPIKE_MODE="${4:-}" SPIKE_SCRATCH="$SPIKE_SCRATCH" \
  bash "$WT/.claude/skills/yui-runtime-evidence/scripts/scenario-run.sh" "$WT" "$1" "$2" "$3"
