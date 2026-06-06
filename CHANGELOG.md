# Changelog

All notable changes to YUI are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The project is
pre-release (`0.0.0`); everything below sits under `[Unreleased]` and release
dates are TBD until the first tagged release.

## [Unreleased]

### Rendering (VRM)

- VRM load + hot-swap from config (#32).
- VRMA motion playback + dev motion/emotion preview (#40).
- Emotion → VRM expression via `setEmotion`, with existence-aware fallback chain (#41).
- `applyDirective` wiring from control envelope into the renderer (#43).
- Tier-1 ambient layer — blink / idle sway / breath / look-around, backend-independent (#10, #35).
- Amplitude-based lip sync — mouth blendshape driven by playback amplitude envelope (#15, #62).

### Voice & Audio

- Client-side TTS pipeline — queue → sentence-split → per-sentence TTS → ordered playback (#14, #48).
- STT + VAD pipeline + voice-input UI (#19, #59, #64).
- Default TTS reference voice (#50).

### I/O & Transport

- Chat client over the OpenAI Responses SSE stream (`/v1/responses`) (#13, #36).
- Hermes auth via SecretProvider (#38).
- Tauri `cors-fetch` transport to bypass CORS with SSE streaming (#44).
- Web dev-proxy transport for browser-only runs (#50).

### UI Surfaces

- Interaction surfaces — speech bubble / input / tool-status (#34).
- Inline markdown render + `tool_status` label map (#61).

### Input & Context

- Monitor screenshot capture / attach (#20, #60).
- `input_context` auto-attach — `{timestamp, timezone, active_app, active_window_title}` (#18, #70).

### OS / Shell

- Transparent always-on-top pet window.
- OS-native window drag + multi-monitor DPI handling (#9, #45).
- `os_event_watcher` real macOS OS polling — active app / idle / fullscreen via
  CGEventSource · NSWorkspace · CGWindowList, with a Windows stub (#26, #56, #66).

### Contract

- `generate_express` flat-args refactor — `{emotion_id?, motion_id?, emotion_text?}`;
  `should_speak` removed (D-NO-SPEAK-GATE); free-text `emotion_text` voice channel (#63).
- Removed the deprecated `emotion_tts_prefix` enum→prefix map, reframed to `emotion_text` (#3, #65).

### Config

- File-based config loader with polling hot-reload (#22, #37).

### Dispatcher

- Event-bus + classify → route spine (#21, #47).

### Tooling

- vitest + `cargo test` unit structure + CI (#31).
