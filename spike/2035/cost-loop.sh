#!/usr/bin/env bash
# SPIKE #2035: 7 interleaved launches per mode (base, stage), as #1991 measured; results in $1/<mode>-<i>/result.json.
set -u
D=$(cd "$(dirname "$0")" && pwd)
OUT=$1
for i in ${SPIKE_RUNS:-1 2 3 4 5 6 7}; do
  for mode in base stage; do
    bash "$D/run.sh" "$D/cost.mjs" "$SPIKE_SCRATCH/seed-$mode.json" "$OUT/$mode-$i" "$mode" > /dev/null 2> "$OUT/$mode-$i.err"
    echo "$mode-$i $(node -e 'const r=require(process.argv[1]); console.log(r.error ? "error" : "ok")' "$OUT/$mode-$i/result.json")"
  done
done
