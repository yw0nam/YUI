# Hermes Agent adapter

[Hermes Agent](https://github.com/nousresearch/hermes-agent) is one optional backend for YUI. Its chat endpoint is the Hermes api-server, at `http://localhost:8643` by default.

## Requirements

**Responses mode is required.** Set `"chat_api": "responses"` in `configs/endpoints.json`. The Hermes api-server's `/v1/chat/completions` does not surface tool calls; it emits a custom `hermes.tool.progress` telemetry event (name + status, no arguments) instead of `tool_calls`, so `generate_express` cues never arrive in Chat Completions mode.

**Streaming shape.** Hermes ships the complete `arguments` JSON inside the `function_call` item of `response.output_item.added` / `response.output_item.done`, and emits one `generate_express` call per expressive beat. Its MCP tools are namespaced `mcp_<server>_<tool>`, so `generate_express` arrives as `mcp_<server>_generate_express`; the client matches the tool by suffix.

**Auth.** The api-server key is its `API_SERVER_KEY` environment variable. YUI sends it as `Authorization: Bearer` from the chat key (settings override, else `VITE_YUI_CHAT_KEY` in `.env.local`). A local Hermes runs unauthenticated by default, so an empty key is normal and sends no header.

**Dev proxy (web dev only, not Tauri).** In Responses mode the browser dev build rewrites the chat base URL to the same-origin mount `/__hermes`, and `vite.config.ts` proxies it to `http://localhost:8643` (avoids CORS preflight, keeps SSE streaming). Hermes allowlist-checks the `Origin` header, so the proxy overwrites `Origin` with `YUI_HERMES_ORIGIN` (default `http://localhost:1420`); set it when the dev server runs on another port.

## Profile setup

- Install the Expression Broker MCP into Hermes so it can read the published vocabulary.
- Create a Hermes profile, add `docs/reference/client-context.md` to that profile's context, and instruct it to remember the contract.

## Pointers

- Protocol-level chat/STT/TTS/broker wiring: [docs/agent-guide/backend-integration.md](../../docs/agent-guide/backend-integration.md)
- Hermes-side desire system: [desire/README.md](desire/README.md)
- Dispatch skill: [skills/yui-dispatch/SKILL.md](skills/yui-dispatch/SKILL.md)
