# `emotion_text` per-provider vocabulary rules

> Human source of truth (SOT) for each TTS provider's `emotion_text` rule. The
> **Expression Broker MCP** enforces these rules at runtime via its
> `emotion_text` gate; the files here are what a human or agent reads to know
> each provider's rule.

## What `emotion_text` is

`emotion_text` is the **voice/TTS control channel** of `generate_express` — an
independent channel from `emotion_id` (the VRM face blendshape). A happy face
(`emotion_id`) and a whispered voice (`emotion_text`) can fire at the same time.
The Hermes agent produces `emotion_text`; YUI consumes whatever arrives on the
`/v1/responses` stream and prepends it to the TTS segment (prefix-only — never
shown in the speech bubble). See
[`../expression-broker-mcp.md`](../expression-broker-mcp.md) and
[`../contract.md`](../contract.md) `[D-EMOTION-TEXT]`.

## Provider-switch contract (mandatory)

`emotion_text` vocabulary is **provider-dependent**. Whenever `tts_provider`
changes in [`configs/endpoints.json`](../../configs/endpoints.json), YUI MUST
re-publish the broker's `emotion_text` gate via
`update_emotion_text(mode, table)` so the gate matches the new provider:

| provider | broker mode | table source | doc |
|---|---|---|---|
| `irodori` (default) | `enum` | irodori emoji table — canonical machine copy in `configs/` | [`irodori.md`](./irodori.md) |
| `openai-compatible` (legacy fishspeech) | `free` | `null` (free-text bracket tags) | [`fishspeech.md`](./fishspeech.md) |

- `irodori` ⇒ `update_emotion_text("enum", <irodori emoji table>)`. In `enum`
  mode the broker greedily tokenizes `emotion_text` by table keys and drops
  unknown tokens (with a warning) — speech is never blocked.
- `openai-compatible` / fishspeech ⇒ `update_emotion_text("free", null)`.
  Pass-through, no validation.

The broker keeps this state in-memory and ephemeral, so YUI re-publishes on
every boot and on every broker reconnect.

## Adding a new provider

1. Add `docs/tts_emotion/<provider>.md` documenting its rule.
2. If the provider uses an `enum` table, add the canonical machine copy under
   `configs/` (no-hardcoding rule).
3. Ensure YUI's provider-switch path publishes the right `(mode, table)` for
   the provider via `update_emotion_text`.

## See also

- [`../expression-broker-mcp.md`](../expression-broker-mcp.md) — broker design,
  the wider `generate_express` tool fields (`emotion_id` / `motion_id` /
  `emotion_text`), and the `emotion_text` enum-gate.
- [`../contract.md`](../contract.md) — `[D-EMOTION-TEXT]`, the control envelope.
