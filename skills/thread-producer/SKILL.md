---
name: thread-producer
description: "Post an outside conversation (a pull request, a mail thread, a Slack or Discord thread) to YUI's Threads as view-only Threads, and act in that source when the user tells the character to. Use when the user wants a source shown in Threads, or when a Thread producer is built, changed, scheduled, or debugged, or its Threads do not update."
license: PolyForm-Noncommercial-1.0.0
---

# thread-producer

A Thread is one outside conversation the user reads in YUI's Threads window. The producer
posts it. The user reads it there and tells the main character what to do. The backend
agent then acts in the source with its own integration. YUI never connects to a producer,
and a Thread carries no reply path.

The wire contract (the routes, the fields, and every limit) is `docs/reference/threads.md`
in the YUI repository. Read it before step 1. Outside a checkout:
https://raw.githubusercontent.com/yw0nam/YUI/main/docs/reference/threads.md

## Post the Threads

### 1. Pick the source and what one Thread is

Settle with the user what one Thread is: one pull request, one mail thread, or one chat
thread. Set each Thread's state from what the user should do:

- `input-required`: the user should look or decide.
- `working`: the conversation is open and the user has nothing to do yet.
- `completed`: the conversation is handled.
- `failed`: the source cannot be read, or an action failed and nothing is left to try.

Done when: each state maps to what the user should do about its Thread.

### 2. Pick the shape

A scheduled run (cron, a workflow tool, CI) or an event-driven step. The schedule sets how
fresh the Threads are.

Done when: the shape and its schedule are named.

### 3. Reach YUI

The endpoint is `http://127.0.0.1:<port>`. The port is shown under Settings → Proactive →
What she reacts to → External signals (default 8770). Turn **External signals** on. Turning
it off takes effect for Threads at the next launch. A producer on another host reaches YUI
through a reverse SSH tunnel; read `references/remote.md`.

Done when: `GET /threads/probe` from the producer's host returns 405, since the route exists
and takes only PUT.

### 4. Post the Thread

PUT `/threads/<id>` once per conversation, with:

- `id`: `<source>:<natural key>`, such as `github-pr:<owner>:<repo>:<n>`. Use 1 to 128 ASCII
  letters, digits, `_`, `-`, `.`, or `:`; replace any other character.
- `source`: one short name per producer.
- `title`: required on every PUT.
- `label`: optional.
- `state`: from step 1.
- `entries`: up to 20 `{role, text}` objects, where `role` is `agent`, `user`, or `system`.
  Put what the user needs to read in them.

The body is at most 64 KiB. A broken field rule returns 400 and changes nothing.

Done when: the Thread shows in YUI's Threads window.

### 5. Keep it current

PUT only when the source changed since the producer's last post. Every PUT appends its
entries again and clears the user's read mark. So a scheduled run skips unchanged items,
sends only the new entries, and omits `entries` for a state-only update.

Set `completed` when the conversation is handled. When the source cannot be read, set
`failed` with a `system` entry naming the cause.

Done when: a second run over an unchanged source sends no PUT.

### 6. When the user tells the character to act

The user names the Thread to the main character. Only the main character offers the Thread
tools. The backend calls `threads_list` with the Thread's id, through `yui_tool_call`. When
it has no id, it calls `threads_search` to find candidates. `threads_search` matches title,
label, and entry text by substring, so with more than one candidate the backend confirms
the one the user means with the user. Before acting, it checks the exact source item.

The backend acts in the source with its own integration. Then it PUTs a `system` entry
naming what happened, and the new state. A partial or uncertain outcome (sent but the label
not removed, a timeout, a crash mid-action) is named in that entry. The source is checked
before any retry.

Done when: one real item has gone the whole way. The Thread shows in the Threads window,
the user tells the main character to act on it, the action lands in the source, and the
Thread shows the result entry.

## Rules every producer keeps

- One Thread per conversation: every update goes to the same id.
- Set `input-required` only when the user should look or decide. Move the Thread off it
  once the user has handled it. A waiting Thread is counted on the Threads chip and can
  start a character reaction.
- Keep each Thread's title in the producer's store, since every PUT needs it.

## Source guides

- `references/github-pr.md`: a GitHub pull request and its checks.
- `references/gmail.md`: a Gmail thread.
- `references/remote.md`: a producer on another host.
