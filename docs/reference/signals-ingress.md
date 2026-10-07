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

## Envelope fields

| Field | Valid value |
|---|---|
| `source` | Non-empty string identifying the producer |
| `event_type` | Non-empty string identifying the producer-defined event type |
| `delivery` | Exactly `"immediate"` or `"batched"` |
| `event_id` | Non-empty opaque string; duplicate values remain separate groups |
| `occurred_at` | Finite epoch-millisecond number in the inclusive range `-8.64e15` through `8.64e15`, representable as an ISO-8601 date |

## Delivery

An `immediate` group fires at once while the user is present and the pipeline is idle.
Otherwise it waits in the away buffer.

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
group in arrival order, and a drain empties the away buffer and the batch buffer
together.

Each buffer retains at most five groups and drops its oldest group on overflow.

## Validation

The HTTP ingress requires `POST /signals`, valid JSON, a `signals` array, and a
non-null `envelope`. A request with another method on `/signals` receives HTTP 405.
Invalid JSON, a missing `signals` array, a missing `envelope`, or an explicit
`"envelope": null` receives HTTP 400. A request whose `envelope` is any other JSON
value receives HTTP 200.

HTTP 200 means that the ingress accepted the wire shape and attempted to emit the
batch to the client. It does not confirm receipt or delivery. A non-null envelope is
forwarded unchanged and stamped with server time.

While signals are enabled, a group whose envelope is not an object or fails the field
rules is dropped as a whole and one warning is logged with the item count. While
signals are disabled, the source drops incoming batches before envelope validation and
logs no envelope warning.

There is no fallback timestamp and no event-id deduplication.
