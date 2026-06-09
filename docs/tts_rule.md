# TTS tool

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

Emotion string for controlling TTS. The vocabulary is **provider-dependent** — the authoritative per-provider rule set lives in [`tts_emotion/`](./tts_emotion/) (enforced at runtime by the Expression Broker MCP gate).

- **irodori (default provider):** inline **emoji tags** in the text, e.g. `👂 Can you hear me?`, `😆 I can't believe you said that.` Repeat an emoji to intensify. Broker mode `enum`. → [`tts_emotion/irodori.md`](./tts_emotion/irodori.md)
- **openai-compatible (legacy fishspeech path):** free text like `[whisper in small voice]`, `[laughing]`. Broker mode `free`. → [`tts_emotion/fishspeech.md`](./tts_emotion/fishspeech.md)

Either way the client prepends the tag to the spoken text and passes it through verbatim — and the tag is never shown in the speech bubble. See also [`tts_emotion/README.md`](./tts_emotion/README.md) for the provider-switch re-publish contract and [`contract.md`](./contract.md) `[D-EMOTION-TEXT]`.



## Open question.

- What is the SOT of emotion and motion?
- How to syncronize emotion and motion with client and backend?

## Suggenstion

Make MCP server that expose motion_id, emotion_id.

MCP server expose below tools:

- get_ids: return list of emotion_ids and motion ids
- update_motion_ids: update motion_ids in realtime. UI Clinet watch update_motion_ids. If update_motion_ids is changed, UI Client update motion_ids.
- update_emotion_ids: update emotion_ids in realtime. UI Clinet watch update_emotion_ids. If update_emotion_ids is changed, UI Client update emotion_ids.
- generate_config: generate emotion_id, motion_id, and emotion text below format. 

```json
{
    "emotion_id": "emotion_id",
    "motion_id": "motion_id",
    "emotion_text": "emotion_text"
}
```

