#!/usr/bin/env bash
# Red run of a `test:` commit (docs/agent-guide/testing.md rules 7-8): checks the commit out in a
# throwaway worktree, runs the test files it adds or changes, and names every test case the commit
# adds that already passes there. Each named case needs rule 8's mutation proof, or it is no red test.
#
# Usage: bash scripts/red-run.sh <test-commit>   (run from any checkout of the repo)
# A commit that changes test files but adds no case title it can name (assertions added inside existing
# cases) is judged by the files alone: exit 0 when one of them fails at the commit, 1 when none does.
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
# Titles of the cases the commit adds: it("…"), it.each(…)("…"), test("…"), def test_…; a title on
# the line after an opening `it(` / `it.each(…)(` / `])(` is read from that next line.
added="$(git diff -U0 "$commit^" "$commit" -- $ts $py | grep -E '^\+' |
  sed -nE 's/^\+[[:space:]]*(it|test)(\.each\(.*\))?\([[:space:]]*["'"'"'`]([^"'"'"'`]+).*/\3/p;
           s/^\+[[:space:]]*[]})]+\([[:space:]]*["'"'"'`]([^"'"'"'`]+).*/\1/p;
           /^\+[[:space:]]*((it|test)(\.each\(.*\))?|[]})]+)\([[:space:]]*$/{n;s/^\+[[:space:]]*["'"'"'`]([^"'"'"'`]+).*/\1/p;};
           s/^\+[[:space:]]*(async[[:space:]]+)?def[[:space:]]+(test_[A-Za-z0-9_]+).*/\2/p')"
[ -z "$added" ] && [ -z "$ts$py" ] && { echo "red-run: $commit adds no test case"; exit 0; }

passed=""
report=""
if [ -n "$ts" ]; then
  (cd "$wt" && ./node_modules/.bin/vitest run $ts --reporter=json --outputFile="$wt/.red-run.json" >/dev/null 2>&1)
  res="$(cd "$wt" && node -e '
    const r = require(process.argv[1]);
    for (const f of r.testResults) {
      const failed = f.assertionResults.filter((a) => a.status === "failed").length;
      console.log(`F ${require("path").relative(process.cwd(), f.name)}: ${f.status === "failed" ? `fails (${failed} of ${f.assertionResults.length} cases)` : "passes"}`);
      for (const a of f.assertionResults) if (a.status === "passed") console.log(`P ${a.title}`);
    }
  ' "$wt/.red-run.json" 2>/dev/null)"
  passed="$(printf '%s\n' "$res" | sed -nE 's/^P //p')"
  report="$(printf '%s\n' "$res" | sed -nE 's/^F /  /p')"
fi
for f in $py; do
  proj="$(dirname "$(dirname "$f")")"
  out="$(cd "$wt/$proj" && uv run --quiet pytest -q -rA "${f#"$proj"/}" 2>/dev/null)"
  passed="$passed
$(printf '%s\n' "$out" | sed -nE 's/^PASSED [^:]*::([A-Za-z0-9_]+).*/\1/p')"
  nfail="$(printf '%s\n' "$out" | grep -cE '^(FAILED|ERROR) ')"
  report="$report
  $f: $([ "$nfail" -gt 0 ] && echo "fails ($nfail cases)" || echo "passes")"
done

if [ -z "$added" ]; then
  report="$(printf '%s\n' "$report" | sed '/^$/d')"
  [ -z "$report" ] && { echo "red-run: $commit adds no case title and its test files did not run"; exit 2; }
  echo "red-run: $commit changes test files but adds no case title the parser can name; at it:"
  printf '%s\n' "$report"
  if printf '%s\n' "$report" | grep -q ': fails'; then
    echo "red-run: the files above fail at $commit — red"
    exit 0
  fi
  echo "red-run: $commit adds assertions or cases the parser could not name and none fail at it (testing.md rule 8)"
  exit 1
fi

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
