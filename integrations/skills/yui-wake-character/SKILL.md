---
name: yui-wake-character
description: "Send a signal to one YUI character so that character speaks about an event: a finished workflow, a completed job, a message that arrived, a coding-agent hook. Use this whenever a backend agent, a scheduler, a webhook or a shell script must wake a specific YUI character (one preset) instead of the default one, or when a user asks why a signal woke the wrong character or no character at all. The envelope and the port do not change between characters; only the URL path does."
license: PolyForm-Noncommercial-1.0.0
---

# yui-wake-character

YUI shows one character per preset. The desktop can hold several pet windows at once,
each bound to a preset. All of them share one loopback ingress on one port. The URL path
chooses the character: `POST /signals` wakes the character of the main window, and
`POST /presets/<id>/signals` wakes the character bound to preset `<id>`. The request body
is the same signal envelope in both cases; read `docs/reference/signals-ingress.md` in the
YUI repository for its fields and the delivery rules.

The ingress listens only while the user has turned on **Agent notifications** in YUI's
Proactive tab, on the port shown there (default 8770), and a change of that switch or
port takes effect after YUI restarts.

## Wake a character

### 1. Obtain the character's URL

Ask the user to copy it from YUI: Settings → preset list (the ⋯ button beside the preset
name) → the copy button on the character's row. The URL has the form
`http://127.0.0.1:<port>/presets/<id>/signals`. The default character's URL is
`http://127.0.0.1:<port>/signals`. Store the URL in the producer's configuration
(for example `YUI_SIGNALS_URL`); never derive `<id>` from the preset's name, because the
id is an opaque key and the name can change.

Done when: the producer holds one complete URL that starts with `http://127.0.0.1:`.

### 2. Send the envelope

POST a JSON body with a `signals` array and an `envelope` object to the URL, with
`Content-Type: application/json`:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type: application/json' \
  -d '{"signals":[{"kind":"workflow","status":"complete"}],
       "envelope":{"source":"my-producer","event_type":"workflow_done",
                   "delivery":"immediate","event_id":"run-1","occurred_at":1787449000000}}' \
  "$YUI_SIGNALS_URL"
```

Pick `delivery` by how soon the character should speak: `immediate` speaks now if the
user is present, `batched` waits for the next five-minute batch, `live` follows the user's
presence. The character decides what to say; the signal carries facts, not a script.

Done when: the response code is read.

### 3. Read the response code

| Code | Meaning | What to do |
|---|---|---|
| 200 | Accepted for the character | Nothing. The character speaks under the delivery rules. |
| 404 | No preset has this id, or the path is wrong | Ask the user for the URL again (step 1). |
| 503 | The preset exists but its window is closed | Ask the user to open the character's window (preset list → "Open window"), then send again. |
| 400 | The body is not a valid envelope | Fix the body against the envelope table in `signals-ingress.md`. |
| 405 | Wrong method | Use POST. |
| 421 or 403 | The request did not come from this machine | Send from the same machine as YUI, or through an SSH tunnel to 127.0.0.1. |
| connection refused | The ingress is off or YUI is not running | Ask the user to turn on Agent notifications and restart YUI. |

Done when: the code is 200, or the user has been told the one action that the table names.

## Check a producer that already exists

1. Read its configured URL. A URL without `/presets/<id>/` wakes the main window's
   character; that is correct only when the user wants the default character.
2. Send one `immediate` signal with `event_id` set to a fresh value and read the code
   with the table above.
3. If the wrong character spoke, the URL points at another preset: repeat step 1 of
   "Wake a character".

## Reference

- Route table, envelope fields, delivery and buffering rules: `docs/reference/signals-ingress.md`.
- Coding-agent lifecycle hooks (`/agent-event`, same prefix rule): `docs/agent-guide/agent-completion-hooks.md`.
- The avatar routes `/presets/<id>/avatar/state`, `/presets/<id>/avatar/perch-targets`,
  `/presets/<id>/avatar/command` follow the same prefix rule and move that character's body.
