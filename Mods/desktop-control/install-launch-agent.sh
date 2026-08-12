#!/usr/bin/env bash
# Installs (or removes) a launchd LaunchAgent that keeps desktop-control running.
# Usage:
#   DESKTOP_CONTROL_ALLOWED_APPS="Safari,Notes" ./install-launch-agent.sh
#   ./install-launch-agent.sh --uninstall
set -euo pipefail

LABEL="com.yui.desktop-control"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/$LABEL.log"
MOD_DIR="$(cd "$(dirname "$0")" && pwd)"

if [[ "${1:-}" == "--uninstall" ]]; then
  launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  echo "removed $PLIST"
  exit 0
fi

UV="$(command -v uv)" || { echo "uv not found in PATH" >&2; exit 1; }

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$UV</string>
    <string>run</string>
    <string>--project</string>
    <string>$MOD_DIR</string>
    <string>desktop-control-mcp</string>
    <string>--transport</string><string>http</string>
    <string>--host</string><string>127.0.0.1</string>
    <string>--port</string><string>9000</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>DESKTOP_CONTROL_ALLOWED_APPS</key>
    <string>${DESKTOP_CONTROL_ALLOWED_APPS:-}</string>
    <key>WITNESS_LOG_DIR</key>
    <string>${WITNESS_LOG_DIR:-}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "installed $PLIST (log: $LOG)"
