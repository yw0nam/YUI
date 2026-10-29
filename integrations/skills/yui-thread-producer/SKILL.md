---
name: yui-thread-producer
description: "Thread producer: build or change a producer that puts an outside conversation (a pull request, a mail thread, a comment, a chat mention, a CI run, any source) into YUI's Threads window, collects the user's answer, and acts on it in the source system, and debug one that does not. Use this whenever the user asks to connect a source to YUI's Threads, to run such a producer on a schedule (a cron job, an n8n workflow, a CI step, a script, a daemon), or when answers never reach an existing producer."
license: PolyForm-Noncommercial-1.0.0
---

# yui-thread-producer

A Thread is one outside conversation the user reads and answers in YUI's Threads window.
This skill builds the producer that posts the Thread, collects the answer, and acts in the
source system — for a pull request, a mail thread, or any source with an interface you can
call. It fits whatever runs on the user's side: a scheduler, a daemon, a script, or your
own agent loop. YUI holds each answer until the producer collects it, so a scheduled run
loses nothing between runs.

The wire contract — the routes, the fields, and every limit — is `docs/reference/threads.md`
in the YUI repository; read it before step 1. Outside a checkout:
https://raw.githubusercontent.com/yw0nam/YUI/main/docs/reference/threads.md

## Build the producer

### 1. Pick the source and the question

Settle with the user: what one Thread is (one pull request, one mail thread, one comment
thread), what the user is asked (numbered choices, free text, or both), and what each
possible answer does in the source system. Offer both where they help: choices for the
likely outcomes, text for what a choice cannot name.

Done when: each answer shape maps to one action in the source system.

### 2. Pick the producer shape

A producer that can block — a hook, a daemon, an agent step — long-polls
`GET /threads/<id>/answer`. A producer on a schedule — a cron job, an n8n workflow, a CI
step — sweeps `GET /threads/answers?source=<source>` once per run and exits; the sweep
returns everything collected since the last run, so the schedule sets how long answers
wait, never whether they arrive.

Done when: the shape and its schedule are named.

### 3. Reach YUI

The endpoint is `http://127.0.0.1:<port>`, the listener port shown under YUI's Settings →
Proactive → Watchers (default 8770), with **External signals** on. A producer on another
host reaches YUI through a reverse SSH tunnel the user supervises; the recipe is
`integrations/yui-notify/skills/setup/references/remote.md` in the YUI repository.

Done when: a GET of an unknown Thread id with `wait=0` returns 404 from the producer's
host.

### 4. Post the Thread

PUT one Thread per conversation: a stable id `<source>:<natural key>` (a repository and
number, a mail thread id), `source` — one short name per producer — the title, a label,
and the entries that carry what the user decides on, within the contract's limits. Attach
the ask with a fresh `ask_id` per question, and carry the facts the action will need — a
head commit, a message id — inside the `ask_id` or your own durable store: the answer
names only what was asked.

Done when: the Thread shows in YUI's Threads window.

### 5. Collect and act

Collect by your shape from step 2. Each answer is delivered once — the sweep and the long
poll never hand the same answer to two callers — so record it durably before acting, and
skip any answer your store already holds. Run the action in the source system, then PUT
the Thread with a `system` entry naming what happened and the final state: `completed`,
or `failed` with the error. When an action's outcome is uncertain — a timeout, a crash
mid-action — post a `failed` entry that asks the user to check the source; never retry on
your own. After a failure the user can answer again on a new ask.

Done when: one real answer has been acted on, and the Thread shows the result entry.

### 6. Verify end to end

Run one real item through the whole path: the producer posts the Thread, the user answers
in the Threads window, and the action lands in the source system beside the result entry.

Done when: all three are observed — the action in the source system, the result entry in
the Thread, and the answer that caused them.

## Rules every producer keeps

- One Thread per conversation: updates go to the same id, so the history stays in one
  place.
- A fresh `ask_id` per question; an answered id never reopens.
- Close or replace the ask when the source changes under it — a new push, a new mail — so
  the user never answers a stale question.
- Never act on an answer without the facts it was asked about; they live in the `ask_id`
  or your own store, never in the answer alone.
- `release: true` means the user answered in the source system itself; record it and move
  on, nothing is left to act on.

## Recipes

- `references/github-pr.md` — when the source is a GitHub pull request or its checks.
- `references/gmail.md` — when the source is Gmail.
