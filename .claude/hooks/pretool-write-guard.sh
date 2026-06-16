#!/usr/bin/env bash
# PreToolUse(Write|Edit|NotebookEdit) guard. Protects resources/purchased_motions
# from agent edits/overwrites — purchased motion files must not be modified
# (resources/purchased_motions/AGENTS.md). Reading is unaffected.
# YUI_ALLOW_MOTIONS=1 bypasses for human-approved curation. Fails OPEN on any error.
set -u

[ "${YUI_ALLOW_MOTIONS:-}" = "1" ] && exit 0

input=$(cat 2>/dev/null) || exit 0
fp=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty' 2>/dev/null) || exit 0
[ -z "$fp" ] && exit 0

case "$fp" in
  */resources/purchased_motions/*|resources/purchased_motions/*)
    jq -cn '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:"resources/purchased_motions is protected — purchased motion files must not be edited or overwritten by the agent (resources/purchased_motions/AGENTS.md). Reading is fine. If you are human-approved to curate these, re-run with YUI_ALLOW_MOTIONS=1."}}'
    ;;
esac

exit 0
