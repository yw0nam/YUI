# OpenClaw integration

[OpenClaw](https://docs.openclaw.ai) is one optional backend for YUI. YUI talks to its gateway's OpenAI-compatible HTTP endpoints. Tested with OpenClaw 2026.11.1.

## Protocol

**Responses mode is recommended.** Set `"chat_api": "responses"` in `configs/endpoints.json`, or pick **Responses** as the **Type** in the settings panel. The gateway keeps the conversation and chains turns by `previous_response_id`.

Chat Completions also works. The client then sends the transcript each turn.

## Gateway settings

Both HTTP endpoints are off by default. Enable the one you use on the OpenClaw side:

```bash
openclaw config set gateway.http.endpoints.responses.enabled true
openclaw config set gateway.http.endpoints.chatCompletions.enabled true   # Chat Completions only
```

Turn [Code Mode](https://docs.openclaw.ai/tools/code-mode) off for the YUI agent:

```bash
openclaw config set agents.entries.<agentId>.tools.codeMode false
```

OpenClaw's default `auto` engages Code Mode for some models, Gemini 3.5 Flash Lite among them. With it on, the client tools' arguments arrive empty (`{}`).

## YUI settings

In **Settings → Connection**, pick Provider **Custom** and fill:

| Field | Value |
| --- | --- |
| Chat server URL | `http://127.0.0.1:18789/v1`, the gateway's default port |
| Chat model | `openclaw/<agentId>` |
| Chat API key | The gateway token, `gateway.auth.token` |

## Persona

The card goes out as `instructions` on Responses and as the system message on Chat Completions. OpenClaw merges it into its own system prompt beside the agent's workspace files (`SOUL.md`, `AGENTS.md`). Keep those files consistent with the card, or empty.

## What works

Chat, `generate_express` cues, and every client tool. The gateway passes the request's tools to its model and returns the calls to the client. Reasoning the model streams shows in the reasoning display.

## What does not work

Features that need the push protocol: backend-started turns, Ask cards, backend commands, delegations, push `reasoning` frames, and the desire system. OpenClaw has no channel that speaks the push frames.

## Security and cost

- The gateway token grants operator access to the agent, including its shell and computer tools. Keep the gateway on loopback.
- Each request carries OpenClaw's own system prompt and tool catalog. 20k to 98k input tokens per request were measured with Gemini 3.5 Flash Lite, so pick a model with prompt caching.

## Pointers

- Protocol-level chat wiring: [docs/agent-guide/backend-integration.md](../../docs/agent-guide/backend-integration.md)
- What each chat transport carries: [docs/reference/push-transport.md](../../docs/reference/push-transport.md)
