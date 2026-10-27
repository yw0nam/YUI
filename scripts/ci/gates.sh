#!/usr/bin/env bash
# Runs every check CI runs for the app, one line per gate with its exit code; exits 1 when any gate failed.
# Each gate's output goes to its own log ($GATES_LOG_DIR, else a temp dir), named in the line of a failed gate.
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
  "pnpm docs:build"
  "cargo fmt --manifest-path src-tauri/Cargo.toml --check"
  "cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings"
  "cargo test --manifest-path src-tauri/Cargo.toml"
)
logs="${GATES_LOG_DIR:-$(mktemp -d -t yui-gates)}"
mkdir -p "$logs"
failed=0
for gate in "${gates[@]}"; do
  log="$logs/$(printf '%s' "$gate" | tr -c 'A-Za-z0-9' '_' | cut -c1-60).log"
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
