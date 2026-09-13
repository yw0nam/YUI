#!/usr/bin/env bash
# Posts a daily briefing fixture to the YUI signals ingress and prints the HTTP status.
set -euo pipefail

fixture="${1:-$(dirname "$0")/../assets/fixtures/daily-briefing.json}"
base="${YUI_SIGNALS_URL:-http://127.0.0.1:8770}"

if [ ! -f "$fixture" ]; then
  echo "fixture missing: $fixture" >&2
  exit 2
fi

status=$(curl -sS -o /dev/null -w '%{http_code}' \
  -X POST "$base/signals" \
  -H 'content-type: application/json' \
  --data-binary "@$fixture")
echo "$status"

case "$status" in
  2??) exit 0 ;;
  *) exit 1 ;;
esac
