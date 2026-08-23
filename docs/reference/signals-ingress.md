# Signals ingress

External producers send signal groups to the loopback HTTP ingress with `POST /signals`.
The request body always contains a `signals` array and may contain a delivery envelope:

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

Signal items are opaque JSON objects. The client transports and renders them without
interpreting their meaning.

## Envelope fields

| Field | Valid value |
|---|---|
| `source` | Non-empty string identifying the producer |
| `event_type` | Non-empty string identifying the producer-defined event type |
| `delivery` | Exactly `"immediate"` or `"batched"` |
| `event_id` | Non-empty opaque string; duplicate values remain separate groups |
| `occurred_at` | Finite epoch-millisecond number in the inclusive range `-8.64e15` through `8.64e15`, representable as an ISO-8601 date |

An absent envelope and an explicit `"envelope": null` are equivalent. Both requests
use legacy delivery and produce no envelope warning.

## Delivery

An `immediate` group fires at once while the user is present and the pipeline is idle.
Otherwise it waits in the away buffer. A legacy group follows the same behavior.

A `batched` group always waits in the batch buffer. The first group starts a five-minute
delivery interval. At the interval boundary, all pending batched groups fire together
when signals are enabled, the user is present, and the pipeline is idle. If those
conditions are not met, the groups remain buffered without another timer.

Returning to present or transitioning from busy to idle emits one catch-up containing
both away-buffered and batched groups in their original arrival order. Returning before
a batched group's deadline therefore includes it in that catch-up.

Each buffer retains at most five groups and drops its oldest group on overflow.

## Validation and legacy behavior

The HTTP ingress requires `POST /signals`, valid JSON, and a `signals` array. Invalid
requests receive HTTP 400. It forwards a present, non-null envelope without validating
or rewriting it and stamps the emitted batch with server time.

The signal source validates the envelope fields. An invalid envelope is discarded and
the group follows legacy delivery. Its signal items are still delivered, and one warning
is logged for the downgraded batch. There is no fallback timestamp and no event-id
deduplication.

A legacy request is:

```json
{
  "signals": [{ "source": "heartbeat", "healthy": true }]
}
```
