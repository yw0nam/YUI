# Agent Lifecycle Hooks

The [yui-notify plugin](../../coding-agents/yui-notify/README.md) posts Claude Code and
Codex conversations as app-wide, view-only [Threads](../reference/threads.md). Threads give
the main character a turn only when [Thread turns](../reference/threads.md#thread-turns) is
on in YUI (off by default). Producers connect to YUI; YUI never connects back to the agent.
You answer the agent at its own terminal.

## Setup

- Claude Code: `/plugin marketplace add yw0nam/YUI`, `/plugin install yui-notify@yui`,
  then `/yui-notify:setup`.
- Codex: `codex plugin marketplace add yw0nam/YUI`, `codex plugin add yui-notify@yui`,
  then trust the hooks and run `$yui-notify:setup`.

The setup probes the bare listener endpoint, writes the endpoint, and sends a test Thread.
**Settings → Proactive → What she reacts to → External signals** enables the loopback
listener (default port `8770`). Switch and port changes take effect after restart.
Threads accept no preset prefix and use the listener's Host and Origin checks.

## Events

Both agents post user prompts as `working`. A permission request or an elicitation posts
`input-required` with the request text and returns at once; no body carries an ask. A Stop and
a SessionEnd post `completed`, the Stop with the last assistant message and the SessionEnd with
a `system` entry. A `clear` or `resume` reason sends nothing because the session continues.
Claude Code background-task and SDK Stops, and non-interactive Codex Stops, send nothing.

Claude Code only: a successful permission PUT writes a marker naming the tool and its input
hash. When the allowed tool runs, the matching `PostToolUse` or `PostToolUseFailure` hook
returns the Thread to `working` and deletes the marker; any other tool call sends nothing.
`UserPromptSubmit`, `Stop`, and `SessionEnd` delete the marker first, so a denied request
cannot match a later identical tool call. Codex runs no `PostToolUse` hook, so a Codex
permission Thread waits until its next Stop or prompt.

Thread ids, payload limits, configuration, and commands are in the
[plugin README](../../coding-agents/yui-notify/README.md).

## Other producers

Outside conversations use the [Threads contract](../reference/threads.md).
Notices for character turns use the separate [signal producer guide](../guide/signals-producer.md).