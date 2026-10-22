# Signals ingress

External producers send signal groups to the loopback HTTP ingress with `POST /signals`.
The ingress refuses a request whose `Host` is not `127.0.0.1`, `localhost` or `::1` with 421 and a request whose `Origin` names another host with 403.
The request body contains a `signals` array and a delivery envelope:

```json
{
  "signals": [{ "kind": "workflow", "status": "complete" }],
  "envelope": {
    "source": "n8n",
    "event_type": "workflow_done",
    "delivery": "batched",
    "event_id": "run-8812",
    "occurred_at": 1787449000000
  }
}
```

Signal items are arbitrary opaque JSON values. The client transports and renders them without
interpreting their meaning.

## Routes

One listener on one port serves every window. The path chooses the recipient.

| Path | Recipient |
|---|---|
| `/signals`, `/agent-event` | `main`: the main window's character, whichever preset is active |
| `/avatar/state`, `/avatar/perch-targets`, `/avatar/command`, `/relations` | `main` |
| `/presets/<id>/signals`, `/presets/<id>/agent-event` | `pet-<id>`: the pet window bound to preset `<id>`, and no other window |
| `/presets/<id>/avatar/state`, `/presets/<id>/avatar/perch-targets`, `/presets/<id>/avatar/command`, `/presets/<id>/relations` | `pet-<id>`; that window answers the request |
| any other path under `/presets/`, including a route name outside the six above | none: HTTP 404 |
| a preset id that exists while its pet window is closed | none: HTTP 503 |

`<id>` is one path segment of ASCII letters, digits, `_` and `-`. The prefix itself, an id
with no route after it, an empty id, and an id with any other byte all receive 404.

The listener is loopback-only and carries no authentication, so a local caller can tell which
preset ids exist by the 404 and 503 replies. The ids are opaque keys, not secrets.

## Envelope fields

| Field | Valid value |
|---|---|
| `source` | Non-empty string identifying the producer |
| `event_type` | Non-empty string identifying the producer-defined event type |
| `delivery` | Exactly `"immediate"`, `"batched"`, or `"live"` |
| `event_id` | Non-empty opaque string; duplicate values remain separate groups |
| `occurred_at` | Finite epoch-millisecond number in the inclusive range `-8.64e15` through `8.64e15`, representable as an ISO-8601 date |

## Delivery

An `immediate` group fires at once while the user is present and the pipeline is idle.
Otherwise it waits in the away buffer.

A `live` group marks an activity the user started and is waiting on. It fires at once while
the user is present and the pipeline is idle, and the proactive quiet gap does not hold it.
Otherwise it waits in its own buffer; on the busy-to-idle or away-to-present edge, the
buffered live groups fire together as one live catch-up turn. Live groups never share a
catch-up turn with `immediate` or `batched` groups, and the drains below carry non-live
groups only — a buffered live group keeps waiting for its own edge. User-started activities
use `live`; unrequested background chatter uses `immediate` or `batched`.

A `batched` group always waits in the batch buffer. The first group starts a five-minute
delivery interval. At the interval boundary, all pending batched groups fire together
when signals are enabled, the user is present, and the pipeline is idle. If those
conditions are not met, the groups remain buffered without another timer.

While signals are disabled, the client drops every group that arrives, and the next
OS idle tick clears the groups already buffered.

Returning to present or transitioning from busy to idle emits one catch-up containing
both away-buffered and batched groups in their original arrival order. Returning before
a batched group's deadline therefore includes it in that catch-up.

Three client-fired turns also drain the buffers and carry the groups themselves: a
`proactive.tap_bored` turn, the `time_milestone.first_activity` turn, and a
`proactive.wake` turn that carries the day's first activity. Each takes every pending
non-live group in arrival order, and a drain empties the away buffer and the batch buffer
together.

Each buffer retains at most five groups and drops its oldest group on overflow.

Live turns are capped by their own hourly rate limit, `rate_limit.live_max` (default 120).
They do not count toward the tier-2 or overall caps, and the cooldown the overall cap
starts does not hold them.

## Relations

`GET /relations` and `GET /presets/<id>/relations` return the character's relation store,
the relation the backend has rated toward the user and toward each other preset
(`docs/reference/client-tools.md` § `rate_relation`). `PUT` on the same path replaces the
whole store; an external engine that keeps its own relationship record writes it here.

```json
{
  "user": { "value": 5, "updated_at": 1787449000000,
            "log": [{ "at": 1787449000000, "delta": 2, "why": "asked how my day was before the bug" }] },
  "aaaa0001": { "value": -6, "updated_at": 1787430000000, "log": [],
                "note": "trusts the work, doubts the promises" }
}
```

One key per target: `user`, or another preset's id. `value` is an integer from -20 to 20,
`updated_at` the epoch milliseconds of the last change, `log` the last changes newest first,
at most 20, each `{at, delta, why}` with `delta` an integer from -2 to 2 other than 0 and `why` a
string of at most 80 characters. An optional `note` of at most 200 characters holds an external
engine's own summary of the relation; the client never writes it and renders it on the `relation:`
line after the band. A `PUT` body that is not an object, has a key that is neither `user`
nor an existing preset id, or breaks any range receives HTTP 400 and leaves the store
unchanged; a valid body answers 200 with the stored body. A key for the window's own
preset id is accepted, stored, and never rendered. Any other method receives 405. The window
renders the new relation on its next turn and in its preset row at once. The daily cap
applies to the tool only; a `PUT` sets what it says.

## Preset switch

The bare routes belong to `main`. A group that arrives on `/signals` after the user
switches presets becomes a turn of the newly active preset's backend, whichever backend the
producer had in mind. A route under `/presets/<id>/` belongs to that preset's window: its
group becomes a turn of that preset's backend, which stays bound to `<id>` across a switch of
the active preset.

Each pet window holds its own buffers, so a switch, which reloads `main`, drops every group
still buffered there and leaves a bound window's buffers untouched.

## Validation

The HTTP ingress requires `POST /signals`, valid JSON, a `signals` array, and a
non-null `envelope`. A request with another method on `/signals` or
`/presets/<id>/signals` receives HTTP 405.
Invalid JSON, a missing `signals` array, a missing `envelope`, or an explicit
`"envelope": null` receives HTTP 400. A request whose `envelope` is any other JSON
value receives HTTP 200. A request under `/presets/` whose id no preset has, or whose path
after the id is none of the six routes, receives HTTP 404. A request for a preset id that
exists while its pet window is not open receives HTTP 503; it is never passed to `main`.

HTTP 200 means that the ingress accepted the wire shape and attempted to emit the
batch to its target window. It does not confirm receipt or delivery. A non-null envelope is
forwarded unchanged and stamped with server time.

While signals are enabled, a group whose envelope is not an object or fails the field
rules is dropped as a whole and one warning is logged with the item count. While
signals are disabled, the source drops incoming batches before envelope validation and
logs no envelope warning.

There is no fallback timestamp and no event-id deduplication.
