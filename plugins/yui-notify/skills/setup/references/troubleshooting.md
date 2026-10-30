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

## The test Thread gets no answer

`no answer within 60 s` after `sent: HTTP 200` means YUI stored the Thread but no answer came
back. The Threads chip shows only while a Thread waits; answer before the 60 seconds end, then
run `test` again. A line printed at once means the answer poll failed, for example because a
second `test` on the same host replaced the ask: read `last-error.json` below.

## Codex falls back

Codex permissions in the frontmost host app post no ask and return immediately to the
terminal. Otherwise the hook waits up to `wait.permission`; Stop waits up to `wait.stop`.
Release, closed asks, errors, and deadlines return control to Codex without a decision.
Timeout and error close the ask with a final PUT.

## Claude Code inbox

A Claude Code Stop posts “What next?” only when Claude Code exports
`CLAUDE_CODE_MESSAGING_SOCKET` to its hooks, and a background `yui-notify inbox` poller
carries the answer into that socket.

| Sign | Cause and action |
|---|---|
| The Thread shows the reply as `completed` with no ask | Claude Code is older than v2.1.224, or runs in bare mode, so it exports no inbox socket. Update Claude Code. `/status` shows the socket in its `Peer address` row. |
| The answer reached YUI but nothing arrived in the session | Claude Code dropped or held the message. `crossSessionInbound: refuse` drops it; a session that bypasses permission prompts may hold it for approval. Read `last-error.json` for a failed post. |
| A Stop posts no ask | Stop sends nothing while a background task runs or for an SDK launch (the plugin README § Suppressions). Send a prompt that ends with no background task. |

## Read `last-error.json`

Failed hook requests write `$XDG_STATE_HOME/yui-notify/last-error.json`, defaulting to
`~/.local/state/yui-notify/last-error.json`.

```json
{ "time": "2026-10-23T10:00:00+00:00", "url": "http://127.0.0.1:8770/threads/codex:host:session", "status": null, "error": "Connection refused" }
```

`time` is UTC, `url` is the failing request, `status` is the HTTP code or null, and `error`
is the transport or HTTP error. Probe and startup checks do not write this file; `test` writes it only when its answer poll fails.
A stale record is the last hook failure; delete it after fixing the cause.
