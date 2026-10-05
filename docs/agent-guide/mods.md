# YUI — Mods & CI

Mods are standalone MCP servers under `Mods/`, independent of the app runtime (overview: `Mods/README.md`). Each is a **self-contained `uv` project** with its own dependency set — no shared lock, so one mod's deps never leak into another.

## Adding a mod

To add a mod `<name>`:

1. `Mods/<name>/` — `pyproject.toml` (deps + `[project.scripts]` entry + dev `pytest`/`ruff` + `[tool.ruff] line-length = 110`), `uv.lock` (`uv lock`), `.python-version`, the `<package>/` source, and `tests/` (failing test first). `uv.lock` is required: CI runs `uv sync --frozen` in every folder that tracks a `pyproject.toml`.
2. Containerized? Add a `Dockerfile` in the mod folder (build context = the folder) and a service in `Mods/docker-compose.yml`. Host-native instead (needs the Mac GUI, like `desktop-control`)? Document it and skip Docker.
3. Reachable through the router? Add one line to `UPSTREAMS` in `Mods/router/router/server.py` (`"<name>": "http://127.0.0.1:<port>"`) plus a `resolve` test.
4. `Mods/<name>/README.md` (run / safety / tools / test) and a row in the `Mods/README.md` index.
5. `docs/reference/mods.md` — a catalog row plus a per-mod section (tools table + safety boundary); and the folder in the `Mods/` tree in `docs/agent-guide/project-structure.md`.

Verify locally before the PR: `cd Mods/<name> && uv run pytest && uv run ruff format --check . && uv run ruff check .`.

## CI

`main` requires a PR with the checks below green (enforcement points: `docs/agent-guide/harness-enforcement.md`):

- `web (tsc + vitest)`, `lint (biome)` — the app (TS); `rust (cargo test)` — `src-tauri/`; `rust-windows (cargo check)` compiles `src-tauri/` on a Windows runner.
- `test-guard` — source changes under `src/` / `src-tauri/` must ship a test (`skip-tests` label bypasses); it does **not** scope the standalone Python projects.
- `pr-title` — Conventional-Commit type + **printable-ASCII subject** (English; no em-dash or emoji in the title).
- `mods (uv + pytest)` and `mods-lint (ruff)` run on every PR over every tracked `pyproject.toml` folder. They are not required checks in the repository rulesets.

Ruff is the only Python linter (`format --check` + `check`, `line-length = 110`) for the Python projects covered by that job.
