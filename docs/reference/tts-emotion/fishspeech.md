# `emotion_text` rule — openai-compatible / fishspeech

| | |
|---|---|
| provider | OpenAI-compatible (default; legacy fishspeech path) |
| `tts_provider` | `"openai"` |
| broker mode | `free` |
| table | `null` |

`emotion_text` is **free text** in square-bracket tags, prepended to the spoken
text — e.g. `[whisper in small voice]`, `[soft chuckle]`, `[excited] [volume up]`.

There is no client-side validation. YUI publishes
`update_emotion_text("free", null)`, and the broker passes `emotion_text`
through unchanged (no enum gate). The tag is prefix-only and never shown in the
speech bubble.
