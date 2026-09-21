# Hermes Agent adapter

[Hermes Agent](https://github.com/nousresearch/hermes-agent) is one optional backend for YUI. Its chat endpoint is the Hermes api-server, at `http://localhost:8643` by default.

## Requirements

**Responses mode or push mode.** Responses mode is the call-per-turn route described below; push mode is the persistent WebSocket described under [Push mode](#push-mode). For responses mode set `"chat_api": "responses"` in `configs/endpoints.json`. The Hermes api-server's `/v1/chat/completions` does not surface tool calls; it emits a custom `hermes.tool.progress` telemetry event (name + status, no arguments) instead of `tool_calls`, so `generate_express` cues never arrive in Chat Completions mode.

**Streaming shape.** Hermes ships the complete `arguments` JSON inside the `function_call` item of `response.output_item.added` / `response.output_item.done`, and emits one `generate_express` call per expressive beat. Its MCP tools are namespaced `mcp_<server>_<tool>`, so `generate_express` arrives as `mcp_<server>_generate_express`; the client matches the tool by suffix.

**Auth.** The api-server key is its `API_SERVER_KEY` environment variable. YUI sends it as `Authorization: Bearer` from the chat key (settings override, else `VITE_YUI_CHAT_KEY` in `.env.local`). A local Hermes runs unauthenticated by default, so an empty key is normal and sends no header.

**Dev proxy (web dev only, not Tauri).** In Responses mode the browser dev build rewrites the chat base URL to the same-origin mount `/__hermes`, and `vite.config.ts` proxies it to `http://localhost:8643` (avoids CORS preflight, keeps SSE streaming). Hermes allowlist-checks the `Origin` header, so the proxy overwrites `Origin` with `YUI_HERMES_ORIGIN` (default `http://localhost:1420`); set it when the dev server runs on another port.

## Push mode

Set `"chat_api": "push"` in `configs/endpoints.json`, or pick **Hermes Agent** in the settings panel's chat provider dropdown. The Hermes side of this mode is the platform plugin under `integrations/hermes/platform/yui/`, and `chat_base_url` is that plugin's WebSocket base: the client opens `<chat_base_url>/ws` and identifies itself with the key and a per-installation `chat_id`. The frames, the reconnect schedule and the size limits are in [docs/reference/push-transport.md](../../docs/reference/push-transport.md).

The chat model row is not part of this mode — the plugin picks the model. The settings panel's chat section carries a connection line instead, naming the conversation while the socket is up and the close code when the backend refuses it.

## Profile setup

- Responses mode: install the Expression Broker MCP into Hermes so it can read the published vocabulary and call the broker's `generate_express`.
- Push mode: the platform plugin takes the vocabulary from the client and carries `generate_express` itself. `platform_toolsets.yui` gives the platform every enabled MCP server until it names some, so name the MCP servers the character uses there, or add `no_mcp`, to keep the Expression Broker off the platform, as the plugin's [Enable](platform/yui/docs/install.md#enable) section describes.
- Create a Hermes profile, add `docs/reference/client-context.md` to that profile's context, and instruct it to remember the contract.

## Pointers

- Protocol-level chat/STT/TTS/broker wiring: [docs/agent-guide/backend-integration.md](../../docs/agent-guide/backend-integration.md)
- Hermes-side desire system: [desire/README.md](desire/README.md)
- Dispatch skill: [skills/yui-dispatch/SKILL.md](skills/yui-dispatch/SKILL.md)
