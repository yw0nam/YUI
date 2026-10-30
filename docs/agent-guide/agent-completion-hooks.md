# Agent Lifecycle Hooks

The [yui-notify plugin](../../plugins/yui-notify/README.md) posts Claude Code and
Codex conversations as app-wide [Threads](../reference/threads.md). Threads fire no
character turn. Producers connect to YUI; YUI never connects back to the agent.

## Setup

- Claude Code: `/plugin marketplace add yw0nam/YUI`, `/plugin install yui-notify@yui`,
  then `/yui-notify:setup`. Answers need Claude Code v2.1.224 or later.
- Codex: `codex plugin marketplace add yw0nam/YUI`, `codex plugin add yui-notify@yui`,
  then trust the hooks and run `$yui-notify:setup`.

The setup probes the bare listener endpoint, writes endpoint and wait caps, and sends a
test Thread. **Settings → Proactive → Watchers → External signals** enables the loopback
listener (default port `8770`). Switch and port changes take effect after restart.
Threads accept no preset prefix and use the listener's Host and Origin checks.

## Events and answers

Both agents post user prompts as `working`. A Claude Code Stop asks “What next?” when
Claude Code exports its inbox socket, starts a detached poller for that ask, and exits at
once; the poller posts the text answer into the session's inbox socket, which starts the
next turn. A Claude Code permission request waits for Allow, Deny, or text like Codex's;
text also goes into the inbox. Elicitation hooks post read-only `input-required` entries.
The inbox message format and its limits are in the plugin README.

Codex Stop posts an ask for the next instruction; permission posts Allow, Deny, and text.
The synchronous hook long-polls the answer. Stop text continues the turn; permission text
denies the call and gives Codex the instruction. Release, timeout, closed asks, and errors
return control to Codex. Default caps are 600 seconds for Stop and 120 for permission.

When the Codex host app is frontmost, permission posts without an ask and exits immediately
so its terminal prompt appears. Stop still waits. Claude Code background-task and SDK
Stops, and non-interactive Codex Stops, send nothing. Claude Code `SessionEnd` closes the
Thread as `completed` with a `system` entry; a `clear` or `resume` reason sends nothing
because the session continues. An inbox answer Claude Code delivers as a prompt only sets the Thread
`working`; the store recorded the answer when it was typed.

Thread ids, payload limits, configuration, commands, and fallback details are in the
[plugin README](../../plugins/yui-notify/README.md).

## Other producers

Outside conversations use the [Threads contract](../reference/threads.md).
Notices for character turns use the separate [signal producer guide](../guide/signals-producer.md).
