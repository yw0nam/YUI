# desktop-control

Lets the agent see the screen, read the day's activity log, and open/close apps on the local macOS host. Runs **host-native** — it needs the host GUI, and a container on macOS cannot reach the Mac WindowServer.

## Run

```bash
cd Mods/desktop-control && uv sync
DESKTOP_CONTROL_ALLOWED_APPS="Safari,Notes,Google Chrome" \
  uv run desktop-control-mcp --transport http --host 127.0.0.1 --port 9000
```

Only apps in `DESKTOP_CONTROL_ALLOWED_APPS` (comma-separated) can be opened or closed.

`WITNESS_LOG_DIR` points `get_activity_timeline` at the witness log directory; unset, it reads `~/Library/Application Support/com.yui.desktop/witness` — where the YUI app writes it.

## macOS permissions (TCC)

Grant these to the **launching process** (the terminal that runs `uv run`, since TCC attributes grants to the responsible process, not to a stable desktop-control identity; re-grant if you launch it differently):

| Tool | Permission | System Settings → Privacy & Security → … |
|---|---|---|
| `screenshot` | Screen Recording | Screen Recording |
| `get_frontmost_window` | Screen Recording for `title` only; the `app` name needs nothing | Screen Recording |
| `list_running_apps` | Automation — Apple Events to **System Events** | Automation |
| `close_app` | Automation — Apple Events to **the target app**, granted per app | Automation |
| `open_app` | none | — |
| `get_activity_timeline` | none — it reads a local file, not the GUI | — |

`close_app` is the one to watch. It runs `quit app "<name>"`, which sends its Apple Event to the named application rather than to System Events, and macOS grants Automation per target pair — so each allowlisted app raises its own prompt the first time you quit it, and a green System Events grant says nothing about whether that app can be quit.

Without these, calls fail closed in different ways — `screenshot` silently returns wallpaper-only images, `get_frontmost_window` reports a null `title`, Automation calls error with `-1743`. The server runs a **startup preflight** covering Screen Recording and System Events, logging an explicit `[setup] … NOT granted` warning for each gap, so an ungranted permission surfaces as a clear setup error instead of a mystery no-op. The preflight deliberately does not probe the per-app `close_app` grants: probing prompts, and prompting for every allowlisted app at startup is worse than letting the first quit ask.

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
| `get_frontmost_window` | `{ app, title }` for the frontmost app — `title` is `null` when it has no front window or Screen Recording is ungranted |
| `get_activity_timeline(date)` | One day of activity from the witness log as ordered segments — `{ date, segments }`, empty when the day has no log |
| `open_app(name)` | Launch + focus an allowlisted app |
| `close_app(name)` | Gracefully quit an allowlisted app |

## Activity timeline

`get_activity_timeline(date)` reads the day's witness log (`docs/reference/witness-log.md`) and returns the transitions as the intervals they imply:

```json
{"date": "2026-08-12", "segments": [
  {"start": "2026-08-12T09:00:00+09:00", "end": "2026-08-12T09:30:00+09:00",
   "type": "app", "app": "Safari", "window_title": "Start Page", "duration_min": 30.0},
  {"start": "2026-08-12T09:30:00+09:00", "end": "2026-08-12T10:00:00+09:00",
   "type": "idle", "duration_min": 30.0}
]}
```

Consecutive records for one app are a single segment, and a title change within it only updates the title. The client keeps reporting the frontmost app while the user is away, so an app change recorded during an idle stretch is background churn and leaves the idle running. A day whose log opens with `idle_end` was idle across the midnight rotation, so that idle counts from 00:00 — an app is never back-filled that way, since a quiet stretch before the first record may equally be a machine that was off. The segment the last record opens ends at that record's timestamp, because nothing after it was observed, and so reads as zero minutes. Corrupt lines are skipped, and a missing, unreadable, or expired day file is an empty timeline. The merge is the only processing — no summarizing, no filtering.

The log carries window titles, so this tool hands the agent a record of what the user was reading and writing all day. It is the same exposure as `screenshot`, spread over a day.

## Test

```bash
cd Mods/desktop-control && uv run pytest
```
