# Threads

A Thread is an outside conversation that a producer posts for the user to read and answer. A Thread has an id, source, state, entries, and at most one open Ask.

Threads are app-wide. A Thread update gives the main character a turn only through [Thread turns](#thread-turns). Producers connect to YUI. YUI never connects to a producer.

## Listener and paths

Threads use the existing loopback ingress and its External signals switch, with no additional port.

Host and Origin checks run first. An invalid Host receives 421, and a foreign Origin receives 403.

The store lives for the whole app. Routes exist while the listener runs.

Turning External signals off takes effect for Threads at the next launch.

Only bare routes exist. Every `/presets/<id>/threads…` path receives 404. Unknown paths under `/threads` receive 404.

Thread ids contain 1 to 128 ASCII letters, digits, `_`, `-`, `.`, or `:`. Invalid, empty, or missing ids receive 404. Ids are opaque keys, not secrets.

## `PUT /threads/<id>`

Only PUT is accepted. Another method receives 405.

The body is a JSON object of at most 64 KiB. Unknown fields are ignored. Any broken field rule receives 400 and leaves the store unchanged.

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

`role` is `agent`, `user`, or `system`. `text` is non-empty and at most 16384 code points.

The store appends the entries and stamps each one with `at` in epoch milliseconds. It keeps the newest 50.

The Thread's `entry_count` is how many entries were ever appended to it, by PUTs and by user answers. It keeps counting past the newest-50 limit, so it names the new entries that `entries` alone cannot. A Thread replayed from a line without it reads 0.

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

An answered ask never reopens, whether its answer is pending or delivered. A PUT carrying that `ask_id` leaves the ask closed and preserves any pending answer.

The producer uses a new `ask_id` for a new question. Answered ids persist with the Thread, so this rule also holds after a restart.

A valid PUT receives 200 with `{"updated_at": <epoch ms>}`. The first PUT creates the Thread with `created_at` equal to `updated_at`.

## `GET /threads/<id>/answer`

Only GET is accepted. Another method receives 405.

Query parameter `ask_id` is optional. Without it, the oldest pending answer of any ask on the Thread is delivered once. When no answer is pending, the request waits.

Optional `wait` is an integer from 0 through 25 seconds. Its default is 25. Invalid values receive 400.

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

The sweep route delivers every pending answer of every Thread whose `source` equals the `source` parameter. Answers come oldest first. Each one is removed on delivery from the same pending store the long-poll delivers from.

The response is `{"answers": [{"thread_id", "ask_id", "choice"?, "choices"?, "text"?, "release"?, "at"}, …]}`, with an empty list when none.

There is no `wait` parameter: a scheduled producer runs on its own clock. Only GET is accepted. Another method receives 405.

The `source` parameter is required, non-empty, and at most 64 code points. A missing, empty, or longer value receives 400.

The id `answers` is reserved. `PUT /threads/answers` receives 404 like any invalid id, so no Thread can take it. A preset-prefixed path reaches no Thread route, as everywhere under `/threads`.

## User answers

An Answer supplies `ask_id` with picked choice ids, text, both, or `release: true` to answer at the agent's own terminal. The Thread must exist, and the ask must be open with that id.

A multi-select Ask accepts `choices` only when they are non-empty, distinct, and all belong to the Ask. It never accepts `choice`.

Any other Ask accepts `choice` and never `choices`. With no pick, a text-only or release answer omits `choices`.

The store normalizes picked ids to the Ask's choice order before storing and delivering the Answer.

A choice must belong to the ask. Text requires `ask.text: true` and cannot exceed 16384 code points. Without a choice (`choice` or `choices`), non-empty text, or release, the answer is refused.

An accepted answer becomes pending for the producer. It closes the ask, sets state to `working`, and wakes waiters.

One `user` entry contains the picked labels in the Ask's choice order, then text, joined with `\n`. A bare release adds no entry. The entry has the answer's timestamp, and the newest-50 limit still applies.

## Storage and expiry

Files live at `<app_data_dir>/threads/threads_YYYY-MM-DD.jsonl`, beside the witness directory.

Each change appends the full changed Thread as one JSON line through the shared date rotation helper, in the log timezone.

Files retain 14 days. The helper prunes on the first write after each launch and on each date change.

At startup, files replay in date order. The last valid line for each id wins, and malformed lines are skipped. Only Threads with `updated_at` within the last 14 days load.

Open asks survive restart, and pending answers do not. Every change also removes Threads older than 14 days from memory, waking their waiters as unknown.

The store targets 200 Threads at startup and after updates. It evicts the oldest by `updated_at` (highest id first on ties), except `input-required` Threads and the Thread from the latest update. Protected Threads may exceed the cap.

Eviction drops pending answers and wakes waiters as unknown.

Disk writes are best-effort. A failed append logs `threads_append_failed`, and the change still succeeds.

The state lock orders mutation, revision increase, and disk append. Disk order equals revision order. After unlocking, the store emits its snapshot. Event delivery can reorder snapshots; consumers keep the highest revision they have seen.

## Commands and event

`threads_snapshot()` returns `{revision, threads}`, with Threads sorted by newest `updated_at` first.

Each Thread contains `id`, `source`, `title`, optional `label`, `state`, `entries`, optional `ask`, `created_at`, `updated_at`, and `entry_count`.

Optional `answered_ask_ids` records answered ids. It is omitted when empty.

Optional `seen_ask_id` is the id of the last ask the user picked in the Threads window while it was open. It is omitted until then. A new ask leaves it unchanged, so the new ask is unseen.

Optional `read` is `true` when the user marked the Thread read in the Threads window since the producer's last PUT. It is omitted otherwise. Every PUT clears it.

Each stored entry contains `role`, `text`, and `at`.

`thread_answer(id, ask_id, choice?, choices?, text?, release?)` submits a user answer. It returns success or an error string naming the broken rule.

Every successful change increases the revision and publishes `threads-snapshot` to every window. The event has the same shape as `threads_snapshot()`.

Revision starts at zero on app start.

`thread_seen(id, ask_id)` records the open ask as seen and returns success or an error string naming the broken rule. It leaves `updated_at` unchanged, and a repeat for the same ask changes nothing.

`thread_read(id)` marks the Thread read and returns success or an error string naming the broken rule. It leaves `updated_at` and the open ask unchanged, and a repeat changes nothing.

## In the app

Main's pet window and the Threads window each listen to `threads-snapshot` and read `threads_snapshot()` once, keeping the highest revision. Main draws the Threads chip from it. The Threads window draws its list and thread pane.

Only the Threads window calls `thread_answer`, with a choice (`choice`, or `choices` for a multi-select Ask), text, or both. It never sends `release`.

The Threads window also calls `thread_seen` when the user picks a Thread with an open ask in its list or rail.

A Thread waits while its state is `input-required` and it is not read. Main's Threads chip counts a waiting Thread unless its open ask is the seen one. Inside the Threads window, a seen Thread still shows as waiting.

The thread pane's Mark read button appears on a waiting Thread. It calls `thread_read` and moves the selection to the next waiting Thread in the list. A read Thread leaves the Waiting tab and keeps its open ask for an answer from All.

Main's Threads chip hides while the Threads window is open.

The Threads window renders each entry's text as Markdown with the speech bubble's renderer, which keeps only the elements Markdown produces. It shows images from `https` URLs only.

A picked Thread and a fresh open start at the newest entry. A new entry follows a reader at the bottom and leaves a reader above it in place.

The main character's backend reads Threads through the `threads_list` and `threads_search` client tools and the `threads:` client-context line.

## Thread turns

Thread turns is the device-wide setting `yui.thread-turns`: `off` (the default), `notable`, or `every`. It decides which Thread updates give the main character a signals turn. A change applies without a restart.

Main's pet window compares each Threads snapshot with the one before. The first snapshot it sees is the baseline and gives no turn, so Threads kept on disk do not replay at launch. Every snapshot updates what was seen, whatever the level, so turning the setting on gives no turn for earlier updates.

| Level | A Thread gives a turn when |
|---|---|
| `off` | Never |
| `notable` | It shows an `ask_id` not seen open on it before (`thread.ask`), or its state becomes `failed` (`thread.failed`) |
| `every` | A new entry has role `agent` or `system` (`thread.entry`) |

The new entries are the newest ones, as many as `entry_count` grew. A Thread absent from the previous snapshot starts with no seen asks, no state, and no entries. Under `notable`, a re-PUT of the same `ask_id` and a Thread becoming `completed` give no turn. Read and seen marks give no turn at any level.

### The signal group

Each Thread that gives a turn becomes one signal group with `delivery: "batched"`. It waits in the batch buffer like a `/signals` group ([Signals ingress](./signals-ingress.md#batched)). Its `event_id` is `thread:<id>`, so a newer group for the same Thread replaces a buffered one.

`source` is the Thread's source, `occurred_at` its `updated_at`, and `label` its title, cut at 120 code points like a producer's label. No signal chip shows for these groups. The group holds one item:

| Field | Value |
|---|---|
| `thread_id` | The Thread id |
| `title` | The title on one line |
| `label` | The label on one line; only when the Thread has one |
| `state` | The Thread state |
| `ask` | The open ask's prompt on one line; only while an ask is open |
| `last` | `{role, text}` of the newest entry, its text on one line and cut at 160 characters; only when the Thread has an entry |

Thread turns run in main's pet window only. Threads reach the client only while the ingress listener runs, and while External signals is off every group is dropped. Turning Thread turns off stops new groups; groups already buffered still go.

### Closed asks and reactions

A buffered `thread.ask` group is dropped when its ask closes before delivery: the Thread shows no open ask, or the Thread is gone. A newer ask replaces the group instead, and a `thread.failed` group for the same Thread stays.

While the Thread reactions switch is on, every Thread turn group stays held in the batch buffer, counted or not: no catch-up, timer firing or drain carries it.

A group the bus refuses, or one restored after a guardrail drop, stays held for the next reaction. The five-group cap of the batch buffer can still push a held group out.

The holds follow the snapshot. A Thread that leaves it releases its group to normal delivery, and so does the switch going off.

When a Thread reaction finishes, every held, buffered group leaves together as one `signals.batch` turn, so the line, the sit and the speech play before it ([Thread reactions](#thread-reactions)).

That turn waits for neither presence nor the proactive gap. When signals are off, or the bus refuses the turn, the groups stay held for the next reaction.

## Thread reactions

Thread reactions is the device-wide switch `yui.thread-reactions`, on by default. Its row sits in the Watchers section of the settings. It does not depend on External signals. Turning it off releases every held turn group, clears the pending cause and stops a reaction in progress; a chip tap then only opens the window.

A Thread update alone gives no reaction. The Threads chip redraws and wiggles; no line, window, seat or Thread turn follows. `completed` and `failed` alone never start a reaction.

A reaction is client-side and sends nothing to the backend itself. It ends by firing the held turn groups, when Thread turns gave some ([Closed asks and reactions](#closed-asks-and-reactions)). A Thread turn still reaches the backend whether or not a reaction plays.

### Causes

A reaction starts on one of three causes.

| Cause | Starts when |
|---|---|
| `tap` | The user taps the Threads chip. |
| `count` | The chip's count of counted Threads reaches N on the rise; it starts again only after the count fell below N. |
| `wait` | One counted Thread has waited T minutes, once per Thread per wait. |

A counted Thread is one the chip counts: waiting, and its open ask is not the seen one.

The thresholds are the device-wide setting `yui.thread-reaction-thresholds`, two rows under the switch in the Watchers section. N is Off, 2, 3 or 5, default 3. T is Off, 5, 10 or 30 minutes, default 10. With both Off the chip tap is the only cause. The rows are dimmed while the switch is off.

The first snapshot after launch is the baseline: it starts no count. A Thread already waiting at launch reaches its wait T minutes after launch if it still waits.

A count or wait reaction waits while the user is away and runs on the return; a tap does not wait.

A cause arriving while a reaction runs waits in one slot and runs after it. A tap replaces a pending count or wait; a count or wait never replaces a pending tap. A pending or running tap is cancelled when the Threads window closes.

### Window states

The reaction reads the Threads window when it runs.

| State | Meaning |
|---|---|
| Closed | The window has no open request from main. |
| Covered | The window is open, and `list_windows` either does not hold it or lists a window in front of it that overlaps it. |
| Open | Otherwise. |

While it is on screen, the Threads window is a perch target, and its rect is the visible panel, inset by the window's 8-point transparent margin on every side. A hand drop, a stroll jump, a fall and the `look` tool all see it.

### Steps

Each reaction runs its steps in order. A step is skipped when it does not apply.

| Window | Steps |
|---|---|
| Closed | A `threads_open` line, the window grows out of the chip's slot with a jelly, then she sits |
| Covered | A `threads_raise` line, the window comes to the front without focus and hops, then she sits |
| Open | She sits |

A tap plays no line and opens nothing: the chip has already opened the window, so she only sits.

A line is drawn from a shuffle bag of its pool. An empty pool gives no line. With the Use interjections switch off, the pool is empty, so no line plays and she goes straight to the window. The line plays to its end. An interrupt, abort or dispose of speech cuts it and stops the reaction.

The window opens or rises without keyboard focus. An open from a closed window selects a Thread: for a wait reaction the Thread that waited out T, for a count reaction the newest counted one. A raise, or an open of a window already shown, changes no tab and no selection. The selection does not report the ask seen.

She sits on the Threads window with `sit_on_window` and lands with a short bounce, unless she already sits on it. A failed sit logs `reaction_sit.failed` and drops the reaction. Under reduced motion the jelly, the hop and the landing do not play.

The expression is always `curious`. When the reaction finishes, every held, buffered turn group fires as one turn. The expression eases back to neutral after `touch_emotion_hold_ms`. When speech is still owed at that moment, the speech's end eases it instead.

### Running one at a time

One reaction runs at a time. It waits while she is not free: the avatar executor missing or busy (she is dragged or moved by an avatar command), a turn in the pipeline, or speech owed. While it waits, the client checks again every second; a count or wait also checks presence.

A running reaction checks after each wait that its cause still holds: the switch is on, a tap's window did not close, a wait's Thread is still counted, a count still has counted Threads. Otherwise it stops and fires nothing; the held groups stay held for the next reaction.

A tap whose window is not listed yet — the chip's open is still in flight — goes back to the slot and retries every second until it is listed.
