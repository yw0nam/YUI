# Agent Lifecycle Hooks

When a coding agent (Claude Code, opencode, or any compatible tool) finishes a task or stalls waiting on the user, it can POST a lifecycle signal to the running YUI app. YUI validates the payload, fires it onto the event bus as a `trigger.kind:"agent"` turn, and sends it to the backend (Hermes). Hermes decides whether and what to speak — an empty response means silence. The hook requires YUI to be running with **Settings → Reactions → Agent notifications** enabled. The ingress endpoint listens on loopback only; the port defaults to `8770` and is configurable in **Settings → Reactions** — a port change takes effect on app restart. Remote agents reach the endpoint via an SSH reverse tunnel.

## Endpoint

The examples below use the default port `8770`. Substitute the port you configured in Settings → Reactions if you changed it.

```
POST http://127.0.0.1:8770/agent-event
Content-Type: application/json
```

**Body shape:**

```json
{
  "tool": "claude-code",
  "project": "yui",
  "cwd": "/Users/you/Desktop/codes/waifu/2026/YUI",
  "status": "success",
  "phase": "done",
  "summary": "Extracted dev workflow into yui-dev-workflow skill.",
  "ts": 1781000000000
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `tool` | string | Yes | Identifies the coding agent (e.g. `"claude-code"`, `"opencode"`) |
| `project` | string | Yes | Project name — typically the directory base name |
| `cwd` | string | Yes | Absolute working directory at the time of completion |
| `status` | `"success" \| "error"` | No | Exit status; meaningful for `phase:"done"` only, omit if unknown |
| `phase` | `"done" \| "needs_input"` | Yes | Lifecycle phase: the task finished, or the agent is blocked waiting on the user |
| `session_id` | string | No | Opaque pass-through identifying the coding-agent session; the client does not interpret it |
| `detail` | string | No | Judgment material for the backend — a transcript excerpt or the pending tool call; capped at 16384 bytes at ingress |
| `summary` | string | Yes | Speech material for the backend; capped at 8192 bytes at ingress |
| `ts` | number | Yes | Epoch milliseconds when the hook fired |

Each snippet first checks that the app's loopback ingress port is open and exits quietly when it isn't — the hook does no work (and, in Variant B, spends nothing on the summary model) unless YUI is running.

## Wiring `phase:"done"` (Claude Code `Stop`)

### Variant A — raw last message (zero cost)

Claude Code `Stop` hook that sends the last assistant message as the summary. No model call; the backend agent reads the raw text.

```bash
(exec 3<>/dev/tcp/127.0.0.1/8770) 2>/dev/null || exit 0
input=$(cat)
session_id=$(echo "$input" | jq -r '.session_id')
transcript_path=$(echo "$input" | jq -r '.transcript_path')
last=$(jq -rs '[.[]|select(.type=="assistant")]|last|.message.content[]?|select(.type=="text").text' "$transcript_path")
jq -n --arg s "$last" --arg cwd "$PWD" --arg sid "$session_id" \
  '{tool:"claude-code",project:($cwd|split("/")|last),cwd:$cwd,phase:"done",session_id:$sid,summary:$s,ts:(now*1000|floor)}' \
| curl -s -X POST localhost:8770/agent-event -d @-
```

### Variant B — cheap-model summary (recommended)

Summarize the last message with Haiku before POSTing. The backend receives a concise, speech-ready sentence.

```bash
(exec 3<>/dev/tcp/127.0.0.1/8770) 2>/dev/null || exit 0
input=$(cat)
session_id=$(echo "$input" | jq -r '.session_id')
transcript_path=$(echo "$input" | jq -r '.transcript_path')
last=$(jq -rs '[.[]|select(.type=="assistant")]|last|.message.content[]?|select(.type=="text").text' "$transcript_path")
summary=$(printf '%s' "$last" | claude -p "Summarize what was done in one sentence." --model claude-haiku-4-5)
jq -n --arg s "$summary" --arg cwd "$PWD" --arg sid "$session_id" \
  '{tool:"claude-code",project:($cwd|split("/")|last),cwd:$cwd,phase:"done",session_id:$sid,summary:$s,ts:(now*1000|floor)}' \
| curl -s -X POST localhost:8770/agent-event -d @-
```

Add the chosen variant to `.claude/settings.json` (project) or `~/.claude/settings.json` (global):

```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "<paste variant A or B here>"
          }
        ]
      }
    ]
  }
}
```

## Wiring `phase:"needs_input"` (Claude Code `PermissionRequest` + `Notification`)

Two Claude Code top-level hooks cover the ways a session stalls waiting on the user — a permission prompt for a specific tool call, and the idle prompt Claude Code sends once it has nothing left to do without more input. Both are zero-cost: no model call, the hook forwards fields already on its stdin JSON.

### `PermissionRequest` — a tool call is waiting on approval

The hook input carries `tool_name` and `tool_input` for the pending call (for `Bash`, `tool_input.command`); `detail` is composed as `"waiting on <tool_name>: <command>"`.

```bash
(exec 3<>/dev/tcp/127.0.0.1/8770) 2>/dev/null || exit 0
input=$(cat)
tool_name=$(echo "$input" | jq -r '.tool_name')
session_id=$(echo "$input" | jq -r '.session_id')
cwd=$(echo "$input" | jq -r '.cwd')
cmd=$(echo "$input" | jq -r '.tool_input.command // (.tool_input | tostring)')
jq -n --arg tool_name "$tool_name" --arg cmd "$cmd" --arg sid "$session_id" --arg cwd "$cwd" \
  '{tool:"claude-code",project:($cwd|split("/")|last),cwd:$cwd,phase:"needs_input",session_id:$sid,detail:("waiting on " + $tool_name + ": " + $cmd),summary:"",ts:(now*1000|floor)}' \
| curl -s -X POST localhost:8770/agent-event -d @-
```

### `Notification` (`idle_prompt`) — the session is idle, waiting on the next prompt

The `idle_prompt` matcher scopes the hook to the one notification type that means "waiting on you"; `detail` carries the last assistant message, read from the transcript the same way as the `Stop` hook.

```bash
(exec 3<>/dev/tcp/127.0.0.1/8770) 2>/dev/null || exit 0
input=$(cat)
session_id=$(echo "$input" | jq -r '.session_id')
cwd=$(echo "$input" | jq -r '.cwd')
transcript_path=$(echo "$input" | jq -r '.transcript_path')
last=$(jq -rs '[.[]|select(.type=="assistant")]|last|.message.content[]?|select(.type=="text").text' "$transcript_path")
jq -n --arg s "$last" --arg sid "$session_id" --arg cwd "$cwd" \
  '{tool:"claude-code",project:($cwd|split("/")|last),cwd:$cwd,phase:"needs_input",session_id:$sid,detail:$s,summary:"",ts:(now*1000|floor)}' \
| curl -s -X POST localhost:8770/agent-event -d @-
```

Add both to `.claude/settings.json` (project) or `~/.claude/settings.json` (global):

```json
{
  "hooks": {
    "PermissionRequest": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "<paste the PermissionRequest script here>"
          }
        ]
      }
    ],
    "Notification": [
      {
        "matcher": "idle_prompt",
        "hooks": [
          {
            "type": "command",
            "command": "<paste the Notification script here>"
          }
        ]
      }
    ]
  }
}
```

This wiring covers top-level Claude Code sessions only — it does not configure Claude Code's separate subagent (`Task` tool) hooks, and there is no Codex- or opencode-specific `needs_input` wiring. A Codex run launched under Claude Code orchestration (see the `agent-team` skill) is still a tool call inside the top-level session, so its permission prompts and idle waits already reach the ingress through the `PermissionRequest`/`Notification` hooks above.

## Other tools

Any tool that supports a post-run command can POST directly:

```bash
(exec 3<>/dev/tcp/127.0.0.1/8770) 2>/dev/null || exit 0
curl -s -X POST localhost:8770/agent-event \
  -H 'Content-Type: application/json' \
  -d "{\"tool\":\"opencode\",\"project\":\"$(basename $PWD)\",\"cwd\":\"$PWD\",\"phase\":\"done\",\"summary\":\"$SUMMARY\",\"ts\":$(date +%s)000}"
```

## Remote agents

If the coding agent runs on a remote host, forward the loopback port over SSH before starting the session:

```bash
ssh -R 8770:localhost:8770 user@host
```

Any `POST localhost:8770/agent-event` on the remote side reaches the local YUI instance through the tunnel.

## Security

The endpoint binds to `127.0.0.1` only and carries no authentication. Do not expose the listener port beyond localhost or your own SSH tunnel.
