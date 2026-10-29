# `emotion_text` vocabulary

> The client-declared `generate_express` tool carries the `emotion_text` table in its schema.

## What `emotion_text` is

`emotion_text` is the voice and TTS control channel of `generate_express`, separate from `emotion_id`, the VRM face blendshape. A happy face (`emotion_id`) and a whispered voice (`emotion_text`) can fire at the same time.

The model behind the active chat endpoint produces `emotion_text` through a `generate_express` tool call. YUI consumes whatever arrives, from the `/v1/responses` stream in Responses mode or identically from `chat.completion.chunk` tool-call deltas in Chat Completions mode, and hands it to the TTS provider beside the segment. It never shows in the speech bubble.

Irodori prepends it to the spoken text, OpenAI puts it in `instructions`, and Fish wraps it in `[...]` ahead of the spoken text (S2 inline direction).

In push mode the cue arrives in the `segments[].cues` of `render` and `speech` frames, and the client sends the vocabulary in its `hello` and `vocabulary` frames ([push transport](../../reference/push-transport.md)).

`generate_express` carries a second, independent voice channel beside it. `caption` is a free-text voice direction that travels out of band in the synthesis request. Irodori takes it as `irodori.caption`, OpenAI joins it after `emotion_text` in `instructions`, and Fish wraps it in its own `[...]` bracket after the `emotion_text` bracket. It has no vocabulary and no enum gate.

The cue contract that carries both channels is in [`client-context.md`](../../reference/client-context.md). The control envelope shape lives in [`src/contract/types.ts`](https://github.com/yw0nam/YUI/blob/main/src/contract/types.ts).

## Declared vocabulary

With `tts_provider` `irodori`, the vocabulary is the emoji enum table in [`configs/emotion_text/irodori.json`](https://github.com/yw0nam/YUI/blob/main/configs/emotion_text/irodori.json), documented in [`irodori.md`](./irodori.md). The client declares it in the tool schema.

If the table cannot be loaded, the vocabulary uses free text, and every other provider uses free text as well. A `tts_provider` change reloads the table for the declared tool schema and push `vocabulary` frames without a restart.

## See also

- [`client-context.md`](../../reference/client-context.md): the `generate_express` cue contract handed to the backend agent (the `emotion_id` / `motion_id` / `emotion_text` fields and streaming shape).
- [`src/contract/types.ts`](https://github.com/yw0nam/YUI/blob/main/src/contract/types.ts): the control envelope shape (contract source of truth).
