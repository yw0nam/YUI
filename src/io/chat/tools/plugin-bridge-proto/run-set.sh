#!/bin/bash
# usage: run-set.sh <label> <wording>
cd "$(dirname "$0")"
for p in ${PROMPTS:-a b c}; do
  node drive.mjs --label "$1" --wording "$2" --prompt $p --n 5 --port 18661 --key protobridge-key --error ${ERR:-schema} --out results.jsonl
done
