# Witness Log

A local, transition-only record of which app the user has in front and when the machine goes idle. Written by the Rust OS event watcher (`src-tauri/src/witness.rs`) on its 5-second poll.

## Location

`<app_data_dir>/witness/activity_YYYY-MM-DD.jsonl` — macOS `~/Library/Application Support/com.yui.desktop/witness/`.

One file per calendar day in the `YUI_LOG_TZ` timezone. Files are retained 14 days; older dated files are pruned on rotation.

## Format

JSONL: one JSON object per line.

```json
{"ts":"2026-08-12T14:30:05+09:00","type":"app_change","app":"Safari","window_title":"Start Page"}
```

| Field | Value |
|---|---|
| `ts` | ISO 8601 local time with offset |
| `type` | `app_change` · `idle_start` · `idle_end` |
| `app` | Owner app of the frontmost window, or `null` |
| `window_title` | Title of the frontmost window, or `null` — capped at 256 characters |

Only transitions are written; a stable foreground app writes nothing.

| Record | Written when |
|---|---|
| `app_change` | The frontmost app or its window title differs from the previous poll |
| `idle_start` | OS idle time reaches 5 minutes |
| `idle_end` | Input returns after an `idle_start` |

Idle records carry the frontmost app and title read at the moment of the transition. An unreadable idle time carries the previous idle state forward, so it produces no record.

## Platform notes

The two platforms answer slightly different questions: macOS reports what sits in front, Windows reports what holds focus.

| Platform | Frontmost source | Meaning |
|---|---|---|
| macOS | Topmost on-screen layer-0 window, excluding YUI's own process and system-helper owners (Stage Manager, Dock, Control Center, Notification Center, Spotlight, Screenshot) | Topmost non-YUI, non-helper window |
| Windows | `GetForegroundWindow()`; `app` is the owning process base name, without directory or `.exe` | Focused window, excluding YUI itself and shell chrome (desktop, taskbars) |
| other | — | No records |

macOS window titles require the Screen Recording permission. Without it, `window_title` is `null` and records carry the app alone.

## Privacy

Window titles can contain sensitive text — document names, page titles, chat partners. The log stays on the local machine, is written by the client only, and expires with the 14-day retention. `witness/` is git-ignored so the records can never be committed.
