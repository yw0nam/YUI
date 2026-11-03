#!/usr/bin/env bash
# Red run of a `test:` commit (docs/agent-guide/testing.md rules 7-8): checks the commit out in a
# throwaway worktree, runs the test files it adds or changes, and names every test case the commit
# adds that already passes there. Each named case needs rule 8's mutation proof, or it is no red test.
#
# Usage: bash scripts/red-run.sh <test-commit>   (run from any checkout of the repo)
# Exit 0 when every added case fails, 1 when one already passes, 2 on a setup error.
set -u

commit="${1:?usage: red-run.sh <test-commit>}"
root="$(git rev-parse --show-toplevel)" || exit 2
cd "$root" || exit 2
wt="$(mktemp -d "${TMPDIR:-/tmp}/red-run.XXXXXX")"
git worktree add -q --detach "$wt" "$commit" || exit 2
trap 'git worktree remove --force "$wt" >/dev/null 2>&1' EXIT
bash scripts/worktree-setup.sh "$wt" "$root" >/dev/null 2>&1

files="$(git diff --name-only "$commit^" "$commit")"
ts="$(printf '%s\n' "$files" | grep -E '\.test\.tsx?$' || true)"
py="$(printf '%s\n' "$files" | grep -E '(^|/)test_[^/]*\.py$' || true)"
# Titles of the cases the commit adds: it("…"), it.each(…)("…"), test("…"), def test_….
added="$(git diff -U0 "$commit^" "$commit" -- $ts $py | grep -E '^\+' |
  sed -nE 's/^\+[[:space:]]*(it|test)(\.each\(.*\))?\([[:space:]]*["'"'"'`]([^"'"'"'`]+).*/\3/p;
           s/^\+[[:space:]]*(async[[:space:]]+)?def[[:space:]]+(test_[A-Za-z0-9_]+).*/\2/p')"
[ -z "$added" ] && { echo "red-run: $commit adds no test case"; exit 0; }

passed=""
if [ -n "$ts" ]; then
  (cd "$wt" && ./node_modules/.bin/vitest run $ts --reporter=json --outputFile="$wt/.red-run.json" >/dev/null 2>&1)
  passed="$(node -e '
    const r = require(process.argv[1]);
    for (const f of r.testResults) for (const a of f.assertionResults)
      if (a.status === "passed") console.log(a.title);
  ' "$wt/.red-run.json" 2>/dev/null)"
fi
for f in $py; do
  proj="$(dirname "$(dirname "$f")")"
  out="$(cd "$wt/$proj" && uv run --quiet pytest -q -rA "${f#"$proj"/}" 2>/dev/null)"
  passed="$passed
$(printf '%s\n' "$out" | sed -nE 's/^PASSED [^:]*::([A-Za-z0-9_]+).*/\1/p')"
done

green=""
while IFS= read -r title; do
  [ -z "$title" ] && continue
  # A templated title (%s, $name) matches the run's rendered titles by its fixed prefix.
  prefix="${title%%[%\$]*}"
  if printf '%s\n' "$passed" | grep -qF -- "$prefix"; then
    green="$green
  $title"
  fi
done <<EOF
$added
EOF

if [ -n "$green" ]; then
  echo "red-run: these cases added by $commit already pass at it:$green"
  echo "red-run: show each failing under a mutated production line (testing.md rule 8), or drop it"
  exit 1
fi
echo "red-run: every case $commit adds fails at it — red"
