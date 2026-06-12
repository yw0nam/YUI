#!/usr/bin/env bash
# WorktreeCreate hook: the event replaces Claude Code's default worktree
# creation, so this script creates the worktree itself, runs
# scripts/worktree-setup.sh (runtime asset links + .env.local), and prints
# the worktree path — stdout must carry the path and nothing else.
set -u

input=$(cat 2>/dev/null) || input=""

PROJECT="${CLAUDE_PROJECT_DIR:-}"
[ -z "$PROJECT" ] && PROJECT=$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null)
[ -z "$PROJECT" ] && PROJECT="$PWD"

if ! git -C "$PROJECT" rev-parse --git-dir >/dev/null 2>&1; then
  echo "worktree-create: not a git repository: $PROJECT" >&2
  exit 1
fi

branch=$(printf '%s' "$input" | jq -r '.branch // .branch_name // .name // empty' 2>/dev/null)
[ -z "$branch" ] && branch="wt-$(date +%s)"

base="$(basename "$PROJECT")-$(printf '%s' "$branch" | tr '/' '-')"
parent="$(dirname "$PROJECT")"
path="$parent/$base"
n=1
while [ -e "$path" ]; do
  n=$((n + 1))
  path="$parent/$base-$n"
done

if git -C "$PROJECT" show-ref --verify --quiet "refs/heads/$branch"; then
  git -C "$PROJECT" worktree add "$path" "$branch" >&2 || exit 1
else
  git -C "$PROJECT" worktree add -b "$branch" "$path" >&2 || exit 1
fi

setup="$PROJECT/scripts/worktree-setup.sh"
[ -f "$setup" ] && bash "$setup" "$path" "$PROJECT" >&2

echo "$path"
exit 0
