# Send signals from a producer

A producer is a program on the user's machine that posts to YUI's loopback ingress: an n8n
workflow, a cron job, a CI step, or a coding-agent hook. One POST carries a `signals` array
of opaque JSON items and an `envelope` of facts about them. The character decides what to
say about the signal, and the signal carries facts rather than a script.

The ingress listens on `http://127.0.0.1:8770` while **External signals** is on in
Settings → Proactive → Watchers, and a change of that switch or port takes effect on the
next launch. `POST /signals` wakes the main window's character;
`POST /presets/<id>/signals` wakes the character bound to preset `<id>`.

## Choose a tier

No tier decides the words. The tier decides when the character hears about the signal.

| Tier | Use it when | Example |
|---|---|---|
| `urgent` | The user should hear it now | An agent is waiting for their input |
| `batched` | It can wait for the next batch | A long job finished |
| drop | The user does not need it | A retry that succeeded on its own |

Drop a signal by not sending it. The client has no drop tier.

## Write a label

`label` is one optional line that says where the signal came from, in at most 120
characters: `dev43 · tmux yui:2 · YUI (main)`. A longer label is cut to 119 characters
plus `…` and the request still succeeds. A label that is present and not a string makes
the whole envelope invalid, so the group is dropped.

## Choose an event_id

`event_id` names the thing the signal is about. Keep it stable for "the same thing": a
later group with an id that is still buffered replaces the earlier one in place, so a
producer that has an update sends it under the same id instead of a second group. A
`<session_id>:<phase>` pair works for a coding-agent hook, and a run id works for a
workflow.

## Limits

- The request body holds at most 64 KiB.
- One signal item serializes to at most 16 KiB. A request with a larger item receives
  HTTP 400, and none of its items are delivered.
- Each buffer keeps five groups and drops the oldest on overflow.

## Examples

An urgent signal to the main window:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  -H 'Content-Type: application/json' \
  -d '{"signals":[{"kind":"agent","status":"needs_input"}],
       "envelope":{"source":"claude-code","event_type":"agent.needs_input",
                   "delivery":"urgent","event_id":"9f1c:needs_input",
                   "label":"dev43 · tmux yui:2 · YUI (main)",
                   "occurred_at":1787449000000}}' \
  http://127.0.0.1:8770/signals
```

A batched signal to the main window:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  -H 'Content-Type: application/json' \
  -d '{"signals":[{"kind":"workflow","status":"complete"}],
       "envelope":{"source":"n8n","event_type":"workflow_done",
                   "delivery":"batched","event_id":"run-8812",
                   "label":"build box · deploy",
                   "occurred_at":1787449000000}}' \
  http://127.0.0.1:8770/signals
```

The same signal to one preset's character, where `<id>` is the id copied from that
character's row in the preset list:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  -H 'Content-Type: application/json' \
  -d '{"signals":[{"kind":"workflow","status":"complete"}],
       "envelope":{"source":"n8n","event_type":"workflow_done",
                   "delivery":"batched","event_id":"run-8812",
                   "occurred_at":1787449000000}}' \
  http://127.0.0.1:8770/presets/<id>/signals
```

A `200` means the ingress accepted the body and passed it to the target window. Every
other code, the envelope fields, and the delivery rules are in the
[signals ingress reference](../reference/signals-ingress.md).
