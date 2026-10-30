# YUI — Plugins & CI

`plugins/` holds every plugin folder, independent of the app runtime, in three kinds:

- **Python plugins** (factorio) bundle a Backend-attached MCP server over HTTP, reached over a loopback port and an SSH reverse tunnel. Each is a **self-contained `uv` project** with its own dependency set — no shared lock, so one plugin's deps never leak into another.
- **Rust plugin crates** (browser) bundle an MCP server that speaks MCP over stdio and opens no port; `.mcp.json` names the `command` that starts it. The plugin release workflow builds and releases them; `docs/agent-guide/build-run.md` § Plugin releases gives the layout.
- **Coding-agent plugins** (yui-notify) install into Claude Code and Codex from the `yui` marketplace: hooks plus a stdio MCP channel server, a `uv` project.

`plugins/catalog.json` lists the official and community plugins; the plugin release workflow opens a PR that writes the official entries (`docs/agent-guide/build-run.md` § Plugin releases).

## Adding a Python plugin

To add a Python plugin `<name>`:

1. `plugins/<name>/` — `pyproject.toml` (deps + `[project.scripts]` entry + dev `pytest`/`ruff` + `[tool.ruff] line-length = 110`), `uv.lock` (`uv lock`), `.python-version`, the `<package>/` source, and `tests/` (failing test first; what a test must prove: `docs/agent-guide/testing.md` § What a test is for). `uv.lock` is required: CI runs `uv sync --frozen` in every folder that tracks a `pyproject.toml`.
2. `plugins/<name>/.claude-plugin/plugin.json` — the plugin manifest: its `name`, `version`, one-line `description`, `author`, and `license`.
3. `plugins/<name>/.mcp.json` — the MCP server the backend agent attaches: the server name, its `type`, and, for an HTTP server, its URL.
4. `plugins/<name>/README.md` (run / config / safety boundary / tools / test) and the folder in the `plugins/` tree in `docs/agent-guide/project-structure.md`.
5. `plugins/<name>/skills/<skill-name>/SKILL.md` — the workflow the backend agent reads, when the plugin needs one.

Verify locally before the PR: `cd plugins/<name> && uv run pytest && uv run ruff format --check . && uv run ruff check .`.

## Adding a Rust plugin crate

To add a Rust plugin crate `<id>`:

1. `plugins/<id>/` — the layout of `docs/agent-guide/build-run.md` § Plugin releases: `Cargo.toml` with the package and binary named `<id>`, a committed `Cargo.lock`, `.claude-plugin/plugin.json`, and `.mcp.json` whose server `command` is `${CLAUDE_PLUGIN_ROOT}/bin/<id>`.
2. `plugins/<id>/src/` with its tests (failing test first; what a test must prove: `docs/agent-guide/testing.md` § What a test is for).
3. `plugins/<id>/README.md` and the folder in the `plugins/` tree in `docs/agent-guide/project-structure.md`.

Verify locally before the PR: `cd plugins/<id> && cargo fmt --check && cargo clippy --all-targets --locked -- -D warnings && cargo test --locked`.

## Exposure

An HTTP plugin is reachable on loopback only — there is no transport auth, so any local process that can reach the port gets the plugin's full capability. An HTTP plugin binds `127.0.0.1`. Reach it from the remote agent over an SSH reverse tunnel, never by publishing it on `0.0.0.0`:

```bash
ssh -R <port>:localhost:<port> <remote-host>
```

Over HTTP, the server refuses a request whose `Host` is not a loopback name (`127.0.0.1`, `localhost`, `::1`) with 421 and a request with a non-loopback `Origin` with 403, while a local process that sends no browser headers can still use it.

A stdio plugin opens no port: its host starts it from `.mcp.json`, and it speaks MCP over the stdin and stdout of the process.

## CI

`main` requires a PR with the checks below green (enforcement points: `docs/agent-guide/harness-enforcement.md`):

- `web (tsc + vitest)`, `lint (biome)` — the app (TS); `rust (cargo test)` — `src-tauri/`; `rust-windows (cargo check)` compiles `src-tauri/` on a Windows runner.
- `test-guard` — source changes under `src/` / `src-tauri/` and a plugin crate's `src/` must ship a test (`skip-tests` label bypasses); it does **not** scope the standalone Python projects.
- `pr-title` — Conventional-Commit type + **printable-ASCII subject** (English; no em-dash or emoji in the title).

`python (uv + pytest)` and `python-lint (ruff)` run on every PR over every tracked `pyproject.toml` folder — the plugins under `plugins/` and the Python projects under `integrations/`. They are not required checks in the repository rulesets.

`plugins-rust (cargo fmt + clippy + test)` runs `cargo fmt --check`, `cargo clippy --all-targets --locked -- -D warnings`, and `cargo test --locked` over every tracked `plugins/*/Cargo.toml`; on a pull request it runs them only when a crate's `Cargo.toml`, `Cargo.lock`, or `src/`, or `.github/workflows/ci.yml` changes. It is not a required check.

Ruff is the only Python linter (`format --check` + `check`, `line-length = 110`) for the Python projects covered by that job.
