# Troubleshooting

`probe` and `test` print one line and exit 0 on success or 1 on failure. `hook` prints
nothing; it always exits 0 and records a failed POST in `last-error.json`.

## Read the line

`probe` posts an envelope that is not an object. A live target answers 200 and drops it, and YUI's
log shows one dropped-envelope warning for each probe. That warning is expected.

| Line | Cause | What to do |
|---|---|---|
| `YUI is not listening at <url> (External signals off, wrong port, or no tunnel)` | Nothing answers on that port: External signals is off, YUI uses another port, or an SSH tunnel is missing | Turn on Settings → Proactive → Watchers → External signals. Read the port in the same section and use it in the endpoint. Restart YUI after changing the switch or the port. On a remote host, follow `remote.md`. |
| `no such preset: <url>` | The preset id does not exist, or the path is wrong | Copy the character's URL from the preset list again and use the whole URL, without the trailing `/signals`. |
| `the preset's pet window is closed: <url>` | The preset exists and its window is not open | Open that character's window from the preset list, then run the command again. |
| `unexpected HTTP 400 from <url>` | The ingress refused the body: a signal item over 16 KiB or a malformed body | Report a bug in yui-notify; the script builds this body. |
| `unexpected HTTP 421 from <url>` or `unexpected HTTP 403 from <url>` | The request did not come from this machine, or its `Host` or `Origin` names another host | Use a `127.0.0.1` endpoint from the machine that runs YUI, or a tunnel to it. |
| `unexpected HTTP <n> from <url>` with any other number | The listener answered something the setup does not expect | Read YUI's log for the request, then report the number. |

## Read `last-error.json`

A failed `hook` POST writes `$XDG_STATE_HOME/yui-notify/last-error.json` (`~/.local/state`
when `XDG_STATE_HOME` is unset):

```json
{ "time": "2026-10-23T10:00:00+00:00", "url": "http://127.0.0.1:8770/signals", "status": null, "error": "Connection refused" }
```

| Field | Meaning |
|---|---|
| `time` | When the hook tried to post, in UTC |
| `url` | The full URL the hook posted to |
| `status` | The HTTP status, or `null` when no response came |
| `error` | The transport or HTTP error, or `null` |

`test` and `probe` do not write this file. A stale record is the last failure of a hook;
delete it after the cause is fixed.
