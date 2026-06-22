#!/usr/bin/env bash
# Launch the local Chrome with a CDP endpoint on 127.0.0.1 so the remote agent's
# own Playwright MCP can drive THIS browser (your logins/cookies, visible on your
# screen) over an SSH reverse tunnel. This exposes no MCP tools — it is a browser,
# not a mod.
#
# Modern Chrome refuses --remote-debugging-port on the default profile, so this
# uses a dedicated, persistent --user-data-dir: log into your sites once and the
# session persists across runs.
set -euo pipefail

PORT="${CDP_PORT:-9222}"
PROFILE="${CDP_PROFILE:-$HOME/.yui-cdp-chrome}"
CHROME="${CHROME_BIN:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"

if [ ! -x "$CHROME" ]; then
  echo "Chrome not found at: $CHROME (set CHROME_BIN)" >&2
  exit 1
fi

mkdir -p "$PROFILE"
echo "Chrome CDP on 127.0.0.1:$PORT  (profile: $PROFILE)"
echo "Tunnel it:  ssh -R $PORT:localhost:$PORT <remote-host>"
echo "Agent side: npx @playwright/mcp@latest --cdp-endpoint http://localhost:$PORT"

# --remote-debugging-address defaults to loopback; keep it that way — never 0.0.0.0.
exec "$CHROME" \
  --remote-debugging-port="$PORT" \
  --user-data-dir="$PROFILE" \
  "$@"
