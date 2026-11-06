#!/usr/bin/env bash
# CI rule-tests: fail when a PR edits, moves, or deletes a rule test — a code file that pins a
# repo-wide rule and carries a `rule-test:` marker line in the base version (docs/agent-guide/
# testing.md rule 9: a rule is met by fixing what breaks it, never by loosening its test). A doc
# (*.md) or this script only mentions the marker. A deliberate rule change takes the rule-change
# PR label (RULE_TESTS_SKIP=1 in CI).
#
# Usage: rule-tests.sh <base-ref>   (run from repo root)
set -u

BASE="${1:-origin/main}"
if [ "${RULE_TESTS_SKIP:-}" = "1" ]; then
  echo "rule-tests: skipped (rule-change label)"
  exit 0
fi

range="$BASE"
if mb=$(git merge-base "$BASE" HEAD 2>/dev/null); then
  range="$mb"
fi

hit=0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  case "$f" in
    *.md | scripts/ci/rule-tests.sh) continue ;;
  esac
  if git show "$range:$f" 2>/dev/null | grep -q 'rule-test:'; then
    echo "rule-tests: $f is a rule test and this branch changes it" >&2
    hit=1
  fi
done <<EOF
$(git diff --no-renames --name-only "$range"...HEAD 2>/dev/null)
EOF

if [ "$hit" = "1" ]; then
  echo "rule-tests: fix the code that breaks the rule, or apply the 'rule-change' label for a deliberate rule change" >&2
  exit 1
fi
echo "rule-tests: no rule test changed — ok"
