#!/usr/bin/env bash
# PreToolUse(Bash) guard. Denies shell reads of .env.local (secret exposure)
# and git commit/push while on main (worktree → PR rule). The agent cannot
# commit/push to main; it must request the user. Fails OPEN on any error.
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

git_cmd=$(printf '%s' "$cmd" | sed "s/'[^']*'//g; s/\"[^\"]*\"//g") || git_cmd=""
if printf '%s' "$git_cmd" | grep -qE '(^|[;&|[:space:]])git(([[:space:]]+-[^[:space:];&|]+)*[[:space:]]+|[[:space:]]+-C[[:space:]]+([^[:space:];&|]+[[:space:]]+)?)(commit|push)([[:space:]]|$)'; then
  git_dir="${cwd:-.}"
  target=$(printf '%s' "$cmd" \
    | grep -oE '(^|[;&|[:space:]])git[[:space:]]+-C[[:space:]]+("[^"]*"|'"'"'[^'"'"']*'"'"'|[^[:space:];&|]+)' \
    | head -1 \
    | sed -E 's/^.*git[[:space:]]+-C[[:space:]]+//') || target=""
  if [ -z "$target" ]; then
    target=$(printf '%s' "$cmd" \
      | grep -oE '(^|[;&|])[[:space:]]*cd[[:space:]]+("[^"]*"|'"'"'[^'"'"']*'"'"'|[^[:space:];&|]+)' \
      | tail -1 \
      | sed -E 's/^.*cd[[:space:]]+//') || target=""
  fi
  case "$target" in
    \"*\") target=${target#\"}; target=${target%\"} ;;
    \'*\') target=${target#\'}; target=${target%\'} ;;
  esac
  if [ -n "$target" ] && ! printf '%s' "$target" | grep -q '[[:space:]]'; then
    case "$target" in
      /*) git_dir="$target" ;;
      *) git_dir="${cwd:-.}/$target" ;;
    esac
  fi
  branch=$(git -C "$git_dir" branch --show-current 2>/dev/null) || branch=""
  if [ "$branch" = "main" ]; then
    deny "Current branch is main — work happens in a worktree and lands via PR (AGENTS.md). The agent cannot commit/push to main; request the user to run it directly."
  fi
fi

# Protect purchased_motions (resources/ or public/) from agent mutation
# (move/copy/delete/overwrite) and from being staged/pushed to git
# (purchased_motions/AGENTS.md). Reads (cat/ls/grep) pass. YUI_ALLOW_MOTIONS=1 bypasses.
if [ "${YUI_ALLOW_MOTIONS:-}" != "1" ] \
  && printf '%s' "$cmd" | grep -q 'purchased_motions'; then
  if printf '%s' "$cmd" | grep -qE '(^|[;&|`]|[[:space:]])(rm|mv|cp|rsync|install|ln|touch|truncate|shred|dd|mkdir|rmdir|chmod|chown|chflags)([[:space:]]|$)' \
    || printf '%s' "$cmd" | grep -qE 'sed[[:space:]]+-i' \
    || printf '%s' "$cmd" | grep -qE 'git[[:space:]]+(mv|rm|add|checkout|restore|stash)([[:space:]]|$)' \
    || printf '%s' "$cmd" | grep -qE '>>?[[:space:]]*[^|;&]*purchased_motions'; then
    deny "purchased_motions is protected — purchased motion files must not be moved, copied, deleted, overwritten, or staged/pushed to git by the agent (purchased_motions/AGENTS.md). Reading is fine. If you are human-approved to curate these, re-run with YUI_ALLOW_MOTIONS=1."
  fi
fi

exit 0
