# Voice in and out

Speech out and speech in are separate optional services.

![Settings window, Voice page with the voice list](/shots/settings-voice.png)

## Speak

1. On **Connection**, pick a **Provider** in the TTS section: Irodori, OpenAI, or Fish Audio.
2. Enter the **TTS API key** if the service needs one.
3. On **Voice**, turn on **Voice output** and pick a voice from the list. **Preview** plays a sample for a voice with a reference clip.

## Listen

![Settings window, Listening and bubble page](/shots/settings-listening.png)

1. On **Connection**, enter the **Speech recognition (STT) server URL**. Any OpenAI-compatible transcription server works.
2. On **Listening and bubble**, turn on **Voice input**, and enter the **STT API key** if the server needs one.
3. Speak. When you stop, the audio goes to STT and arrives as your message.

## Providers

| Provider | Kind | Needs |
| --- | --- | --- |
| Irodori | TTS | An Irodori TTS server on port 8088, and the model `irodori-tts` |
| OpenAI | TTS | An OpenAI key, and the model `gpt-4o-mini-tts` |
| Fish Audio | TTS | A Fish Audio key, and the model `s2.1-pro-free` |
| OpenAI-compatible | STT | A server URL that includes `/v1`, plus a model such as `whisper-large-v3-turbo` on a hosted API |

## Tips

- Irodori serves Japanese only, so ask your backend to answer in Japanese.
- OpenAI lists its 13 built-in voices, and import and delete are off for that provider.
- A voice from Fish Audio's public library works when you paste its voice id or page URL under the list.

## Go deeper

- [Configuration](../reference/configuration.md): every voice key, and what each provider sends.
- [TTS Emotion](tts-emotion/): the `emotion_text` vocabulary.
