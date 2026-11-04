# Threads

A Thread is an outside conversation a producer posts for the user to read and answer. It has an id, source, state, entries, and at most one open Ask. Threads are app-wide and do not fire character turns. Producers connect to YUI; YUI never connects to a producer.

## Listener and paths

Threads use the existing loopback ingress and its External signals switch, with no additional port. Host and Origin checks run first: an invalid Host receives 421, and a foreign Origin receives 403. The store lives for the whole app; routes exist while the listener runs. Turning External signals off takes effect for Threads at the next launch.

Only bare routes exist. Every `/presets/<id>/threads…` path receives 404. Thread ids contain 1–128 ASCII letters, digits, `_`, `-`, `.`, or `:`. Invalid, empty, or missing ids receive 404. Unknown paths under `/threads` receive 404. Ids are opaque keys, not secrets.

## `PUT /threads/<id>`

Only PUT is accepted; another method receives 405. The body is a JSON object of at most 64 KiB. Unknown fields are ignored. Any broken field rule receives 400 and leaves the store unchanged.

Optional `label`, `placeholder`, `tone`, `entries`, `multiple`, and `choices` fields treat JSON `null` as absent. `ask: null` closes the ask.

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
| `prompt` | Required non-empty string, at most 500 code points. Markdown, rendered as entry text is |
| `choices` | Optional array of at most 6 choices with unique ids |
| `multiple` | Optional; when present, must be `true` and choices must be non-empty |
| `text` | Required boolean: whether free text is accepted |
| `placeholder` | Optional string, at most 200 code points |

Each choice has a required non-empty `id` and `label`, each at most 64 code points. Optional `tone` is `primary` or `danger`.

### Updates

A different `ask_id` replaces the open ask and closes the old one. The same unanswered `ask_id` updates the ask in place. Any state other than `input-required` closes the open ask, whatever `ask` says.

An answered ask never reopens, whether its answer is pending or delivered. A PUT carrying that `ask_id` leaves the ask closed and preserves any pending answer. The producer uses a new `ask_id` for a new question. Answered ids persist with the Thread, so this rule also holds after restart.

A valid PUT receives 200 with `{"updated_at": <epoch ms>}`. The first PUT creates the Thread with `created_at` equal to `updated_at`.

## `GET /threads/<id>/answer`

Only GET is accepted; another method receives 405. Query parameter `ask_id` is optional. Without it, the oldest pending answer of any ask on the Thread is delivered once; the request waits when none is pending. Optional `wait` is an integer from 0 through 25 seconds, default 25; invalid values receive 400.

| Status | Meaning |
|---|---|
| 200 | Pending answer delivered once as `{"ask_id", "choice"?, "choices"?, "text"?, "release"?, "at"}` |
| 204 | Deadline passed with no answer; with `ask_id`, that ask is still open |
| 410 | Only with `ask_id`: ask closed, replaced, or never existed, with no pending answer |
| 404 | Unknown Thread |
| 503 | All 32 answer wait slots are occupied, or the blocking task fails |

Without `ask_id`, a known Thread never receives 410.

A pending answer wins over 410. Answering closes the ask, but the producer's next poll still receives the answer. Delivery removes the pending answer.

Answer waits run on the bounded blocking pool, so waiting does not block the ingress accept loop. Each wait holds one of 32 permits until it returns, including after a client disconnects.

## `GET /threads/answers?source=<source>`

The sweep route delivers every pending answer of every Thread whose `source` equals the
`source` parameter: oldest first, each removed on delivery from the same pending store the
long-poll delivers from. The response is
`{"answers": [{"thread_id", "ask_id", "choice"?, "choices"?, "text"?, "release"?, "at"}, …]}`; an empty
list when none.

There is no `wait` parameter: a scheduled producer runs on its own clock. Only GET is
accepted; another method receives 405. The `source` parameter is required, non-empty, and at
most 64 code points; a missing, empty, or longer value receives 400.

The id `answers` is reserved: `PUT /threads/answers` receives 404 like any invalid id, so no
Thread can take it. A preset-prefixed path reaches no Thread route, as everywhere under
`/threads`.

## User answers

An Answer supplies `ask_id` with picked choice ids, text, both, or `release: true` to answer at the agent's own terminal. The Thread must exist and the ask must be open with that id.

A multi-select Ask accepts `choices` only when non-empty, distinct, and all ids belong to the Ask; it never accepts `choice`. Any other Ask accepts `choice` and never `choices`. With no pick, a text-only or release answer omits `choices`. The store normalizes picked ids to the Ask’s choice order before storing and delivering the Answer.

A choice must belong to the ask. Text requires `ask.text: true` and cannot exceed 16384 code points. Without a choice, non-empty text, or release, the answer is refused.

An accepted answer becomes pending for the producer, closes the ask, sets state to `working`, and wakes waiters. One `user` entry contains the picked labels in the Ask's choice order, then text, joined with `\n`; a bare release adds no entry. The entry has the answer's timestamp, and the newest-50 limit still applies.

## Storage and expiry

Files live at `<app_data_dir>/threads/threads_YYYY-MM-DD.jsonl`, beside the witness directory. Each change appends the full changed Thread as one JSON line through the shared date rotation helper, in the log timezone. Files retain 14 days. The helper prunes on the first write after each launch and on each date change.

At startup files replay in date order; the last valid line for each id wins, and malformed lines are skipped. Only Threads with `updated_at` within the last 14 days load. Open asks survive restart; pending answers do not. Every change also removes Threads older than 14 days from memory, waking their waiters as unknown.

Disk writes are best-effort: a failed append logs `threads_append_failed` and the change still succeeds. The state lock orders mutation, revision increase, and disk append; disk order equals revision order. After unlocking, the store emits its snapshot. Event delivery can reorder snapshots; consumers keep the highest revision they have seen.

## Commands and event

`threads_snapshot()` returns `{revision, threads}` with Threads sorted by newest `updated_at` first. Each Thread contains `id`, `source`, `title`, optional `label`, `state`, `entries`, optional `ask`, `created_at`, and `updated_at`. Optional `answered_ask_ids` records answered ids and is omitted when empty.

Optional `seen_ask_id` is the id of the last ask the user picked in the Threads window while it was open, and is omitted until then; a new ask leaves it unchanged, so the new ask is unseen.

Optional `read` is `true` when the user marked the Thread read in the Threads window since the producer's last PUT, and is omitted otherwise. Every PUT clears it.

Each stored entry contains `role`, `text`, and `at`.

`thread_answer(id, ask_id, choice?, choices?, text?, release?)` submits a user answer and returns success or an error string naming the broken rule. Every successful change increases the revision and publishes `threads-snapshot` to every window, with the same shape as `threads_snapshot()`. Revision starts at zero on app start.

`thread_seen(id, ask_id)` records the open ask as seen and returns success or an error string naming the broken rule. It leaves `updated_at` unchanged, and a repeat for the same ask changes nothing.

`thread_read(id)` marks the Thread read and returns success or an error string naming the broken rule. It leaves `updated_at` and the open ask unchanged, and a repeat changes nothing.

## In the app

Main's pet window and the Threads window each listen to `threads-snapshot` and read `threads_snapshot()` once, keeping the highest revision. Main draws the Threads chip from it; the Threads window draws its list and thread pane. Only the Threads window calls `thread_answer`, with a choice, text, or both. It never sends `release`.

The Threads window also calls `thread_seen` when the user picks a Thread with an open ask in its list or rail.

A Thread waits while its state is `input-required` and it is not read. Main's Threads chip counts a waiting Thread unless its open ask is the seen one; inside the Threads window a seen Thread still shows as waiting.

The thread pane's Mark read button, shown on a waiting Thread, calls `thread_read` and moves the selection to the next waiting Thread in the list; a read Thread leaves the Waiting tab and keeps its open ask for an answer from All.

Main's Threads chip hides while the Threads window is open.

The Threads window renders each entry's text as Markdown with the speech bubble's renderer, which keeps only the elements Markdown produces, and shows images from `https` URLs only.

A picked Thread and a fresh open start at the newest entry. A new entry follows a reader at the bottom and leaves a reader above it in place.

The main character's backend reads Threads through the `threads_list` and `threads_search` client tools and the `threads:` client-context line; Threads fire no turn.
