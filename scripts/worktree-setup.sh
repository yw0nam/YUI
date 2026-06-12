#!/usr/bin/env bash
# Links gitignored runtime assets (VRM, reference clips) and copies .env.local
# from the main checkout into a worktree. Idempotent; missing sources are
# skipped with a warning. Runs automatically via the WorktreeCreate hook;
# after a manual `git worktree add`, run it directly:
#   bash scripts/worktree-setup.sh <worktree-path> [main-checkout-path]
set -u

if [ $# -lt 1 ]; then
  echo "usage: worktree-setup.sh <worktree-path> [main-checkout-path]" >&2
  exit 64
fi

WT="$1"
MAIN="${2:-}"
if [ -z "$MAIN" ]; then
  MAIN="$(git -C "$WT" worktree list --porcelain 2>/dev/null | head -1 | sed 's/^worktree //')"
fi
if [ -z "$MAIN" ] || [ ! -d "$MAIN" ]; then
  echo "worktree-setup: cannot resolve main checkout (pass it as 2nd arg)" >&2
  exit 65
fi

link_asset() {
  src="$1"
  dst="$2"
  if [ ! -e "$src" ]; then
    echo "worktree-setup: skip (missing): $src" >&2
    return 0
  fi
  mkdir -p "$(dirname "$dst")"
  ln -sfn "$src" "$dst"
  echo "worktree-setup: linked $dst -> $src"
}

link_asset "$MAIN/resources/vrms/carlotta.vrm" "$WT/resources/vrms/carlotta.vrm"
link_asset "$MAIN/resources/references" "$WT/resources/references"

if [ -f "$MAIN/.env.local" ]; then
  cp "$MAIN/.env.local" "$WT/.env.local"
  echo "worktree-setup: copied .env.local"
else
  echo "worktree-setup: skip (missing): $MAIN/.env.local" >&2
fi

exit 0
