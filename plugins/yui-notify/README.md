# yui-notify

Claude Code and Codex hooks post coding-agent conversations as [Threads](../../docs/reference/threads.md).
Threads are app-wide and fire no character turn. Codex accepts answers through synchronous
hooks. Claude Code accepts answers through its channel server when launched with the channel
flag; without a ready channel its Stop hook waits for the answer like Codex's.

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

YUI requires **Settings → Proactive → Watchers → External signals** on. The loopback
listener defaults to port `8770`; switch and port changes take effect after restart.

## What it sends

Lifecycle hooks send `PUT <endpoint>/threads/<id>` with source, title, label, state, and
one entry when text is available. The title is `<project> (<branch>)`, or `<project>`.
The label joins the present host, tmux session/window, and project/branch parts.

Claude Code ids are `claude-code:<host>:<claude pid>`. The messaging socket filename
provides the PID first; hooks also accept `CLAUDE_PID`. Otherwise the producer walks
up to five parents, accepting native and npm Claude launches. Hooks use their parent
PID if discovery fails. Ids survive `/clear`. Codex ids are `codex:<host>:<session_id>`.
`host` is the hostname before its first dot, including on local sessions.

| Agent | Event | State | Entry | Ask |
|---|---|---|---|---|
| Both | `UserPromptSubmit` | `working` | `user`: prompt | Closes |
| Claude Code | `Stop` | `input-required` | `agent`: last assistant message | “What next?” with text |
| Claude Code | `PermissionRequest` | `input-required` | Channel owns the entry when ready; otherwise hook posts tool input | Channel adds Allow, Deny, and text |
| Claude Code | `Notification` (elicitation) | `input-required` | `system`: message | None added |
| Claude Code | `SessionEnd` | `completed` | `system`: Session ended | Closes |
| Codex | `Stop` | `input-required` | `agent`: last assistant message | “What next?” with text |
| Codex | `PermissionRequest` | `input-required` | `system`: tool name and command or input JSON | Allow, Deny, or text |
| Codex | `SessionEnd` | `completed` | `system`: Session ended | Closes |

Each Codex ask has a fresh UUID suffix, including successive Stops in one turn.
Entry text keeps at most 16384 code points, shortening the head with `…` when needed.
The serialized body stays within 65536 bytes, including for Unicode text.
An instruction answered in the Threads window is already a `user` entry in the store, so
the channel message Claude Code delivers it as only sets the Thread `working`.

Hooks name the sending agent from the payload first. A payload with `turn_id`, a null
`transcript_path`, or a transcript whose first line is `session_meta` (a Codex rollout)
comes from Codex, even in a shell that inherited `CLAUDECODE=1`. Otherwise `prompt_id`
or `CLAUDECODE=1` names Claude Code, a remaining `SessionStart` is Codex's, and any other
event sends nothing.

## Claude Code answers

Install `uv` on every host running Claude Code, including SSH hosts. Launch Claude Code
with the plugin registered as a channel:

```bash
claude --dangerously-load-development-channels plugin:yui-notify@yui
```

Channels are a Claude Code research preview and require an account and organization
policy that permit channels. The development flag allows this plugin during the preview.
A plain `claude` launch still loads the MCP server, but it stays idle and consumes no
answers; its Stop hook waits for the answer instead (§ Synchronous hook answers).
The plugin manifest declares no MCP server, so Codex starts none: the channel belongs to
Claude Code, and Codex reads a plugin's `.mcp.json` command literally.

The server reads `CLAUDE_CODE_MESSAGING_SOCKET` (`/tmp/cc-socks/<pid>.sock`) before walking
parents. It checks Claude's command line with whitespace splitting, accepting `--channels`
and `--dangerously-load-development-channels` in space or equals form. Each flag's list
must contain `plugin:yui-notify@yui`.

After MCP initialization, a ready server starts polling and writes its PID to
`$XDG_STATE_HOME/yui-notify/channels/<claude pid>` (default `~/.local/state`), removing it
on exit. Hooks ignore stale files. An unidentified or disabled channel serves MCP idle,
printing one stderr line without failing startup. The ready channel owns permission
entries, so the permission hook sends nothing.
SIGINT and SIGTERM end the server at once and take the channel file with it.

- A permission channel request posts Allow, Deny, and text. Allow or Deny sends that
  verdict; any text is also sent as a user channel message. Text alone denies the tool
  and sends the instruction. Release leaves the terminal permission dialog alone.
- Stop text sends the next instruction as a user channel message. Release sends nothing.
- While a ready channel file names a live server, Claude Code hooks never wait for answers.
  The server long-polls YUI without `ask_id`
  for both kinds of answer, backing off from 1 to 30 seconds on missing Threads or errors.
  Malformed answers and dispatch failures log to stderr and do not stop polling. Failed
  permission PUTs write the same `last-error.json` record as hook requests.

## Synchronous hook answers

Codex's `Stop` and `PermissionRequest` hooks, and Claude Code's `Stop` hook without a ready
channel, are synchronous, with a 660-second hook timeout. After posting an ask, the hook
long-polls its answer route in intervals up to 25 seconds. YUI never connects back to the
agent. The turn stays open while the hook waits.

Claude Code queues a prompt typed in its terminal during the wait and runs it after the hook
returns; Esc ends the wait at once. Claude Code shows the continued instruction as
“Stop hook error: <text>”.

- Permission Allow returns an allow decision. Deny returns a deny decision with any text
  as its message. Text alone denies and gives Codex that instruction.
- Stop text returns `{"decision":"block","reason":"<text>"}` to continue the turn.
  The continuation's Stop posts another ask, so instructions can be chained.
- Release prints nothing and closes the ask: Stop becomes `completed`; permission stays
  `working` while Codex uses its terminal approval prompt.
- A wait cap, closed ask (410), error, or SIGTERM, SIGINT, or SIGHUP prints nothing and
  closes the ask with a final PUT: `completed` for Stop, `working` for permission fallback
  to the terminal. Claude Code sends SIGTERM on Esc.

When Codex's host app is frontmost on macOS, permission posts without an ask and exits
immediately, letting the terminal prompt appear. Stop still asks. The check compares
inherited `__CFBundleIdentifier` with `lsappinfo`; it is per app, not tab or pane.
SSH, tmux, missing bundle identifiers, and hosts without `lsappinfo` skip the focus check.

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
| `wait.stop` | Seconds, 1–600 | `600` |
| `wait.permission` | Seconds, 1–600 | `120` |

```json
{
  "endpoint": "http://127.0.0.1:8770",
  "wait": { "stop": 600, "permission": 120 }
}
```

An endpoint with any path is invalid and uses the default. An explicit probe endpoint with a path reports the problem.
Values outside 1–600 use the default. Poll deadlines use a monotonic clock. Each poll's
`wait` is the smaller of 25 and the remaining whole seconds; its HTTP timeout adds five
seconds. Waiting ends when less than one second remains.

## Commands

```bash
yui-notify hook
yui-notify probe [--endpoint URL]
yui-notify test [--endpoint URL]
```

- `hook` reads stdin JSON and always exits 0. Stdout carries only a startup warning or a
  Codex decision. Failed hook requests write `last-error.json` under
  `$XDG_STATE_HOME/yui-notify/` (default `~/.local/state/yui-notify/`).
- `probe` sends `GET /threads/yui-notify-probe/answer?ask_id=probe&wait=0`.
  HTTP 404 proves the listener and route are up; HTTP 400 prints “update YUI”.
- `test` PUTs an `input-required` Thread at `yui-notify:test:<host>` with a system entry and
  an “Arrived” ask, prints `sent: HTTP <n>; …`, and waits 60 seconds for the answer. It prints
  `answered: …` and exits 0, or prints `no answer within 60 s`, closes the ask, and exits 1.

`probe` and `test` exit 0 on success and 1 on failure. See
[troubleshooting](skills/setup/references/troubleshooting.md) for failure lines.

## Startup check

The synchronous `SessionStart` hook (startup matcher, five-second timeout) runs the probe.
Failure prints `{"systemMessage":"yui-notify: <failure line>"}`; success prints nothing.
Claude Code SDK entrypoints skip this check. Codex SessionStart has no interactive-source
field, so exec sessions run the check too.

## Requirements and development

The hooks run on system `python3` (3.9+, standard library only). The Claude Code channel
server needs `uv` on every host, Python 3.11+ through uv, and the MCP Python SDK installed
from this project. Claude Code or Codex needs plugin support.

```bash
cd plugins/yui-notify
uv run pytest
uv run ruff format --check .
uv run ruff check .
```
