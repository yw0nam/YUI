# TTS Rule — `generate_express` payload & emotion_text

## Return value

```json
{
    "emotion_id": "emotion_id",
    "motion_id": "motion_id",
    "emotion_text": "emotion_text"
}
```

for example:

```json
{
    "emotion_id": "happy",
    "motion_id": "happy",
    "emotion_text": "[whisper in small voice] Can you hear me?"
}
```


### emotion_id(string)

Emotion id for blendshapes. These ids are fixed by UI Client so can't be changed. Not used in TTS

- neutral
- happy
- angry
- sad
- relaxed
- surprised
- thinking
- curious
- sleepy
- embarrassed

### motion_id

motion_id(string) for VRMA. These ids are fixed by UI client, not used in TTS. If there is no matching motion_id in client, client fallback to previous motion or idle motion.

current motion_id set is: 

- idle
- happy
- laughing
- shy_point

### emotion_text(string)

Emtoion string for control TTS. These text can be varied by TTS model.

Currently, TTS model is fishspeech s2 pro. So, emotion text is free text like: [whisper in small voice], [professional broadcast tone], [pitch up]. And also be like [pause] [emphasis] [laughing] [inhale] [chuckle] [tsk] [singing] [excited] [laughing tone] [interrupting] [chuckling] [excited tone] [volume up] [echo] [angry] [low volume] [sigh] [low voice] [whisper] [screaming] [shouting] [loud] [surprised] [short pause] [exhale] [delight] [panting] [audience laughter] [with strong accent] [volume down] [clearing throat] [sad] [moaning] [shocked]

In client, these free text like this:


[whisper in small voice] Can you hear me?
[laughing] I can't believe you said that.

And, These can be used together for fine-grained control.

[whisper in small voice] Can you hear me? [pause] I can't believe you said that.



## Resolved decisions (2026-06-05)

- **SOT for emotion/motion vocabulary** — Expression Broker MCP @ `localhost:3201`. YUI publishes renderable ids on boot/hot-swap; Hermes reads `get_ids` or subscribes to `expression://vocabulary` resource.
- **Sync channel** — `generate_express` arguments flow through the `/v1/responses` function_call stream. No separate sync protocol needed. See [`expression-broker-mcp.md`](./expression-broker-mcp.md) §5.
- **`emotion_tts_prefix.json`** — deprecated. `emotion_text` free-text (FishSpeech S2 pro tags) supersedes the enum→prefix map entirely.

## Expression Broker MCP (already implemented, live @ localhost:3201)

The Expression Broker is an **independent MCP server already running at `localhost:3201`**. It exposes the vocabulary SOT and the `generate_express` firing tool. See [`expression-broker-mcp.md`](./expression-broker-mcp.md) for the full spec.

Tools exposed:

- `get_ids` — returns current `{ emotion_ids, motion_ids, version }` (Hermes agent calls this to know valid enum values)
- `update_emotion_ids(ids)` — YUI pushes its renderable emotion id set (on boot + VRM hot-swap)
- `update_motion_ids(ids)` — YUI pushes its renderable motion id set
- `generate_express(emotion_id?, motion_id?, emotion_text?)` — Hermes agent calls this per turn; the resulting `function_call` appears in the `/v1/responses` stream for YUI to consume
- Resource: `expression://vocabulary` — push notification when vocabulary changes

The return-value shape of `generate_express` confirms validation; the **transport payload** (what YUI consumes) is the flat `{ emotion_id?, motion_id?, emotion_text? }` arguments in the stream.

