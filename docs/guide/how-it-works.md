# How YUI works

YUI draws the character on your screen, gives her a voice, and moves her. The model or agent you connect writes what she says.

```mermaid
flowchart TB
  you(["You"])
  producers["Producers: hooks, scripts, game mods"]
  yui["YUI, the body"]
  voice["STT and TTS servers"]
  brain["Backend agent, the brain"]
  plugins["Plugins on your computer"]

  you <-->|"talk and tap / face and voice"| yui
  producers -->|"POST /signals"| yui
  yui <-->|"speech / voice"| voice
  yui <-->|"what happened / words and tool calls"| brain
  yui -->|"runs"| plugins
  brain -.->|"bridge tools"| yui
```

YUI sends the brain what happened, over Chat Completions, Responses or Push, and turns the answer into a face, a voice and gestures.

## One turn

```mermaid
sequenceDiagram
  actor You
  participant YUI
  participant Brain as Backend agent (brain)
  participant TTS
  You->>YUI: Send a message
  YUI->>Brain: Message with the client context
  Brain-->>YUI: Text and a generate_express call (emotion, motion)
  YUI->>TTS: Text
  TTS-->>YUI: Voice
  YUI-->>You: She speaks, and her face and body follow the cue
```

## What decides what

YUI notices events and picks who gets a turn. The brain decides whether to speak and what to say, and YUI renders whatever arrives.

## Go deeper

- [Client Context](../reference/client-context.md): the per-turn block YUI sends.
- [Client Tools](../reference/client-tools.md): the tools the brain calls.
- [Push transport](../reference/push-transport.md): the contract for a backend that speaks first.
