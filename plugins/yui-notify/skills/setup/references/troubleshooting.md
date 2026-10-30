# Troubleshooting

`probe` and `test` exit 0 on success and 1 on failure. `hook` always exits 0 and records
failed requests in `last-error.json`. Startup warnings prefix the probe failure with `yui-notify: `.

## Read the line

The probe GETs `/threads/yui-notify-probe/answer?ask_id=probe&wait=0`.
HTTP 404 means the unknown probe Thread reached the Threads route, so the probe succeeds.
HTTP 400 means YUI needs updating. A successful probe creates no Thread or signal.

| Line | Cause and action |
|---|---|
| `YUI is not listening at <url> (External signals off, wrong port, or no tunnel)` | Enable External signals, check the listener port, restart YUI, or repair the tunnel using `remote.md`. |
| `update YUI: Threads are not supported at <url>` | Update YUI to a version with Threads. |
| `unknown or invalid thread id: <url>` | The Thread id is unknown or invalid. Check the request path. The probe expects an unknown Thread and treats 404 as success. |
| `YUI is busy: every answer wait is in use: <url>` | All answer workers are occupied. Try again after a wait ends. |
| `invalid endpoint: use http://127.0.0.1:<port> with no path: <url>` | Remove every path component from the listener endpoint. |
| `unexpected HTTP 400 from <url>` | A test PUT was refused. Report the payload failure. |
| `unexpected HTTP 421 from <url>` or `unexpected HTTP 403 from <url>` | Use a loopback endpoint on the YUI machine, or a reverse tunnel to it. |
| `unexpected HTTP <n> from <url>` | Read the YUI log and report the status. |

## Codex falls back

Codex permissions in the frontmost host app post no ask and return immediately to the
terminal. Otherwise the hook waits up to `wait.permission`; Stop waits up to `wait.stop`.
Release, closed asks, errors, and deadlines return control to Codex without a decision.
Timeout and error close the ask with a final PUT.

## Read `last-error.json`

Failed hook requests write `$XDG_STATE_HOME/yui-notify/last-error.json`, defaulting to
`~/.local/state/yui-notify/last-error.json`.

```json
{ "time": "2026-10-23T10:00:00+00:00", "url": "http://127.0.0.1:8770/threads/codex:host:session", "status": null, "error": "Connection refused" }
```

`time` is UTC, `url` is the failing request, `status` is the HTTP code or null, and `error`
is the transport or HTTP error. Probe, test, and startup checks do not write this file.
A stale record is the last hook failure; delete it after fixing the cause.
