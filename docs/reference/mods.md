# Mods

Standalone MCP servers ("Mods") that expose host capabilities to the remote backend agent (Hermes). Each Mod is an independent process, decoupled from the YUI app — the agent attaches them as tool sources alongside the Expression Broker. They live under [`Mods/`](https://github.com/yw0nam/YUI/tree/main/Mods) in the repository root. Mods are optional: YUI runs without any of them.

## Convention

Each mod is a **self-contained `uv` project** in `Mods/<mod>/` with its own `pyproject.toml`, `uv.lock`, and dependency set — no shared lock, so one mod's deps never leak into another. Containerized mods carry a `Dockerfile` whose build context is that same folder; `Mods/docker-compose.yml` builds and deploys them together. Python lint is **ruff** (`line-length = 110`). Run a mod's tests with `cd Mods/<mod> && uv run pytest`.

## Catalog

| Mod | Port | Runs | What |
|---|---|---|---|
| [router](https://github.com/yw0nam/YUI/blob/main/Mods/router/README.md) | 8080 | host-native | One HTTP front door — path-routes `/<mod>/mcp` to every mod over a single SSH tunnel |
| [desktop-control](https://github.com/yw0nam/YUI/blob/main/Mods/desktop-control/README.md) | 9000 | host-native | See the screen and open/close apps on the macOS host |
| [shell-sandbox](https://github.com/yw0nam/YUI/blob/main/Mods/shell-sandbox/README.md) | 9001 | container | Unrestricted shell over a bind-mounted host directory |

Not a mod, but lives here: [browser-cdp](https://github.com/yw0nam/YUI/blob/main/Mods/browser-cdp/README.md) exposes no MCP tools — it bridges the remote agent's own Playwright MCP to your local Mac browser over CDP.

## Exposure

Every mod binds `127.0.0.1` only — there is no transport auth, so any local process that can reach the port gets the mod's full capability. Reach a mod from the remote agent over an SSH reverse tunnel, never by binding `0.0.0.0`. The [router](#router) collapses all mods onto one tunnel (`8080`), so you forward one port instead of one per mod:

```bash
ssh -R 8080:localhost:8080 <remote-host>      # all mods, via the router
ssh -R 9000:localhost:9000 <remote-host>      # one mod directly
```

The agent then adds the MCP tool source — `http://localhost:8080/<mod>/mcp` through the router, or `http://localhost:<port>/mcp` directly (from the remote's view).

## router

One HTTP front door that path-routes to every mod, so a single SSH reverse tunnel exposes them all:

```
http://host:8080/<mod>/mcp  ->  127.0.0.1:<mod port>/mcp
```

It runs host-native as a thin proxy — MCP's Streamable HTTP transport is SSE, so responses stream through unbuffered. The routing table is the `UPSTREAMS` dict in `router/server.py`. An unregistered prefix returns **404**; a registered-but-unreachable mod returns **502**. `GET /_mods` lists the registered mods so a client can discover them without reading the code.

## desktop-control

Lets the agent see the screen and open/close apps on the macOS host. Runs **host-native** — it needs the host GUI, which a container on macOS cannot reach.

| Tool | Description |
|---|---|
| `screenshot` | Capture every display as PNG (one image per monitor), long edge downscaled to 1280px |
| `list_running_apps` | Names of visible (non-background) apps |
| `open_app(name)` | Launch + focus an allowlisted app |
| `close_app(name)` | Gracefully quit an allowlisted app |

The `DESKTOP_CONTROL_ALLOWED_APPS` allowlist **is** the safety boundary — only listed apps can be opened or closed, and an empty allowlist rejects everything. Two macOS TCC grants gate the tools, attributed to the launching process: **Screen Recording** for `screenshot`, and **Automation** (Apple Events to System Events) for `list_running_apps` / `close_app`. A startup preflight logs an explicit `[setup] … NOT granted` warning for each gap.

## shell-sandbox

An unrestricted shell exposed to the agent, running inside a container against a bind-mounted host directory. There is no command allowlist — `rm`, `pnpm`, `pip`, and build steps all run. **The container is the boundary**, and the operator picks what to mount.

| Tool | Description |
|---|---|
| `run(command)` | Run a shell command in the workspace; returns `exit_code`, `stdout`, `stderr`, `truncated`, `timed_out` |
| `read_file(path, offset?, limit?)` | Read a UTF-8 text file as a line window |
| `write_file(path, content)` | Create or overwrite a text file (parent dirs created) |
| `edit_file(path, old, new, replace_all?)` | Exact-replace `old`→`new`; unique match required unless `replace_all` |
| `read_image(path)` | Read an image (png/jpg/jpeg/gif/webp) and return it as a viewable image |

The mounted directory is the only reachable host state, and it is **writable** — mount a copy or a scratch directory if you don't want the agent to mutate originals. Network egress is open (needed for `pnpm`/`pip` installs). The container runs as root with `--cap-drop ALL` and `no-new-privileges`; for genuinely untrusted input, run under gVisor or a microVM.

## browser-cdp

**Not an MCP mod — it exposes no tools.** The agent already ships Playwright MCP, so the browser tools exist on its side; what is missing is the *browser to drive*. browser-cdp provides it by exposing a Chrome DevTools Protocol (CDP) endpoint that the agent's Playwright connects to, driving your local Mac browser with its logged-in sessions.

Launch the local Chrome with a CDP endpoint (`launch-chrome-cdp.sh`, a dedicated persistent profile), tunnel the CDP port, and point the agent's Playwright MCP at it:

```bash
./launch-chrome-cdp.sh                         # local Chrome on 127.0.0.1:9222
ssh -R 9222:localhost:9222 <remote-host>       # CDP is not MCP — separate from the router's 8080
npx @playwright/mcp@latest --cdp-endpoint http://localhost:9222
```

The attachment is configuration, not a chat message: set `--cdp-endpoint` (or `cdpEndpoint` in the agent's `mcp.json`) and restart the agent's Playwright MCP. CDP is full, unauthenticated control of that browser — keep it on `127.0.0.1` and reach it only through the SSH tunnel.
