#!/usr/bin/env bash
# PreToolUse(Bash) guard. Denies shell reads of .env.local (secret exposure)
# and git commit/push while on main (worktree → PR rule; YUI_ALLOW_MAIN=1
# bypasses for the explicit direct-to-main exception). Fails OPEN on any error.
set -u

deny() {
  jq -cn --arg r "$1" \
    '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
  exit 0
}

input=$(cat 2>/dev/null) || exit 0
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null) || exit 0
[ -z "$cmd" ] && exit 0
cwd=$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null)

if printf '%s' "$cmd" | grep -qE '(^|[;&|[:space:]])(cat|less|more|head|tail|bat|grep|rg|sed|awk|strings|base64|xxd|source)[^;&|]*\.env\.local'; then
  deny ".env.local holds VITE_YUI_CHAT_KEY — reading it into the transcript is blocked. Check existence with ls; scripts/worktree-setup.sh copies it without exposing contents."
fi

if [ "${YUI_ALLOW_MAIN:-}" != "1" ] \
  && printf '%s' "$cmd" | grep -qE '(^|[;&|[:space:]])git([[:space:]]+-[^[:space:]]+)*[[:space:]]+(commit|push)([[:space:]]|$)'; then
  branch=$(git -C "${cwd:-.}" branch --show-current 2>/dev/null) || branch=""
  if [ "$branch" = "main" ]; then
    deny "Current branch is main — work happens in a worktree and lands via PR (AGENTS.md). If the user explicitly approved a direct-to-main change, re-run with YUI_ALLOW_MAIN=1."
  fi
fi

exit 0
