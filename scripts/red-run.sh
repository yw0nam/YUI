#!/usr/bin/env bash
# Red run of a `test:` commit (docs/agent-guide/testing.md rules 7-8): checks the commit out in a
# throwaway worktree, runs the test files it adds or changes, and prints one line per test case the
# commit adds: its kind and the first line of its error. Each named case needs rule 8's mutation proof,
# or it is no red test. The kinds:
#   red      the case failed on an assertion (vitest AssertionError or a snapshot mismatch; pytest assert)
#   harness  the case failed before any assertion ran: a missing module or import, ReferenceError,
#            TypeError, a syntax error, a timeout, or a whole-file collection failure; nothing about
#            behaviour is shown, so the failure proves no red test
#   passes   the case already passes at the commit
#
# Usage: bash scripts/red-run.sh <test-commit>   (run from any checkout of the repo)
# A commit that changes test files but adds no case title it can name (assertions added inside existing
# cases) is judged by the files alone: their failing cases are classified the same way.
# Exit 0 when every added case is red. Exit 1 when any added case passes, any is harness, or one could
# not be matched to a result. Exit 2 on a setup error.
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
[ -z "$ts$py" ] && { echo "red-run: $commit adds no test case"; exit 0; }
tab=$'\t'

# Titles of the cases the commit adds to one file: it("…"), it.each(…)("…"), test("…"), def test_…; a
# title on the line after an opening `it(` / `it.each(…)(` / `])(` / `] as const)(` is read from that line.
added_titles() {
  git diff -U0 "$commit^" "$commit" -- "$1" | grep -E '^\+' |
    sed -nE 's/^\+[[:space:]]*(it|test)(\.each\(.*\))?\([[:space:]]*["'"'"'`]([^"'"'"'`]+).*/\3/p;
             s/^\+[[:space:]]*[]})]+([[:space:]]+as[[:space:]]+const[[:space:]]*\))?\([[:space:]]*["'"'"'`]([^"'"'"'`]+).*/\2/p;
             /^\+[[:space:]]*((it|test)(\.each\(.*\))?|[]})]+([[:space:]]+as[[:space:]]+const[[:space:]]*\))?)\([[:space:]]*$/{n;s/^\+[[:space:]]*["'"'"'`]([^"'"'"'`]+).*/\1/p;};
             s/^\+[[:space:]]*(async[[:space:]]+)?def[[:space:]]+(test_[A-Za-z0-9_]+).*/\2/p'
}

# One line per case the run reports: kind<TAB>file<TAB>title<TAB>first error line. A failure of a whole
# file (collection) has the title "(whole file)". kind: pass, red (a failed assertion) or harness (any other failure).
results=""
if [ -n "$ts" ]; then
  (cd "$wt" && ./node_modules/.bin/vitest run $ts --reporter=json --outputFile="$wt/.red-run.json" >/dev/null 2>&1)
  results="$(cd "$wt" && node -e '
    const r = require(process.argv[1]);
    const one = (s) => String(s ?? "").split("\n").find((l) => l.trim()) ?? "";
    // vitest names an expect() failure AssertionError, and a snapshot mismatch Error: Snapshot ...
    const kind = (m) => (/^(AssertionError|Error: Snapshot)/.test(m) ? "red" : "harness");
    for (const f of r.testResults) {
      const file = require("path").relative(process.cwd(), f.name);
      if (!f.assertionResults.length && f.status === "failed") console.log(["harness", file, "(whole file)", one(f.message)].join("\t"));
      for (const a of f.assertionResults) {
        if (a.status === "passed") console.log(["pass", file, a.title, ""].join("\t"));
        if (a.status === "failed") { const m = one(a.failureMessages[0]); console.log([kind(m), file, a.title, m].join("\t")); }
      }
    }
  ' "$wt/.red-run.json" 2>/dev/null)"
fi
for f in $py; do
  proj="$(dirname "$(dirname "$f")")"
  # pytest's JUnit XML names each case and gives the failure's first line; an assert failure reads
  # `assert …` or `AssertionError…`, a failure of a whole file (collection) is an <error> with no case.
  (cd "$wt/$proj" && uv run --quiet pytest -q "${f#"$proj"/}" --junitxml="$wt/.red-run.xml" >/dev/null 2>&1)
  pyres="$(cd "$wt/$proj" && uv run --quiet python -I -c '
import re, sys, xml.etree.ElementTree as ET
last = lambda t: next((l[1:].strip() for l in reversed((t or "").splitlines()) if l.startswith("E ")), "")
for c in ET.parse(sys.argv[1]).iter("testcase"):
    bad = next((e for e in c if e.tag in ("failure", "error")), None)
    if bad is None:
        if not any(e.tag == "skipped" for e in c):
            print("pass", sys.argv[2], c.get("name"), "", sep="\t")
        continue
    msg = (bad.get("message") or "").splitlines()[0:1] or [""]
    msg = last(bad.text) if msg[0] == "collection failure" else msg[0]
    whole = bad.get("message", "").startswith("collection failure")
    red = bad.tag == "failure" and re.match(r"(assert( |$)|AssertionError|Failed: DID NOT RAISE)", msg)
    print("red" if red else "harness", sys.argv[2], "(whole file)" if whole else c.get("name"), msg, sep="\t")
  ' "$wt/.red-run.xml" "$f" 2>/dev/null)"
  results="$results
$pyres"
done
results="$(printf '%s\n' "$results" | sed "/^\$/d; s#[^ ]*/red-run\.[A-Za-z0-9]*/##g" | cut -c1-400)"

fails=0
n_red=0 n_harness=0 n_pass=0 n_miss=0
say() { # kind, file, title, message
  printf '  %-8s %s  [%s]%s\n' "$1" "$3" "$2" "${4:+  $4}" | cut -c1-300
}

if [ -z "$(for f in $ts $py; do added_titles "$f"; done)" ]; then
  # No case title the parser can name: judge the files by every case that failed in them.
  [ -z "$results" ] && { echo "red-run: $commit adds no case title and its test files did not run"; exit 2; }
  echo "red-run: $commit changes test files but adds no case title the parser can name; failing cases at it:"
  failing="$(printf '%s\n' "$results" | grep -vE '^pass' || true)"
  while IFS="$tab" read -r kind file title msg; do
    [ -z "$kind" ] && continue
    say "$kind" "$file" "$title" "$msg"
  done <<EOF
$failing
EOF
  if printf '%s\n' "$failing" | grep -q '^harness'; then
    echo "red-run: some failures at $commit are harness errors, not assertions; no red is shown (testing.md rule 8)"
    exit 1
  fi
  if [ -n "$failing" ]; then
    echo "red-run: the cases above fail on an assertion at $commit — red"
    exit 0
  fi
  echo "red-run: $commit adds assertions or cases the parser could not name and none fail at it (testing.md rule 8)"
  exit 1
fi

hole=$'\001'
shown=""
for f in $ts $py; do
  fres="$(printf '%s\n' "$results" | awk -F'\t' -v f="$f" '$2 == f' | cut -f1,3-)"
  while IFS= read -r title; do
    [ -z "$title" ] && continue
    # An exact title wins; else anchored at the start only, so a title the parser cut at an inner quote
    # (window's) or an it.each title with $ placeholders still matches.
    re="$(printf '%s' "$title" | sed -E "s/%.|\\\$\\{[^}]*\\}|\\\$[A-Za-z0-9_#\$][A-Za-z0-9_.\$]*/$hole/g; s/[][\\.*^\$+?(){}|]/\\\\&/g; s/$hole/.*/g")"
    hit="$(printf '%s\n' "$fres" | grep -F -- "$tab$title$tab" | awk -F'\t' -v t="$title" '$2 == t' || true)"
    [ -z "$hit" ] && hit="$(printf '%s\n' "$fres" | grep -E -- "^[a-z]+$tab$re" || true)"
    if [ -z "$hit" ]; then
      # A file that failed as a whole ran none of its cases.
      hit="$(printf '%s\n' "$fres" | grep -E "^harness$tab\(whole file\)$tab" | head -1 || true)"
      if [ -n "$hit" ]; then
        hit="harness$tab$title$tab$(printf '%s' "$hit" | cut -f3-)"
      else
        n_miss=$((n_miss + 1))
        say "unmatched" "$f" "$title" "no result carries this title"
        continue
      fi
    fi
    while IFS="$tab" read -r kind t msg; do
      case "$kind" in
        red) n_red=$((n_red + 1)) ;;
        harness) n_harness=$((n_harness + 1)) ;;
        pass) n_pass=$((n_pass + 1)) ;;
      esac
      shown="$shown$f$tab$t
"
      say "$([ "$kind" = pass ] && echo passes || echo "$kind")" "$f" "$t" "$msg"
    done <<EOF
$hit
EOF
  done <<EOF
$(added_titles "$f")
EOF
done

# Failing cases the commit did not add (assertions it put inside existing cases); informational only.
others=""
while IFS="$tab" read -r kind file title msg; do
  { [ -z "$kind" ] || [ "$kind" = pass ]; } && continue
  printf '%s' "$shown" | grep -qxF -- "$file$tab$title" && continue
  [ "$title" = "(whole file)" ] && printf '%s' "$shown" | grep -qF -- "$file$tab" && continue
  others="$others$(say "$kind" "$file" "$title" "$msg")
"
done <<EOF
$results
EOF
[ -n "$others" ] && printf 'red-run: other cases failing in the changed files (not added by the commit, not counted):\n%s' "$others"
echo "red-run: $commit adds $((n_red + n_harness + n_pass + n_miss)) cases: $n_red red, $n_harness harness, $n_pass passes, $n_miss unmatched"
[ "$n_pass" -gt 0 ] && echo "red-run: the passes need a mutated production line that fails them (testing.md rule 8), or drop them"
[ "$n_harness" -gt 0 ] && echo "red-run: a harness case failed before any assertion ran (missing module, TypeError, wrong environment); make it reach its assertion and run again"
if [ "$n_pass" -gt 0 ] || [ "$n_harness" -gt 0 ] || [ "$n_miss" -gt 0 ]; then exit 1; fi
echo "red-run: every case $commit adds fails on an assertion at it — red"
