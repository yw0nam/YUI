# OpenClaw integration

[OpenClaw](https://docs.openclaw.ai) is one optional backend for YUI. YUI talks to its gateway's OpenAI-compatible HTTP endpoints. Tested with OpenClaw 2026.11.1.

## Protocol

**Responses mode is recommended.** The gateway keeps the conversation and chains turns by `previous_response_id`.

Chat Completions also works. The client then sends the transcript each turn.

## Setup

Step-by-step setup and repair, by hand or by a coding agent: [skills/yui-openclaw-setup/SKILL.md](skills/yui-openclaw-setup/SKILL.md).

## What works

Chat and `generate_express` cues. The gateway passes every tool the request declares to its model and returns the calls to the client.

## What does not work

Features that need the push protocol: backend-started turns, Ask cards, backend commands, delegations, push `reasoning` frames, and the desire system. OpenClaw has no channel that speaks the push frames.

## Security and cost

- The gateway token grants operator access to the agent, including its shell and computer tools. Keep the gateway on loopback.
- Each request carries OpenClaw's own system prompt and tool catalog. 20k to 98k input tokens per request were measured with Gemini 3.5 Flash Lite, so pick a model with prompt caching.

## Pointers

- Protocol-level chat wiring: [docs/agent-guide/backend-integration.md](../../docs/agent-guide/backend-integration.md)
- What each chat transport carries: [docs/reference/push-transport.md](../../docs/reference/push-transport.md)
