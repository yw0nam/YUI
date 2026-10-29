# Agent Lifecycle Hooks

The [yui-notify plugin](../../integrations/yui-notify/README.md) posts Claude Code and
Codex conversations as app-wide [Threads](../reference/threads.md). Threads fire no
character turn. Producers connect to YUI; YUI never connects back to the agent.

## Setup

- Claude Code: `/plugin marketplace add yw0nam/YUI`, `/plugin install yui-notify@yui`,
  then `/yui-notify:setup`. Install `uv` on each host and launch with
  `claude --dangerously-load-development-channels plugin:yui-notify@yui` for answers.
- Codex: `codex plugin marketplace add yw0nam/YUI`, `codex plugin add yui-notify@yui`,
  then trust the hooks and run `$yui-notify:setup`.

The setup probes the bare listener endpoint, writes endpoint and wait caps, and sends a
test Thread. **Settings → Proactive → Watchers → External signals** enables the loopback
listener (default port `8770`). Switch and port changes take effect after restart.
Threads accept no preset prefix and use the listener's Host and Origin checks.

## Events and answers

Both agents post user prompts as `working`. A ready Claude Code channel server relays
permission requests as Allow, Deny, and text asks. Permission text also arrives as a user
channel message; text alone denies the tool. Stop asks “What next?” while the ready
server is alive. Its hook exits immediately; the server polls YUI after MCP initialization.
The ready channel owns permission entries; the permission hook sends nothing.

Without Claude identity or the channel launch flag, the server serves MCP idle and logs
one stderr line. Stop posts `completed`, and
permission and elicitation hooks post read-only `input-required` entries. Channels are a
research preview; requirements and launch details are in the plugin README.

Codex Stop posts an ask for the next instruction; permission posts Allow, Deny, and text.
The synchronous hook long-polls the answer. Stop text continues the turn; permission text
denies the call and gives Codex the instruction. Release, timeout, closed asks, and errors
return control to Codex. Default caps are 600 seconds for Stop and 120 for permission.

When the Codex host app is frontmost, permission posts without an ask and exits immediately
so its terminal prompt appears. Stop still waits. Claude Code background-task and SDK
Stops, and non-interactive Codex Stops, send nothing.

Thread ids, payload limits, configuration, commands, and fallback details are in the
[plugin README](../../integrations/yui-notify/README.md).

## Other producers

Outside conversations use the [Threads contract](../reference/threads.md).
Notices for character turns use the separate [signal producer guide](../guide/signals-producer.md).
