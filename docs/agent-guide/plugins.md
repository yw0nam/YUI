# YUI — Plugins & CI

`plugins/` holds every plugin folder, independent of the app runtime. Each is a **Rust plugin crate** (browser) that bundles an MCP server: YUI's MCP host starts it from the `command` in `.mcp.json`, and it speaks MCP over stdio and opens no port. The plugin release workflow builds and releases them; `docs/agent-guide/build-run.md` § Plugin releases gives the layout.

Coding-agent plugins (yui-notify, yui-dev) live in `coding-agents/` and install into Claude Code and Codex from the `yui` marketplace. yui-notify holds standard-library hooks and an inbox poller, with a `uv` project for the development checks.

`plugins/catalog.json` lists the official and community plugins; the plugin release workflow opens a PR that writes the official entries (`docs/agent-guide/build-run.md` § Plugin releases).

## Adding a Rust plugin crate

To add a Rust plugin crate `<id>`:

1. `plugins/<id>/` — the layout of `docs/agent-guide/build-run.md` § Plugin releases: `Cargo.toml` with the package and binary named `<id>`, a committed `Cargo.lock`, `.claude-plugin/plugin.json`, and `.mcp.json` whose server `command` is `${CLAUDE_PLUGIN_ROOT}/bin/<id>`.
2. `plugins/<id>/src/` with its tests (failing test first; what a test must prove: `docs/agent-guide/testing.md` § What a test is for).
3. `plugins/<id>/README.md` and the folder in the `plugins/` tree in `docs/agent-guide/project-structure.md`.

Verify locally before the PR: `cd plugins/<id> && cargo fmt --check && cargo clippy --all-targets --locked -- -D warnings && cargo test --locked`.

## CI

`main` requires a PR with the checks below green (enforcement points: `docs/agent-guide/harness-enforcement.md`):

- `web (tsc + vitest)`, `lint (biome)` — the app (TS); `rust (cargo test)` — `src-tauri/`; `rust-windows (cargo check)` compiles `src-tauri/` on a Windows runner.
- `test-guard` — source changes under `src/` / `src-tauri/` and a plugin crate's `src/` must ship a test (`skip-tests` label bypasses); it does **not** scope the standalone Python projects.
- `pr-title` — Conventional-Commit type + **printable-ASCII subject** (English; no em-dash or emoji in the title).

`python (uv + pytest)` and `python-lint (ruff)` run on every PR over every tracked `pyproject.toml` folder — the Coding-agent plugins under `coding-agents/` and the Python projects under `integrations/`. They are not required checks in the repository rulesets.

`plugins-rust (cargo fmt + clippy + test)` runs `cargo fmt --check`, `cargo clippy --all-targets --locked -- -D warnings`, and `cargo test --locked` over every tracked `plugins/*/Cargo.toml`; on a pull request it runs them only when a crate's `Cargo.toml`, `Cargo.lock`, or `src/`, or `.github/workflows/ci.yml` changes. It is not a required check.

Ruff is the only Python linter (`format --check` + `check`, `line-length = 110`) for the Python projects covered by that job.
