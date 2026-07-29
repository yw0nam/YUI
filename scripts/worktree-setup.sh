#!/usr/bin/env bash
# Links gitignored runtime assets (VRM, purchased motions) and copies .env.local
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

# Absolutize both paths — symlink targets resolve relative to the link's own
# directory, so relative arguments would produce dangling links.
WT=$(cd "$WT" 2>/dev/null && pwd) || {
  echo "worktree-setup: worktree path not found: $1" >&2
  exit 65
}
MAIN=$(cd "$MAIN" 2>/dev/null && pwd) || {
  echo "worktree-setup: main checkout not found: $MAIN" >&2
  exit 65
}

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

# Link every bundled VRM (configs/avatar.json lists several; a worktree missing any
# selectable VRM serves index.html for it and boot fails on the VRM parse).
if [ -d "$MAIN/resources/vrms" ]; then
  mkdir -p "$WT/resources/vrms"
  for f in "$MAIN/resources/vrms"/*.vrm; do
    [ -e "$f" ] && link_asset "$f" "$WT/resources/vrms/$(basename "$f")"
  done
fi
# Purchased motions: AGENTS.md is tracked but the .vrma files are gitignored, so the
# directory already exists in the worktree — link each .vrma individually rather than
# the whole directory (a dir symlink would nest under the tracked dir).
if [ -d "$MAIN/public/purchased_motions" ]; then
  mkdir -p "$WT/public/purchased_motions"
  for f in "$MAIN/public/purchased_motions"/*.vrma; do
    [ -e "$f" ] && link_asset "$f" "$WT/public/purchased_motions/$(basename "$f")"
  done
fi

if [ -f "$MAIN/.env.local" ]; then
  cp "$MAIN/.env.local" "$WT/.env.local"
  echo "worktree-setup: copied .env.local"
else
  echo "worktree-setup: skip (missing): $MAIN/.env.local" >&2
fi

exit 0
