# `emotion_text` vocabulary

> Human source of truth (SOT) for the `emotion_text` rule. The
> **Expression Broker MCP** enforces it at runtime via its `emotion_text` gate;
> the files here are what a human or agent reads to know the rule.

## What `emotion_text` is

`emotion_text` is the **voice/TTS control channel** of `generate_express` — an
independent channel from `emotion_id` (the VRM face blendshape). A happy face
(`emotion_id`) and a whispered voice (`emotion_text`) can fire at the same time.
The model behind the active chat endpoint produces `emotion_text` via a
`generate_express` tool call; YUI consumes whatever arrives — from the
`/v1/responses` stream in Responses mode, or identically from
`chat.completion.chunk` tool-call deltas in Chat Completions mode — and
prepends it to the TTS segment (prefix-only — never shown in the speech
bubble). The `generate_express` cue contract that carries
`emotion_text` is described in
[`client-context.md`](../client-context.md);
the control envelope shape lives in
[`src/contract/types.ts`](https://github.com/yw0nam/YUI/blob/main/src/contract/types.ts).

## Broker gate

The vocabulary is the **emoji enum table** — canonical machine copy in
[`configs/emotion_text/irodori.json`](https://github.com/yw0nam/YUI/blob/main/configs/emotion_text/irodori.json),
documented in [`irodori.md`](./irodori.md). YUI publishes it as
`update_emotion_text("enum", <emoji table>)`. In `enum` mode the broker greedily
tokenizes `emotion_text` by table keys and drops unknown tokens (with a
warning) — speech is never blocked. If the table cannot be loaded, YUI publishes
`update_emotion_text("free", null)` instead, so a missing file degrades to
pass-through rather than silencing the channel.

The broker keeps this state in-memory and ephemeral, so YUI re-publishes on
every boot and on every broker reconnect. The publish is gated only on
`broker_base_url` and runs independent of `chat_api` — Chat Completions mode
publishes and is read back by its backend agent exactly like Responses mode.

## See also

- [`client-context.md`](../client-context.md) —
  the `generate_express` cue contract handed to the backend agent (the
  `emotion_id` / `motion_id` / `emotion_text` fields and streaming shape).
- [`src/contract/types.ts`](https://github.com/yw0nam/YUI/blob/main/src/contract/types.ts) — the control
  envelope shape (contract source of truth).
