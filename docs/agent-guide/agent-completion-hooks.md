# Agent Completion Hooks

When a coding agent (Claude Code, opencode, or any compatible tool) finishes a task, it can POST a completion signal to the running YUI app. YUI validates the payload, fires it onto the event bus as a `trigger.kind:"agent"` turn, and sends it to the backend (Hermes). Hermes decides whether and what to speak — an empty response means silence. The hook requires YUI to be running with **Settings → Advanced → Agent completion notifications** enabled. The ingress endpoint listens on loopback only (`127.0.0.1:8770`); remote agents reach it via an SSH reverse tunnel.

## Endpoint

```
POST http://127.0.0.1:8770/agent-done
Content-Type: application/json
```

**Body shape:**

```json
{
  "tool": "claude-code",
  "project": "yui",
  "cwd": "/Users/you/Desktop/codes/waifu/2026/YUI",
  "status": "success",
  "summary": "Extracted dev workflow into yui-dev-workflow skill.",
  "ts": 1781000000000
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `tool` | string | Yes | Identifies the coding agent (e.g. `"claude-code"`, `"opencode"`) |
| `project` | string | Yes | Project name — typically the directory base name |
| `cwd` | string | Yes | Absolute working directory at the time of completion |
| `status` | `"success" \| "error"` | No | Exit status; omit if unknown |
| `summary` | string | Yes | Speech material for the backend; capped at 8192 bytes at ingress |
| `ts` | number | Yes | Epoch milliseconds when the hook fired |

## Variant A — raw last message (zero cost)

Claude Code `Stop` hook that sends the last assistant message as the summary. No model call; the backend agent reads the raw text.

```bash
last=$(jq -rs '[.[]|select(.type=="assistant")]|last|.message.content[]?|select(.type=="text").text' "$transcript_path")
jq -n --arg s "$last" --arg cwd "$PWD" \
  '{tool:"claude-code",project:($cwd|split("/")|last),cwd:$cwd,summary:$s,ts:(now*1000|floor)}' \
| curl -s -X POST localhost:8770/agent-done -d @-
```

## Variant B — cheap-model summary (recommended)

Summarize the last message with Haiku before POSTing. The backend receives a concise, speech-ready sentence.

```bash
last=$(jq -rs '[.[]|select(.type=="assistant")]|last|.message.content[]?|select(.type=="text").text' "$transcript_path")
summary=$(printf '%s' "$last" | claude -p "Summarize what was done in one sentence." --model claude-haiku-4-5)
jq -n --arg s "$summary" --arg cwd "$PWD" \
  '{tool:"claude-code",project:($cwd|split("/")|last),cwd:$cwd,summary:$s,ts:(now*1000|floor)}' \
| curl -s -X POST localhost:8770/agent-done -d @-
```

## Wiring the hook (Claude Code)

Add the snippet to `.claude/settings.json` (project) or `~/.claude/settings.json` (global):

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

## Other tools

Any tool that supports a post-run command can POST directly:

```bash
curl -s -X POST localhost:8770/agent-done \
  -H 'Content-Type: application/json' \
  -d "{\"tool\":\"opencode\",\"project\":\"$(basename $PWD)\",\"cwd\":\"$PWD\",\"summary\":\"$SUMMARY\",\"ts\":$(date +%s)000}"
```

## Remote agents

If the coding agent runs on a remote host, forward the loopback port over SSH before starting the session:

```bash
ssh -R 8770:localhost:8770 user@host
```

Any `POST localhost:8770/agent-done` on the remote side reaches the local YUI instance through the tunnel.

## Security

The endpoint binds to `127.0.0.1` only and carries no authentication in v1. Do not expose port 8770 beyond localhost or your own SSH tunnel.
