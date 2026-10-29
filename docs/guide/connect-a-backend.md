# Connect a backend

Connect any OpenAI-compatible model, or an agent that keeps its own memory.

![Settings window, Connection page, Chat section with a provider and a model filled in](/shots/settings-connection.png)

1. Right-click the character and choose **All settings…**.
2. Open **Connection**.
3. Pick a **Provider** (OpenAI, Ollama, LM Studio, Groq, or Hermes Agent) and enter the **Chat model**.
4. Enter a **Chat API key** if the provider needs one, close the window, and press `/` to talk.

## Which protocol

The **Type** select sets the protocol. Chat Completions is the default.

| Your backend | Protocol |
| --- | --- |
| A server that only serves a model (Ollama, LM Studio, Groq) | Chat Completions |
| A server that keeps the conversation | Responses |
| An agent that speaks first | Push |

**Tip.** Chat Completions needs a model that calls tools, because YUI always declares its expression tool (for example qwen3 on Ollama).

## What the connection remembers

With Chat Completions the client sends the session transcript every turn, and with Responses the server keeps the history. Conversation history is no long-term memory. Long-term memory comes from a backend agent with its own memory, or from an external memory setup added to the backend.

## Agents with an integration

[Hermes Agent](https://github.com/nousresearch/hermes-agent) is one optional backend for YUI, and its [integration README](https://github.com/yw0nam/YUI/blob/main/integrations/hermes/README.md) describes the wiring.

## Go deeper

- Exact keys in `configs/endpoints.json`: [Configuration](../reference/configuration.md).
- [Push transport](../reference/push-transport.md): the wire contract a push backend implements.
- [How YUI works](how-it-works.md): what YUI sends the brain on a turn.
