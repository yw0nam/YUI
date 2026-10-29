# Threads

A Thread is an outside conversation a producer posts for the user to read and answer. It has an id, source, state, entries, and at most one open Ask. Threads are app-wide and do not fire character turns. Producers connect to YUI; YUI never connects to a producer.

## Listener and paths

Threads use the existing loopback ingress and its External signals switch, with no additional port. Host and Origin checks run first: an invalid Host receives 421, and a foreign Origin receives 403. The store lives for the whole app; routes exist while the listener runs. Turning External signals off takes effect for Threads at the next launch.

Only bare routes exist. Every `/presets/<id>/threads…` path receives 404. Thread ids contain 1–128 ASCII letters, digits, `_`, `-`, `.`, or `:`. Invalid, empty, or missing ids receive 404. Unknown paths under `/threads` receive 404. Ids are opaque keys, not secrets.

## `PUT /threads/<id>`

Only PUT is accepted; another method receives 405. The body is a JSON object of at most 64 KiB. Unknown fields are ignored. Any broken field rule receives 400 and leaves the store unchanged.

Optional `label`, `placeholder`, `tone`, `entries`, and `choices` fields treat JSON `null` as absent. `ask: null` closes the ask.

| Field | Rule |
|---|---|
| `source` | Required non-empty string, at most 64 code points |
| `title` | Required non-empty string, at most 200 code points |
| `label` | Optional string; over 120 code points, cut to 119 plus `…` |
| `state` | Required: `working`, `input-required`, `completed`, or `failed` |
| `entries` | Optional array, at most 20 entries, each `{role, text}` |
| `ask` | Optional Ask object or `null`; absent keeps the open ask, `null` closes it |

### Entries

`role` is `agent`, `user`, or `system`. `text` is non-empty and at most 16384 code points. The store appends the entries, stamps each with `at` in epoch milliseconds, and keeps the newest 50.

### Ask fields

| Field | Rule |
|---|---|
| `ask_id` | Required non-empty string, at most 128 code points |
| `prompt` | Required non-empty string, at most 500 code points |
| `choices` | Optional array of at most 6 choices with unique ids |
| `text` | Required boolean: whether free text is accepted |
| `placeholder` | Optional string, at most 200 code points |

Each choice has a required non-empty `id` and `label`, each at most 64 code points. Optional `tone` is `primary` or `danger`.

### Updates

A different `ask_id` replaces the open ask and closes the old one. The same unanswered `ask_id` updates the ask in place. Any state other than `input-required` closes the open ask, whatever `ask` says.

An answered ask never reopens, whether its answer is pending or delivered. A PUT carrying that `ask_id` leaves the ask closed and preserves any pending answer. The producer uses a new `ask_id` for a new question. Answered ids persist with the Thread, so this rule also holds after restart.

A valid PUT receives 200 with `{"updated_at": <epoch ms>}`. The first PUT creates the Thread with `created_at` equal to `updated_at`.

## `GET /threads/<id>/answer`

Only GET is accepted; another method receives 405. Query parameter `ask_id` is required; missing it receives 400. Optional `wait` is an integer from 0 through 25 seconds, default 25; invalid values receive 400.

| Status | Meaning |
|---|---|
| 200 | Pending answer delivered once as `{"ask_id", "choice"?, "text"?, "release"?, "at"}` |
| 204 | Deadline passed with no answer and that ask still open |
| 410 | Ask closed, replaced, or never existed on this Thread, with no pending answer |
| 404 | Unknown Thread |
| 503 | All 32 answer workers are occupied, or a worker cannot start |

A pending answer wins over 410. Answering closes the ask, but the producer's next poll still receives the answer. Delivery removes the pending answer. Each request runs on its own worker thread, so waiting does not block the ingress accept loop. At most 32 answer requests run at once.

## User answers

An Answer supplies `ask_id` and a choice id, text, both, or `release: true` to answer at the agent's own terminal. The Thread must exist and the ask must be open with that id.

A choice must belong to the ask. Text requires `ask.text: true` and cannot exceed 16384 code points. Without a choice, non-empty text, or release, the answer is refused.

An accepted answer becomes pending for the producer, closes the ask, sets state to `working`, and wakes waiters. One `user` entry contains the choice label and text joined with `\n`; a bare release adds no entry. The entry has the answer's timestamp, and the newest-50 limit still applies.

## Storage and expiry

Files live at `<app_data_dir>/threads/threads_YYYY-MM-DD.jsonl`, beside the witness directory. Each change appends the full changed Thread as one JSON line through the shared date rotation helper, in the log timezone. Files retain 14 days. The helper prunes on the first write after each launch and on each date change.

At startup files replay in date order; the last valid line for each id wins, and malformed lines are skipped. Only Threads with `updated_at` within the last 14 days load. Open asks survive restart; pending answers do not. Every change also removes Threads older than 14 days from memory, waking their waiters as unknown.

Disk writes are best-effort: a failed append logs `threads_append_failed` and the change still succeeds. The state lock orders mutation, revision increase, and disk append; disk order equals revision order. After unlocking, the store emits its snapshot. Event delivery can reorder snapshots; consumers keep the highest revision they have seen.

## Commands and event

`threads_snapshot()` returns `{revision, threads}` with Threads sorted by newest `updated_at` first. Each Thread contains `id`, `source`, `title`, optional `label`, `state`, `entries`, optional `ask`, `created_at`, and `updated_at`. Optional `answered_ask_ids` records answered ids and is omitted when empty.

Each stored entry contains `role`, `text`, and `at`.

`thread_answer(id, ask_id, choice?, text?, release?)` submits a user answer and returns success or an error string naming the broken rule. Every successful change increases the revision and publishes `threads-snapshot` to every window, with the same shape as `threads_snapshot()`. Revision starts at zero on app start.
