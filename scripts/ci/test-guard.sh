#!/usr/bin/env bash
# CI test-guard: fail when a PR's source change is large enough to plausibly
# change behavior yet ships no test change — the "every new/changed behavior
# carries a test in the same PR" rule, enforced.
#
# Scope: added/changed lines under src/ and src-tauri/ that are NOT test code.
# A change counts as tested if any test file changed (*.test.ts, *.spec.ts,
# tests/ for web; *_test.rs, a tests/ dir, or an added #[test]/#[cfg(test)]
# for Rust). Bypass with the skip-tests PR label (TEST_GUARD_SKIP=1 in CI).
#
# Usage: test-guard.sh <base-ref>   (run from repo root)
set -u

BASE="${1:-origin/main}"
THRESHOLD="${TEST_GUARD_THRESHOLD:-20}"

if [ "${TEST_GUARD_SKIP:-}" = "1" ]; then
  echo "test-guard: skipped (skip-tests label)"
  exit 0
fi

# Merge-base diff so we measure only what this branch adds over base.
range="$BASE"
if mb=$(git merge-base "$BASE" HEAD 2>/dev/null); then
  range="$mb"
fi

changed=$(git diff --name-only "$range"...HEAD 2>/dev/null) || {
  echo "test-guard: cannot diff against $BASE — skipping" >&2
  exit 0
}
[ -z "$changed" ] && { echo "test-guard: no changes"; exit 0; }

is_test_path() {
  case "$1" in
    *.test.ts | *.test.tsx | *.spec.ts | *.spec.tsx) return 0 ;;
    */tests/* | tests/*) return 0 ;;
    *_test.rs | */tests.rs) return 0 ;;
    *) return 1 ;;
  esac
}

is_source_path() {
  case "$1" in
    src/* | */src/* | src-tauri/*) ;;
    *) return 1 ;;
  esac
  case "$1" in
    *.ts | *.tsx | *.js | *.mjs | *.rs) return 0 ;;
    *) return 1 ;;
  esac
}

src_added=0
test_changed=0

while IFS= read -r f; do
  [ -z "$f" ] && continue
  if is_test_path "$f"; then
    test_changed=1
    continue
  fi
  if is_source_path "$f"; then
    # Count added/modified source lines (added lines in the diff).
    n=$(git diff --numstat "$range"...HEAD -- "$f" 2>/dev/null | awk '{print $1}')
    case "$n" in '' | '-') n=0 ;; esac
    src_added=$((src_added + n))
    # An inline Rust test added in the same source file counts as a test change.
    if printf '%s' "$f" | grep -q '\.rs$'; then
      if git diff "$range"...HEAD -- "$f" 2>/dev/null \
        | grep -qE '^\+.*(#\[test\]|#\[cfg\(test\)\])'; then
        test_changed=1
      fi
    fi
  fi
done <<EOF
$changed
EOF

if [ "$src_added" -le "$THRESHOLD" ]; then
  echo "test-guard: ${src_added} source line(s) changed (<= ${THRESHOLD}) — ok"
  exit 0
fi

if [ "$test_changed" = "1" ]; then
  echo "test-guard: ${src_added} source line(s) changed, tests present — ok"
  exit 0
fi

cat >&2 <<MSG
test-guard: ${src_added} source line(s) changed under src/ or src-tauri/ with no
accompanying test change. New or changed behavior must ship a test in the same
PR (AGENTS.md). Add the test, or apply the 'skip-tests' label for a justified
exception (rename, config-only, generated code).
MSG
exit 1
