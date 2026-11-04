# Connect a backend

Connect any OpenAI-compatible model, or an agent that keeps its own memory.

![Settings window, Connection page, Chat section with a provider and a model filled in](/shots/settings-connection.png)

1. Right-click the character and choose **All settings…**.
2. Open **Connection**.
3. Pick a **Provider** (OpenAI, Ollama, LM Studio, Groq, Google Gemini, or Hermes Agent). A preset fills **Chat server URL**, and Google Gemini also fills **Chat model**; enter the **Chat model** yourself when the preset fills no model. Hermes Agent switches **Type** to Push and fills no URL. Ollama and LM Studio must be running.
4. Enter a **Chat API key** if the provider needs one, close the window, and press `/` to talk.

The line under each section says whether that server answers; **Reconnect** checks again.

## Which protocol

**Type** sets the protocol, and Chat Completions is the default.

| Your backend | Protocol |
| --- | --- |
| A server that only serves a model (Ollama, LM Studio, Groq, Google Gemini) | Chat Completions |
| A server that keeps the conversation | Responses |
| An agent that speaks first | Push |

## Tips

- The same OpenAI key goes into **Chat API key** and **TTS API key**, so one key gives chat and voice.
- Chat Completions needs a model that calls tools, because YUI always declares its expression tool (for example qwen3 on Ollama).
- A Responses server that keeps no responses answers 404 on every later turn, and the bubble shows a reset notice. Pick Chat Completions for it.
- Google Gemini has a free tier with a daily limit, and the key comes from [Google AI Studio](https://aistudio.google.com/apikey). On the free tier Google may use what you send to improve its products, and people may review it.

## What the connection remembers

With Chat Completions the client sends the session transcript every turn, and with Responses the server keeps the history. Conversation history is not long-term memory. For that, connect an agent that keeps its own memory, or add an external memory setup to the backend.

## Agents with an integration

[Hermes Agent](https://github.com/nousresearch/hermes-agent) is one optional backend, and its [integration README](https://github.com/yw0nam/YUI/blob/main/integrations/hermes/README.md) describes the wiring.

## Go deeper

- Exact keys in `configs/endpoints.json`: [Configuration](../reference/configuration.md).
- [Push transport](../reference/push-transport.md): the wire contract a push backend implements.
