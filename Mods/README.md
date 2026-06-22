# YUI Mods

Standalone MCP servers ("Mods") that expose host capabilities to the remote backend agent (Hermes). Each Mod is an independent process, decoupled from the YUI app — the agent attaches them as tool sources alongside the Expression Broker.

Mod convention: each mod is a **self-contained `uv` project** in its own folder (`Mods/<mod>/`) with its own `pyproject.toml`, `uv.lock`, and dependency set — no shared lock, so a mod's deps never leak into another (e.g. the shell-sandbox image carries no `pyobjc`). Containerized mods keep a `Dockerfile` whose build context is that same folder; `docker-compose.yml` builds and deploys them together (`docker compose up -d --build`). Run any mod's tests with `cd Mods/<mod> && uv run pytest`. Python lint is **ruff** (format + check, `line-length = 110`), enforced in CI per mod — run it locally with `cd Mods/<mod> && uv run ruff format . && uv run ruff check .`.

## Mods

| Mod | Port | Runs | What |
|---|---|---|---|
| [router](router/) | 8080 | host-native | One HTTP front door — path-routes `/<mod>/mcp` to every mod over a single SSH tunnel |
| [desktop-control](desktop-control/) | 9000 | host-native | See the screen and open/close apps on the macOS host |
| [shell-sandbox](shell-sandbox/) | 9001 | container | Unrestricted shell over a bind-mounted host directory |

Each mod's own README covers its run, safety boundary, tools, and tests.

## Exposure

Every mod binds `127.0.0.1` only; reach it from the remote agent over an SSH reverse tunnel. The [router](router/) collapses all mods onto one tunnel (`8080`) so you don't forward a port per mod.
