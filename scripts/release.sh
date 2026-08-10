#!/usr/bin/env bash
# Cut a release: bump the version in the three version files, commit, tag,
# push, and create the GitHub release with generated notes.
#
# Usage: release.sh <major|minor|patch>
set -euo pipefail
cd "$(dirname "$0")/.."

case "${1:-}" in
  major | minor | patch) bump="$1" ;;
  *)
    echo "usage: release.sh <major|minor|patch>" >&2
    exit 2
    ;;
esac

# The command-text guard cannot see git spawned from a script, so this path
# refuses itself: agents land work via PR; the operator cuts releases.
if [ -n "${CLAUDECODE:-}" ]; then
  echo "refusing to release: releases are cut by the operator, not an agent" >&2
  exit 1
fi
if [ -n "$(git status --porcelain)" ]; then
  echo "refusing to release: working tree is dirty" >&2
  exit 1
fi
branch=$(git branch --show-current)
if [ "$branch" != main ]; then
  echo "refusing to release: on branch '$branch', expected main" >&2
  exit 1
fi

cur=$(sed -n 's/^version = "\(.*\)"$/\1/p' src-tauri/Cargo.toml)
IFS=. read -r major minor patch <<<"$cur"
case "$bump" in
  major) new="$((major + 1)).0.0" ;;
  minor) new="$major.$((minor + 1)).0" ;;
  patch) new="$major.$minor.$((patch + 1))" ;;
esac
if git rev-parse -q --verify "refs/tags/v$new" >/dev/null; then
  echo "refusing to release: v$new already exists" >&2
  exit 1
fi

sed -i '' "s/^version = \"$cur\"\$/version = \"$new\"/" src-tauri/Cargo.toml
sed -i '' "s/^  \"version\": \"[^\"]*\",\$/  \"version\": \"$new\",/" src-tauri/tauri.conf.json package.json
cargo update --workspace --manifest-path src-tauri/Cargo.toml

git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json package.json
git commit -m "chore: release v$new"
git tag -a "v$new" -m "v$new"
git push --follow-tags
gh release create "v$new" --generate-notes
