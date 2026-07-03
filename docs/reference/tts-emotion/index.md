# `emotion_text` per-provider vocabulary rules

> Human source of truth (SOT) for each TTS provider's `emotion_text` rule. The
> **Expression Broker MCP** enforces these rules at runtime via its
> `emotion_text` gate; the files here are what a human or agent reads to know
> each provider's rule.

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
[`backend-contract.md`](../backend-contract.md);
the control envelope shape lives in
[`src/contract/types.ts`](https://github.com/yw0nam/YUI/blob/main/src/contract/types.ts).

## Provider-switch contract (mandatory)

`emotion_text` vocabulary is **provider-dependent**. Whenever `tts_provider`
changes in [`configs/endpoints.json`](https://github.com/yw0nam/YUI/blob/main/configs/endpoints.json), YUI MUST
re-publish the broker's `emotion_text` gate via
`update_emotion_text(mode, table)` so the gate matches the new provider:

| provider | broker mode | table source | doc |
|---|---|---|---|
| `irodori` (default) | `enum` | irodori emoji table — canonical machine copy in `configs/` | [`irodori.md`](./irodori.md) |
| `openai` (OpenAI-compatible, legacy fishspeech) | `free` | `null` (free-text bracket tags) | [`fishspeech.md`](./fishspeech.md) |

- `irodori` ⇒ `update_emotion_text("enum", <irodori emoji table>)`. In `enum`
  mode the broker greedily tokenizes `emotion_text` by table keys and drops
  unknown tokens (with a warning) — speech is never blocked.
- `openai` (OpenAI-compatible / legacy fishspeech) ⇒
  `update_emotion_text("free", null)`. Pass-through, no validation.

The broker keeps this state in-memory and ephemeral, so YUI re-publishes on
every boot and on every broker reconnect. This publish (and re-publish on
provider switch) is gated only on `broker_base_url` and runs independent of
`chat_api` — Chat Completions mode publishes and is read back by its backend
agent exactly like Responses mode.

## Adding a new provider

1. Add `docs/reference/tts-emotion/<provider>.md` documenting its rule.
2. If the provider uses an `enum` table, add the canonical machine copy under
   `configs/` (no-hardcoding rule).
3. Ensure YUI's provider-switch path publishes the right `(mode, table)` for
   the provider via `update_emotion_text`.

## See also

- [`backend-contract.md`](../backend-contract.md) —
  the `generate_express` cue contract handed to the backend agent (the
  `emotion_id` / `motion_id` / `emotion_text` fields and streaming shape).
- [`src/contract/types.ts`](https://github.com/yw0nam/YUI/blob/main/src/contract/types.ts) — the control
  envelope shape (contract source of truth).
