# desktop-control

Lets the agent see the screen and open/close apps on the local macOS host. Runs **host-native** — it needs the host GUI, and a container on macOS cannot reach the Mac WindowServer.

## Run

```bash
cd Mods/desktop-control && uv sync
DESKTOP_CONTROL_ALLOWED_APPS="Safari,Notes,Google Chrome" \
  uv run desktop-control-mcp --transport http --host 127.0.0.1 --port 9000
```

Only apps in `DESKTOP_CONTROL_ALLOWED_APPS` (comma-separated) can be opened or closed.

## macOS permissions (TCC)

Two separate permission buckets gate the tools — grant both to the **launching process** (the terminal that runs `uv run`, since TCC attributes grants to the responsible process, not to a stable desktop-control identity; re-grant if you launch it differently):

| Tool | Permission | System Settings → Privacy & Security → … |
|---|---|---|
| `screenshot` | Screen Recording | Screen Recording |
| `list_running_apps`, `close_app` | Automation (Apple Events to System Events) | Automation |
| `open_app` | none | — |

Without these, calls fail closed in different ways — `screenshot` silently returns wallpaper-only images, Automation calls error with `-1743`. The server runs a **startup preflight** that checks both and logs an explicit `[setup] … NOT granted` warning for each gap, so an ungranted permission surfaces as a clear setup error instead of a mystery no-op.

## Safety boundary (operator responsibility)

The allowlist **is** the safety boundary — there is no client-side config. desktop-control is a separate process with no capability in the YUI app, so the operator who sets the env owns the risk:

- Keep `DESKTOP_CONTROL_ALLOWED_APPS` as narrow as possible — only the apps you intend the agent to control. An empty allowlist rejects everything; there are no silent defaults.
- **The HTTP transport has no auth.** Any local process that can reach `127.0.0.1:9000` gets full screen capture + app control. This is acceptable for personal-desktop use and is mitigated by the SSH reverse-tunnel model below, but the local-process exposure is real — keep the bind on loopback.

## Expose to the remote agent

The server binds `127.0.0.1` only. Reach it from the remote host with an SSH reverse tunnel — either the mod port directly, or the router port to cover every mod with one tunnel:

```bash
ssh -R 9000:localhost:9000 <remote-host>      # this mod only
ssh -R 8080:localhost:8080 <remote-host>      # router: all mods, one port
```

The agent then adds the MCP tool source at `http://localhost:9000/mcp` directly, or `http://localhost:8080/desktop/mcp` through the router (from the remote's view).

## Tools

| Tool | Description |
|---|---|
| `screenshot` | Capture every display as PNG (one image per monitor), long edge downscaled to 1280px (`DESKTOP_CONTROL_SCREENSHOT_MAX_EDGE`, `0` disables) |
| `list_running_apps` | Names of visible (non-background) apps |
| `open_app(name)` | Launch + focus an allowlisted app |
| `close_app(name)` | Gracefully quit an allowlisted app |

## Test

```bash
cd Mods/desktop-control && uv run pytest
```
