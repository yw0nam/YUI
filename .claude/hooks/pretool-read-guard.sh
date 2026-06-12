#!/usr/bin/env bash
# PreToolUse(Read) guard: keeps .env.local (VITE_YUI_CHAT_KEY) out of the
# transcript. Fails OPEN on any error.
set -u

input=$(cat 2>/dev/null) || exit 0
fp=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty' 2>/dev/null) || exit 0

case "$fp" in
  *.env.local)
    jq -cn '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:".env.local holds VITE_YUI_CHAT_KEY — reading it into the transcript is blocked. Check existence with ls instead."}}'
    ;;
esac

exit 0
