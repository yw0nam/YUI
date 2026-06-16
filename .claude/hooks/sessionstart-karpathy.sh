#!/usr/bin/env bash
set -euo pipefail

skill="$CLAUDE_PROJECT_DIR/.claude/skills/karpathy-guidelines/SKILL.md"
[ -f "$skill" ] || exit 0

jq -n --rawfile c "$skill" \
  '{hookSpecificOutput:{hookEventName:"SessionStart",additionalContext:$c}}'
