#!/usr/bin/env bash
# PostToolUse(Write|Edit|NotebookEdit) guard. Blocks change-narrative
# vocabulary landing in markdown docs (docs are current-state only); nudges
# (non-blocking) when one side of a contract/doc pair changes. Fails OPEN
# on any error.
set -u

input=$(cat 2>/dev/null) || exit 0
fp=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty' 2>/dev/null) || exit 0
[ -z "$fp" ] && exit 0
text=$(printf '%s' "$input" | jq -r '.tool_input.content // .tool_input.new_string // empty' 2>/dev/null)

case "$fp" in */node_modules/*|*/.github/*|*/.claude/*) exit 0 ;; esac

# Lines quoting the vocabulary list itself (e.g. the AGENTS.md rule) are skipped.
project_dir=${CLAUDE_PROJECT_DIR:-}
case "$project_dir:$fp" in
  :*.md|"${project_dir%/}":"${project_dir%/}"/*.md)
    ;;
  *:*.md)
    fp=""
    ;;
esac
case "$fp" in
  *.md)
    bad=$(printf '%s' "$text" \
      | grep -vE '제거/대체/축소' \
      | grep -nE '더 이상|이전엔|이전에는|기존에는|제거(했|됐|되었)|대체(했|됐|되었)|축소(했|됐|되었)|추가했다|supersede|no longer' \
      | head -5)
    if [ -n "$bad" ]; then
      jq -cn --arg b "$bad" \
        '{decision:"block",reason:("Intentional guard: LLMs habitually narrate the diff — \"was X, now Y\", \"previously\", \"no longer\", \"제거했다\" — and this hook deliberately blocks that. Docs here are current-state only: describe what the system IS now, declaratively, as if it had always been this way. No before/after, no change history (rule: yui-dev-workflow skill). Flagged:\n" + $b)}'
      exit 0
    fi
    ;;
esac

ctx=""
add_ctx() {
  ctx="${ctx}${ctx:+
}$1"
}

case "$fp" in
  */configs/motions.json)
    add_ctx "configs/motions.json changed — keep docs/reference/motions.md in sync."
    ;;
esac

if [ -n "$ctx" ]; then
  printf '%s' "$ctx" | jq -Rs '{hookSpecificOutput:{hookEventName:"PostToolUse",additionalContext:.}}'
fi

exit 0
