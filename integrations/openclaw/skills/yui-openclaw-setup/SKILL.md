---
name: yui-openclaw-setup
description: "Connect an OpenClaw agent to YUI as its chat backend, or repair that connection. Triggers on a first setup, a 400 or 401 from the gateway, client tools arriving with empty arguments, or a character that expresses but never speaks."
license: PolyForm-Noncommercial-1.0.0
---

# YUI on OpenClaw

Connects one OpenClaw agent to a YUI client over the gateway's OpenAI-compatible HTTP endpoint. YUI runs in Responses mode, its recommended protocol here; [README.md](../../README.md) covers what works and what needs push.

Run the steps in order. Each ends on a **Check**: a command and its expected output. When a check fails, stop and report it with the output. Repairing a connection: the symptom table at the end names the step that owns each failure.

Replace `<agentId>` with the OpenClaw agent the character runs as. Add `--profile <name>` to every `openclaw` command when the gateway runs under a named profile. `$TOKEN` is the gateway token; the user sets it in their shell, so it never lands in the transcript.

## 1. Versions

```bash
openclaw --version
```

**Check:** `OpenClaw 2026.11.1` or later (the version tested). The client needs a YUI build that contains #1933: older builds get a 400 on Responses.

## 2. Enable the Responses endpoint

Both HTTP endpoints are off by default.

```bash
openclaw config set gateway.http.endpoints.responses.enabled true
openclaw config get gateway.http.endpoints.responses.enabled
```

**Check:** prints `true`.

## 3. Code Mode off for the agent

OpenClaw's default `auto` engages Code Mode for some models (Gemini 3.5 Flash Lite among them), and the client tools then arrive with empty arguments. Set it for this agent only:

```bash
openclaw config set agents.entries.<agentId>.tools.codeMode false
openclaw config get agents.entries.<agentId>.tools.codeMode
```

**Check:** prints `false`.

## 4. Gateway up

Start it in the foreground with `openclaw gateway run`, or as a service with `openclaw gateway install`. Keep `gateway.bind` on loopback ([why](../../README.md#security-and-cost)).

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:18789/v1/models -H "Authorization: Bearer $TOKEN"
```

**Check:** `200`. A different port: `openclaw config get gateway.port`.

## 5. A client tool comes back with arguments

```bash
curl -s http://127.0.0.1:18789/v1/responses -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{
  "model": "openclaw/<agentId>",
  "instructions": "You are a cheerful desktop character. Call generate_express before you speak.",
  "tools": [{"type":"function","name":"generate_express","description":"Place an expression cue on the speech around this call. Spoken words never go in the arguments.","parameters":{"type":"object","properties":{"emotion_id":{"type":"string","enum":["neutral","happy","sad","surprised"]},"motion_id":{"type":"string","enum":["happy","laugh","calm"]}},"additionalProperties":false},"strict":false}],
  "input": [{"type":"message","role":"user","content":"I just passed my exam!"}]
}' | jq -c '[.output[] | select(.type=="function_call") | {name, arguments}]'
```

**Check:** within three runs, a `generate_express` entry whose `arguments` names an `emotion_id`. An empty list means the model answered in text that run. `"arguments":"{}"` sends you back to step 3.

## 6. Point YUI at the gateway

The user does this in **Settings → Connection** (right-click the character → **All settings…**):

| Field | Value |
| --- | --- |
| Provider | Custom |
| Type | Responses |
| Chat server URL | `http://127.0.0.1:18789/v1` |
| Chat model | `openclaw/<agentId>` |
| Chat API key | the gateway token |

**Check:** a message typed to the character (`/` opens the input) gets a spoken reply in the bubble. The app log shows `turn {… "outcome":"ok" … "spoke_text":true}`. The log lives in `<repo>/logs/` for `pnpm tauri dev` and in `~/Library/Logs/com.yui.desktop/` for a macOS release.

## 7. Persona

The card goes out as `instructions`, and OpenClaw adds it to its own system prompt beside the workspace files (`openclaw config get agents.entries.<agentId>.workspace`). Bring `SOUL.md` and `IDENTITY.md` in line with the card. A new workspace also holds `BOOTSTRAP.md`, OpenClaw's first-run introduction; the first reply of a fresh agent carried it, so finish or remove it before the character goes live.

**Check:** the user confirms the character answers in the card's voice with no self-introduction.

## Symptoms

| Symptom | Cause | Step |
| --- | --- | --- |
| Responses: `400 input: Invalid input` | YUI build without #1933 | 1 |
| `401` | wrong or missing gateway token | 4, 6 |
| `404 Not Found` on `/v1/responses` | endpoint disabled | 2 |
| Tool calls arrive with `"arguments":"{}"` | Code Mode on | 3 |
| The character changes expression but never speaks (Chat Completions) | YUI build without #1933: no `user`, so each tool result opens a new agent session | 1, or switch Type to Responses |
| The reply introduces itself or asks for a name | `BOOTSTRAP.md` still in the workspace | 7 |
