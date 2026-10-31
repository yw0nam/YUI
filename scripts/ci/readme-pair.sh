#!/usr/bin/env bash
# CI readme-pair: fail when a PR changes README.md or README.ja.md but not the
# other, so the two languages carry the same content. Bypass with the
# readme-one-language PR label (README_PAIR_SKIP=1 in CI).
#
# Usage: readme-pair.sh <base-ref>   (run from repo root)
set -u

BASE="${1:-origin/main}"

if [ "${README_PAIR_SKIP:-}" = "1" ]; then
  echo "readme-pair: skipped (readme-one-language label)"
  exit 0
fi

range="$BASE"
if mb=$(git merge-base "$BASE" HEAD 2>/dev/null); then
  range="$mb"
fi

changed=$(git diff --name-only "$range"...HEAD -- README.md README.ja.md 2>/dev/null) || {
  echo "readme-pair: cannot diff against $BASE — skipping" >&2
  exit 0
}

case "$(printf '%s\n' "$changed" | grep -c .)" in
  0) echo "readme-pair: no README change"; exit 0 ;;
  2) echo "readme-pair: README.md and README.ja.md both changed — ok"; exit 0 ;;
esac

missing=README.ja.md
[ "$changed" = "README.ja.md" ] && missing=README.md
cat >&2 <<MSG
readme-pair: ${changed} changed but ${missing} did not. Carry the same change
into ${missing}, or apply the 'readme-one-language' label when the change
belongs to one language only.
MSG
exit 1
