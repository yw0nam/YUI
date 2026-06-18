# YUI Mods

Standalone MCP servers ("Mods") that expose host capabilities to the remote backend agent (Hermes). Each Mod is an independent process, decoupled from the YUI app — the agent attaches them as tool sources alongside the Expression Broker.

Mod convention: a Docker-based MCP server exposed on a port. `desktop_control` is the documented exception — it needs the host GUI, so it runs **host-native** (a container on macOS cannot reach the Mac WindowServer).

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

### Expose to the remote agent

The server binds `127.0.0.1` only. Reach it from the remote host with an SSH reverse tunnel:

```bash
ssh -R 9000:localhost:9000 ibricks43_external
```

The agent then adds the MCP tool source at `http://localhost:9000/mcp` (from the remote's view).

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
