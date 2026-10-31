#!/usr/bin/env bash
# Runs every app check CI runs, one line per gate with its exit code; a failed gate names its log ($GATES_LOG_DIR, else a temp dir).
set -u
cd "$(dirname "$0")/../.."
gates=(
  "pnpm test"
  "pnpm typecheck:test"
  "pnpm build"
  "pnpm lint"
  "pnpm map:check"
  "pnpm css:check"
  "pnpm logger:check"
  "pnpm commands:check"
  "pnpm docs:check"
  "pnpm docs:build"
  "cargo fmt --manifest-path src-tauri/Cargo.toml --check"
  "cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --locked -- -D warnings"
  "cargo test --manifest-path src-tauri/Cargo.toml --locked"
  "bash scripts/ci/test-guard.sh origin/main"
  "bash scripts/ci/readme-pair.sh origin/main"
)
logs="${GATES_LOG_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/yui-gates.XXXXXX")}"
mkdir -p "$logs"
failed=0
i=0
for gate in "${gates[@]}"; do
  i=$((i + 1))
  log="$logs/$(printf '%02d-' "$i")$(printf '%s' "$gate" | tr -c 'A-Za-z0-9' '_' | cut -c1-60).log"
  bash -c "$gate" >"$log" 2>&1
  code=$?
  if [ "$code" -eq 0 ]; then
    printf 'exit 0  %s\n' "$gate"
  else
    failed=1
    printf 'exit %d  %s  (%s)\n' "$code" "$gate" "$log"
  fi
done
exit "$failed"
