# Agent Lifecycle Hooks

A coding agent tells YUI when it finishes a task or stalls waiting on the user. The
[`yui-notify` plugin](../../integrations/yui-notify/README.md) is the supported wiring for
Claude Code and Codex: it installs the agent hooks and posts one signal per event to YUI's
loopback ingress. YUI validates the signal, fires a `signals` trigger, and sends it to the
selected backend. The backend decides whether and what to speak — an empty response means
silence.

The ingress listens only while **Settings → Proactive → Watchers → External signals** is
on, on the port shown in the same section (default `8770`), and a change of the switch or
port takes effect on the next launch. The listener is loopback-only and carries no
authentication; a request whose `Host` is not `127.0.0.1`, `localhost` or `::1` is refused
with 421, and a request whose `Origin` names another host with 403.

## Setup

Install the plugin, then run its setup skill:

- Claude Code: `/plugin marketplace add yw0nam/YUI`, `/plugin install yui-notify@yui`,
  then `/yui-notify:setup`.
- Codex: `codex plugin marketplace add yw0nam/YUI`, `codex plugin add yui-notify@yui`,
  then trust the hooks and run `$yui-notify:setup`.

The setup skill probes the character, chooses the delivery classes, writes the
configuration, and sends a test signal. Install steps, configuration keys, and the command
line are in the [plugin README](../../integrations/yui-notify/README.md).

## What is sent

| Agent | Hook | `event_type` | Default delivery class |
|---|---|---|---|
| Claude Code, Codex | `Stop` | `agent.done` | `batched` |
| Claude Code, Codex | `PermissionRequest` | `agent.needs_input` | `urgent` |
| Claude Code | `Notification` (`elicitation_dialog`, `elicitation_url_dialog`) | `agent.needs_input` | `urgent` |

A Claude Code `Stop` with a running background task sends nothing, because the turn is not
over. `idle_prompt` and `permission_prompt` are not hooked: they repeat `Stop` and
`PermissionRequest`. Codex has no `Notification` event, so an MCP elicitation prompt in
Codex posts nothing.

Each signal carries `event_id` `<session_id>:<phase>`, a label, and one item with the
project, branch, tmux pane, host, and either a summary of the finished work or the pending
tool call. The envelope fields and delivery rules are in the
[signals ingress reference](../reference/signals-ingress.md).

## Other tools

Any tool that runs a command after its work can post a signal itself. The
[producer guide](../guide/signals-producer.md) holds the envelope, the delivery classes,
and examples.

## Deprecation

`POST /agent-event` is deprecated: removed in v0.6.0. Use `POST /signals`.
