# Connect a backend

YUI ships no model of its own. The backend is the brain: it decides what she says, and YUI renders the answer. This page covers the connection, and [Install](installation.md) covers the app itself.

## Fastest path: one OpenAI key

With YUI running, one OpenAI key covers chat and voice: Chat Completions for chat and OpenAI for TTS. Neither service runs on your machine.

1. Right-click the character → **All settings…** → **Connection** page.
2. Chat section: keep **Chat Completions** as the chat API, pick the **OpenAI** provider, paste the key into **Chat API key**, set **Chat model** (`gpt-5-mini`).
3. TTS section: pick the **OpenAI** provider and paste the same key into **TTS API key**.
4. Close Settings and press `/` to type a message.

Her personality is the **Card** section of the **Persona** page, sent on Chat Completions and Responses. Each preset starts with the default card in the UI language; edit any field to make the card your own.

## Chat backend

The shortest path to a first chat needs no config file: right-click the character and choose **All settings…** to open the settings window, switch to the **Connection** page (plug icon), and pick a **Provider** preset in the Chat section, fill in **Chat model** (and **Chat API key** for OpenAI or Groq), close the settings window, press `/` (or `Cmd/Ctrl+Shift+Y`) to open the text input, and send a message.
The preset (OpenAI, Ollama, LM Studio, or Groq) autofills the endpoint URL; the prerequisite is a running Ollama or LM Studio, or an OpenAI or Groq key.
Chat Completions, the shipped default, needs a tool-calling model because the client always declares its `generate_express` tool (`src/io/chat/tools/client-tools.ts`): [`gpt-5-mini`](https://platform.openai.com/docs/models/gpt-5-mini) on OpenAI, [`qwen3`](https://ollama.com/library/qwen3) on Ollama (pull it first with `ollama pull qwen3`), [`llama-3.3-70b-versatile`](https://console.groq.com/docs/tool-use) on Groq.

YUI supports three chat protocols, selected by `chat_api` in `configs/endpoints.json`. Options A and B work with any server that speaks the corresponding OpenAI API; `push` is a WebSocket contract for backends that deliver without a request, described in [push-transport.md](../reference/push-transport.md). The shipped file sets `chat_completions`; if the key is removed the client behaves as `responses`.

### Which one to pick

Pick by who keeps the conversation history. With Chat Completions the client sends it every turn. With Responses the server keeps it.

| Server | Mode to pick |
| --- | --- |
| A server that only serves a model (Ollama, LM Studio, vLLM, Groq) | Chat Completions (default) |
| A server that keeps responses (OpenAI, agent servers) | Responses |
| A backend that speaks first ([Hermes Agent](https://github.com/NousResearch/hermes-agent) supports it) | Push |

On Responses against a server that keeps no responses, every turn after the first answers 404 for the stored `previous_response_id`. The client retries once without the id, the conversation context starts over, and the speech bubble shows a notice that it was reset; choose Chat Completions for such a server.

### What the connection remembers

With Chat Completions the client sends the session transcript every turn, trimmed to `chat_model_context_window`. With Responses the server keeps the history. Conversation history is no long-term memory. Long-term memory comes from a backend agent with its own memory, or from an external memory setup added to the backend.

### Option A: Chat Completions (`"chat_api": "chat_completions"`, shipped default)

Any tool-calling OpenAI-compatible `/v1/chat/completions` endpoint drives expression on its own: the client declares `generate_express` with the emotion/motion/voice vocabulary baked into the tool schema, runs the call locally, returns the result, and keeps the conversation transcript client-side (no `previous_response_id`), trimmed to `chat_model_context_window`.

1. Stand up (or pick) a Chat Completions endpoint.
2. In `configs/endpoints.json`, set:
   ```json
   "chat_api": "chat_completions",
   "chat_base_url": "<API root including /v1, e.g. http://localhost:8000/v1>",
   "chat_model": "<model id served by that endpoint>",
   "chat_model_context_window": 200000
   ```
3. Provide the endpoint's API key if it needs one ([Chat auth key](installation.md#chat-auth-key)).

`generate_express` tool-call deltas are accumulated from the `chat.completion.chunk` stream, and each call's cue plays when a chunk carries a `finish_reason` or the stream ends. A model that stops on its cue calls without speaking gets the tool results back and re-requests, so the turn still reaches speech: up to three round trips. A model that speaks alongside its cues finishes in one request. See [CC mode transport](../reference/client-context.md#cc-mode-transport-chat-completions) for the request shape and [Tool-call round trip](../reference/client-tools.md#tool-call-round-trip) for the round trip.

Backend capability still varies: a plain OpenAI-compatible server (e.g. vLLM) speaks standard tool-call streaming, while the Hermes api-server's `/v1/chat/completions` never surfaces tool calls. With Hermes, use push mode; Chat Completions and Responses carry no expression cues there.

### Option B: Responses (`"chat_api": "responses"`)

Any backend served over the OpenAI Responses API (`/v1/responses`). The client declares `generate_express` on every request with the vocabulary baked into the tool schema, runs the call locally, and sends a follow-up request that re-sends the input items plus the call and its result, so the in-turn round trip does not depend on the server keeping responses (a plain OpenAI-compatible server such as vLLM works). Across turns the client chains on `previous_response_id`; a server that answers 404 for the stored id gets one retry without it, and the conversation context resets. The [Hermes Agent](https://github.com/nousresearch/hermes-agent) API server does not pass a request's tools to its model; on Hermes expression cues arrive on push only, and Chat Completions and Responses carry none.

1. Stand up the backend agent with the Responses API served.
2. Hand the agent the cue contract so it understands how to drive the character:
   - With Hermes: create a profile, add `docs/reference/client-context.md` to that profile's context, and instruct it to remember the contract.
   - With other agents: include the contents of `docs/reference/client-context.md` in the system prompt or context.
3. In `configs/endpoints.json`, set:
   ```json
   "chat_api": "responses",
   "chat_base_url": "http://localhost:8643/v1",
   "chat_model": "<model id>"
   ```
   The client appends `/responses` to `chat_base_url` itself.

### What each chat mode carries

| Feature | `chat_completions` | `responses` | `push` |
| --- | --- | --- | --- |
| Who keeps the conversation history | client | server | backend |
| Speech text and `generate_express` cues | yes | yes | yes |
| Status pill's tool segment (which tool the backend is running) | yes | yes | yes |
| Reasoning at the top of the message window's bubble | yes, when the server streams `reasoning_content` or `reasoning` deltas | yes, when the backend streams reasoning events | yes |
| A reply the backend starts on its own | no | no | yes |
| Delegation list and reports | no | no | yes |

The first two modes work with any server that speaks the corresponding OpenAI API. `push` needs a backend that implements the contract in [push-transport.md](../reference/push-transport.md); the Hermes Agent integration under `integrations/hermes/` is its one implementation.

### Reasoning effort

The in-app agent settings expose reasoning effort (`Default` · `none` · `minimal` · `low` · `medium`). `Default`, the starting value, sends no effort, so the model's own default applies; a model that rejects some values (GPT-OSS rejects `none`) still answers. Any other value is sent: Responses mode as `reasoning.effort`, Chat Completions mode as the top-level `reasoning_effort`.

The reasoning-effort control is shown in Chat Completions and Responses modes only. The **Card** section shows its fields there too; in push mode it keeps only **Import card…** and **Export card**, because push sends no card.

## Agents with an adapter

[Hermes Agent](https://github.com/nousresearch/hermes-agent) is one optional backend for YUI, and the [Hermes integration README](https://github.com/yw0nam/YUI/blob/main/integrations/hermes/README.md) describes its wiring. Its chat endpoint is the Hermes api-server, at `http://localhost:8643` by default, and Responses mode and push mode both work.
