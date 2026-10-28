# YUI — Plugins & CI

`plugins/` holds **Backend-attached plugins**: plugin folders that each bundle a Backend-attached MCP server, independent of the app runtime. Each is a **self-contained `uv` project** with its own dependency set — no shared lock, so one plugin's deps never leak into another. The backend agent reaches them through its own MCP configuration, over a loopback port and an SSH reverse tunnel.

`plugins/catalog.json` lists the plugins the app installs from its Plugins section; the official entries are written by the plugin release workflow (`docs/agent-guide/build-run.md` § Plugin releases).

## Adding a plugin

To add a plugin `<name>`:

1. `plugins/<name>/` — `pyproject.toml` (deps + `[project.scripts]` entry + dev `pytest`/`ruff` + `[tool.ruff] line-length = 110`), `uv.lock` (`uv lock`), `.python-version`, the `<package>/` source, and `tests/` (failing test first; what a test must prove: `docs/agent-guide/testing.md` § What a test is for). `uv.lock` is required: CI runs `uv sync --frozen` in every folder that tracks a `pyproject.toml`.
2. `plugins/<name>/.claude-plugin/plugin.json` — the plugin manifest: its `name`, `version`, one-line `description`, `author`, and `license`.
3. `plugins/<name>/.mcp.json` — the MCP server the backend agent attaches: the server name, its `type`, and its URL.
4. `plugins/<name>/README.md` (run / config / safety boundary / tools / test) and the folder in the `plugins/` tree in `docs/agent-guide/project-structure.md`.
5. `plugins/<name>/skills/<skill-name>/SKILL.md` — the workflow the backend agent reads, when the plugin needs one.

Verify locally before the PR: `cd plugins/<name> && uv run pytest && uv run ruff format --check . && uv run ruff check .`.

## Exposure

Every plugin is reachable on loopback only — there is no transport auth, so any local process that can reach the port gets the plugin's full capability. A plugin binds `127.0.0.1`. Reach it from the remote agent over an SSH reverse tunnel, never by publishing it on `0.0.0.0`:

```bash
ssh -R <port>:localhost:<port> <remote-host>
```

Over HTTP, the server refuses a request whose `Host` is not a loopback name (`127.0.0.1`, `localhost`, `::1`) with 421 and a request with a non-loopback `Origin` with 403, while a local process that sends no browser headers can still use it.

## CI

`main` requires a PR with the checks below green (enforcement points: `docs/agent-guide/harness-enforcement.md`):

- `web (tsc + vitest)`, `lint (biome)` — the app (TS); `rust (cargo test)` — `src-tauri/`; `rust-windows (cargo check)` compiles `src-tauri/` on a Windows runner.
- `test-guard` — source changes under `src/` / `src-tauri/` must ship a test (`skip-tests` label bypasses); it does **not** scope the standalone Python projects.
- `pr-title` — Conventional-Commit type + **printable-ASCII subject** (English; no em-dash or emoji in the title).

`python (uv + pytest)` and `python-lint (ruff)` run on every PR over every tracked `pyproject.toml` folder — the plugins under `plugins/` and the Python projects under `integrations/`. They are not required checks in the repository rulesets.

Ruff is the only Python linter (`format --check` + `check`, `line-length = 110`) for the Python projects covered by that job.
