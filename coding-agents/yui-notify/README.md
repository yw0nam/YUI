# yui-notify

Claude Code and Codex hooks post coding-agent conversations as [Threads](../../docs/reference/threads.md).
Threads are app-wide and view-only: you read them, and you answer the agent at its own terminal.
A Thread gives the main character a turn only when Thread turns is on in YUI.

Running your agents inside herdr? Use YUI's herdr plugin instead and leave yui-notify
uninstalled: both would report the same session.

## Install

Install the plugin on every host where an agent runs, including SSH hosts.

Claude Code:

```text
/plugin marketplace add yw0nam/YUI
/plugin install yui-notify@yui
```

Codex:

```bash
codex plugin marketplace add yw0nam/YUI
codex plugin add yui-notify@yui
```

Codex requires hook trust at startup. Changed hook definitions require trust again; see
[Codex setup](skills/setup/references/codex.md). Run `/yui-notify:setup` in Claude Code or
`$yui-notify:setup` in Codex to configure the endpoint, probe it, and send a test Thread.
Run `/yui-notify:thread-producer` or `$yui-notify:thread-producer` to build a producer for
another source, such as a pull request or a mail thread.

To update an existing install, refresh the marketplace, update the plugin, then reload
plugins or start a new session. Claude Code: `/plugin marketplace update yui`,
`/plugin update yui-notify@yui`, `/reload-plugins`. Codex:
`codex plugin marketplace upgrade yui`.

YUI requires **Settings → Proactive → What she reacts to → External signals** on. The loopback
listener defaults to port `8770`; switch and port changes take effect after restart.

## What it sends

Lifecycle hooks send `PUT <endpoint>/threads/<id>` with source, title, label, state, and
one entry when text is available. The body never carries an ask. The title is
`<project> (<branch>)`, or `<project>`. The label joins the present host and tmux
session/window with a comma, and is absent when neither is present (the title already names
the project and branch); a pending command is sent in a ``` fence.

Claude Code ids are `claude-code:<host>:<claude pid>`. The messaging socket filename
provides the PID first; hooks also accept `CLAUDE_PID`. Otherwise the producer walks
up to five parents, accepting native and npm Claude launches. Hooks use their parent
PID if discovery fails. Ids survive `/clear`. Codex ids are `codex:<host>:<session_id>`.
`host` is the hostname before its first dot, including on local sessions.

| Agent | Event | State | Entry |
|---|---|---|---|
| Both | `UserPromptSubmit` | `working` | `user`: prompt |
| Claude Code | `Stop` | `completed` | `agent`: last assistant message |
| Claude Code | `PermissionRequest` | `input-required` | `system`: tool name and command or input JSON |
| Claude Code | `PermissionRequest` (`AskUserQuestion`) | `input-required` | `system`: each question with its options |
| Claude Code | `PostToolUse` | `working` only when the session's permission marker matches the tool name and input; nothing sent otherwise | None added |
| Claude Code | `PostToolUseFailure` | `working` only when the session's permission marker matches the tool name and input; nothing sent otherwise | None added |
| Claude Code | `Notification` (elicitation) | `input-required` | `system`: message |
| Claude Code | `SessionEnd` | `completed` | `system`: Session ended |
| Codex | `Stop` | `completed` | `agent`: last assistant message |
| Codex | `PermissionRequest` | `input-required` | `system`: tool name and command or input JSON |
| Codex | `SessionEnd` | `completed` | `system`: Session ended |

A Claude Code prompt that starts with `<task-notification>` or `<agent-message ` adds no entry
and only sets the Thread `working`. Claude Code marks a queued subagent report or background-task
notification by that leading tag alone, so a typed prompt that starts the same way adds no entry either.

Entry text keeps at most 16384 code points, shortening the head with `…` when needed.
The serialized body stays within 65536 bytes, including for Unicode text.

Hooks name the sending agent from the payload first. A payload with `turn_id`, a null
`transcript_path`, or a transcript whose first line is `session_meta` (a Codex rollout)
comes from Codex, even in a shell that inherited `CLAUDECODE=1`. Otherwise `prompt_id`
or `CLAUDECODE=1` names Claude Code, a remaining `SessionStart` is Codex's, and any other
event sends nothing.

## Answers

Answer the agent at its own terminal. A Thread asks nothing and never carries a permission
decision.

A permission request posts the Thread as `input-required` and the hook returns at once.
Claude Code only, a successful permission PUT also writes `<session>.permission.json` in the
state dir (where `last-error.json` lives), naming the tool and its input hash. When you allow
the request at the terminal and the tool runs, the `PostToolUse` or `PostToolUseFailure` hook
returns that Thread to `working` and deletes the marker; any other tool call sends no request.
`UserPromptSubmit`, `Stop`, and `SessionEnd` delete the marker before their PUT, so a denied
request cannot match a later identical tool call.

yui-notify writes no permission marker for Codex, so a Codex permission Thread stays
`input-required` until Codex's next `Stop` or `UserPromptSubmit`.

## Suppressions

Claude Code Stop and SessionEnd with a running background task or an SDK entrypoint send
nothing. SessionEnd with reason `clear` or `resume` sends nothing: the session continues
in the same Thread. Claude Code SDK and non-interactive Codex sessions also suppress
`UserPromptSubmit`.
Codex Stop and SessionEnd send nothing for non-interactive rollout sources (including exec
and subagents).
`idle_prompt` and `permission_prompt` notifications are not hooked. Codex has no
`Notification` event, so its MCP elicitation sends nothing.

## Configuration

Read `$XDG_CONFIG_HOME/yui-notify/config.json`, or `~/.config/yui-notify/config.json`.
A missing, unreadable, or invalid file uses defaults; invalid values use their key's default.

| Key | Value | Default |
|---|---|---|
| `endpoint` | `http://127.0.0.1:<port>` with no path | `http://127.0.0.1:8770` |

```json
{
  "endpoint": "http://127.0.0.1:8770"
}
```

An endpoint with any path is invalid and uses the default. An explicit probe endpoint with a path reports the problem.

## Commands

```bash
yui-notify hook
yui-notify probe [--endpoint URL]
yui-notify test [--endpoint URL]
```

- `hook` reads stdin JSON and always exits 0. Stdout carries only a startup warning. Failed
  hook requests write `last-error.json` under `$XDG_STATE_HOME/yui-notify/`
  (default `~/.local/state/yui-notify/`).
- `probe` sends `GET /threads/yui-notify-probe`.
  HTTP 405 proves the listener and route are up; HTTP 400 or 404 prints “update YUI”.
- `test` PUTs an `input-required` Thread at `yui-notify:test:<host>` with a system entry and
  no ask, then prints `sent: HTTP <n>; look for it in YUI's Threads window` and exits 0. It
  sends no second request. A failed PUT prints the failure line and exits 1.

`probe` and `test` exit 0 on success and 1 on failure. See
[troubleshooting](skills/setup/references/troubleshooting.md) for failure lines.

## Startup check

The `SessionStart` hook (startup matcher, five-second timeout) runs the probe.
Failure prints `{"systemMessage":"yui-notify: <failure line>"}`; success prints nothing.
Claude Code SDK entrypoints skip this check. Codex SessionStart has no interactive-source
field, so exec sessions run the check too.

## Requirements and development

The hooks run on system `python3` (3.9+, standard library only). Claude Code or Codex needs
plugin support. `uv` runs only the development checks below.

```bash
cd coding-agents/yui-notify
uv run pytest
uv run ruff format --check .
uv run ruff check .
```
