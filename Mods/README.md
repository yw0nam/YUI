# YUI Mods

Standalone MCP servers ("Mods") that expose host capabilities to the remote backend agent (Hermes). Each Mod is an independent process, decoupled from the YUI app — the agent attaches them as tool sources alongside the Expression Broker.

Mod convention: a Docker-based MCP server exposed on a port. Each containerized mod keeps its `Dockerfile` in its own `mcp_server/<mod>/` folder, and `docker-compose.yml` builds and deploys them together (`docker compose up -d --build`); the build context stays `Mods/` so they share `pyproject.toml`/`uv.lock`/the `mcp_server` package. `desktop_control` is the documented exception — it needs the host GUI, so it runs **host-native** (a container on macOS cannot reach the Mac WindowServer); the router likewise runs host-native as a thin proxy.

## Router

`router.py` is one HTTP front door that path-routes to every mod, so a single SSH reverse tunnel exposes them all instead of one port per mod. Each mod stays an independent process on its own port — the router only forwards bytes by URL prefix, so the upstream mod can be written in any language:

```
http://host:8080/<mod>/mcp  ->  127.0.0.1:<mod port>/mcp
```

```bash
uv run mods-router --host 127.0.0.1 --port 8080
```

Routing table is the `UPSTREAMS` dict in `router.py` — adding a mod is one line; the external port stays one. Currently registered: `desktop` → `127.0.0.1:9000`, `shell` → `127.0.0.1:9001`. The agent then adds each tool source at `http://localhost:8080/<mod>/mcp` (e.g. `/desktop/mcp`, `/shell/mcp`) from the remote's view. An unknown mod prefix returns 404; an unreachable mod returns 502.

MCP's Streamable HTTP transport is SSE, so the router streams responses through unbuffered — there is no body buffering to break long-lived event streams.

## desktop-control

Lets the agent see the screen and open/close apps on the local macOS host.

### Run

```bash
uv sync
DESKTOP_CONTROL_ALLOWED_APPS="Safari,Notes,Google Chrome" \
  uv run desktop-control-mcp --transport http --host 127.0.0.1 --port 9000
```

Only apps in `DESKTOP_CONTROL_ALLOWED_APPS` (comma-separated) can be opened or closed.

### macOS permissions (TCC)

Two separate permission buckets gate the tools — grant both to the **launching process** (the terminal that runs `uv run`, since TCC attributes grants to the responsible process, not to a stable desktop-control identity; re-grant if you launch it differently):

| Tool | Permission | System Settings → Privacy & Security → … |
|---|---|---|
| `screenshot` | Screen Recording | Screen Recording |
| `list_running_apps`, `close_app` | Automation (Apple Events to System Events) | Automation |
| `open_app` | none | — |

Without these, calls fail closed in different ways — `screenshot` silently returns wallpaper-only images, Automation calls error with `-1743`. The server runs a **startup preflight** that checks both and logs an explicit `[setup] … NOT granted` warning for each gap, so an ungranted permission surfaces as a clear setup error instead of a mystery no-op.

### Safety boundary (operator responsibility)

The allowlist **is** the safety boundary — there is no client-side config. desktop-control is a separate process with no capability in the YUI app, so the operator who sets the env owns the risk:

- Keep `DESKTOP_CONTROL_ALLOWED_APPS` as narrow as possible — only the apps you intend the agent to control. An empty allowlist rejects everything; there are no silent defaults.
- **The HTTP transport has no auth.** Any local process that can reach `127.0.0.1:9000` gets full screen capture + app control. This is acceptable for personal-desktop use and is mitigated by the SSH reverse-tunnel model below, but the local-process exposure is real — keep the bind on loopback.

### Expose to the remote agent

The server binds `127.0.0.1` only. Reach it from the remote host with an SSH reverse tunnel — either the mod port directly, or the [Router](#router) port to cover every mod with one tunnel:

```bash
ssh -R 9000:localhost:9000 ibricks43_external      # this mod only
ssh -R 8080:localhost:8080 ibricks43_external      # router: all mods, one port
```

The agent then adds the MCP tool source at `http://localhost:9000/mcp` directly, or `http://localhost:8080/desktop/mcp` through the router (from the remote's view).

### Tools

| Tool | Description |
|---|---|
| `screenshot` | Capture every display as PNG (one image per monitor), long edge downscaled to 1280px (`DESKTOP_CONTROL_SCREENSHOT_MAX_EDGE`, `0` disables) |
| `list_running_apps` | Names of visible (non-background) apps |
| `open_app(name)` | Launch + focus an allowlisted app |
| `close_app(name)` | Gracefully quit an allowlisted app |

### Test

```bash
uv run pytest
```

## shell-sandbox

An unrestricted shell exposed to the agent, running inside a container against a bind-mounted host directory. The agent can read, edit, build, install deps, and run tests in the mounted workspace. There is no command allowlist — `rm`, `pnpm`, `pip`, build steps all run. **The container is the boundary**; the operator picks what to mount.

### Run

```bash
SHELL_SANDBOX_MOUNT="$PWD" docker compose up -d --build shell-sandbox
```

The server binds `0.0.0.0:9001` *inside* the container; the compose `ports` entry publishes it to host loopback only (`127.0.0.1:9001`). `SHELL_SANDBOX_MOUNT` is the host dir mounted read-write at `/work` (defaults to a scratch `./work` so you don't expose originals by accident); `--cap-drop ALL` and `no-new-privileges` are set in `docker-compose.yml`.

Env (all optional): `SHELL_SANDBOX_WORKDIR` (default `/work`), `SHELL_SANDBOX_TIMEOUT` (seconds, default `300`), `SHELL_SANDBOX_MAX_OUTPUT` (chars per stream, default `100000`; output is tail-truncated past this).

### Safety boundary (operator responsibility)

The shell is unrestricted by design, so isolation comes entirely from the container and what you mount:

- **The mounted directory is the only host state reachable, and it is writable.** `rm -rf /work/*` deletes the host files there for real. Mount a copy or a dedicated scratch directory if you don't want the agent to mutate originals; everything outside the mount is unreachable.
- **The HTTP transport has no auth** (same as desktop-control). Keep the publish on `127.0.0.1` and reach it from the remote agent via SSH reverse tunnel — never publish to `0.0.0.0` on the host.
- **Network egress is open** (needed for `pnpm`/`pip` installs), so `--network=none` is not used. The container can reach the internet.
- The container runs as root with `--cap-drop ALL` and `no-new-privileges`. Standard `runc` shares the host kernel; for genuinely untrusted input, run under gVisor (`--runtime=runsc`) or a microVM (Kata) — that's the upgrade path, not the default.

### Expose to the remote agent

```bash
ssh -R 9001:localhost:9001 ibricks43_external      # this mod only
ssh -R 8080:localhost:8080 ibricks43_external      # router: all mods, one port
```

The agent adds the MCP tool source at `http://localhost:9001/mcp` directly, or `http://localhost:8080/shell/mcp` through the router (from the remote's view).

### Tools

| Tool | Description |
|---|---|
| `run(command)` | Run a shell command in the workspace; returns `exit_code`, `stdout`, `stderr`, `truncated`, `timed_out` |

### Test

```bash
uv run pytest test/features/test_shell_sandbox.py
```
