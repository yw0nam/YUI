/**
 * English strings — source of truth for the key set.
 * All tool.* keys stay English in every locale (not translated).
 */
const en: Record<string, string> = {
  // tool labels (English in all locales — AI tool-call status)
  "tool.web_search": "Searching…",
  "tool.browser": "Browsing…",
  "tool.terminal": "Running…",
  "tool.code": "Running…",
  "tool.python": "Running…",
  "tool.file": "Reading…",
  "tool.read_file": "Reading…",
  "tool.write_file": "Writing…",

  // voice state labels
  "voice.state.idle": "Idle",
  "voice.state.listening": "Listening…",
  "voice.state.processing": "Processing…",
  "voice.state.speaking": "Speaking…",
  "voice.state.asr": "Transcribing…",
  "voice.state.fired": "Sent",
  "voice.state.error": "Error",

  // aria labels (parameterized)
  "aria.refresh_speaker": "Refresh {name} reference voice",
  "aria.refresh_speaker_refreshing": "Refreshing {name} reference voice",
  "aria.refresh_speaker_done": "{name} reference voice refreshed",
  "aria.preview_speaker": "Preview {name}",
  "aria.voice_input": "Voice input: {label}",

  // surfaces (speech bubble · tool-status · text input)
  "aria.attach_image": "Attach image",
  "aria.input_field": "Talk to YUI",
  "aria.send": "Send",
  "aria.stop": "Stop",
  "aria.remove_attachment": "Remove attachment",
  "input.placeholder": "Say something…",
  "input.error_auth": "Auth failed · check API key",
  "input.error_network": "No response · check connection",
  "input.error_parse": "Response parse failed",

  // boot-failure notice
  "boot.error_title": "YUI failed to start",
  "boot.error_config": "Could not load settings — {file}",
  "boot.error_vrm": "No VRM model found — put a .vrm file in resources/vrms/ and restart.",
  "boot.error_dismiss": "Dismiss",

  // capture indicator
  "capture.watching": "Watching your screen",

  // cue-list internal labels
  "cue.time_aria": "Time",
  "cue.greeting_time_aria": "Greeting time",
  "cue.minutes_word": "Inactive",
  "cue.minutes_aria": "Inactive minutes",
  "cue.minutes_suffix": "min",
  "cue.toggle_aria": "Toggle {name}",
  "cue.toggle_fallback": "Cue",
  "cue.delete": "Delete",
  "cue.confirm_q": "Delete this cue?",
  "cue.confirm_go": "Delete",
  "cue.confirm_cancel": "Cancel",
  "cue.name_label": "Name",
  "cue.name_aria": "Name",
  "cue.ctx_label": "Context",
  "cue.ctx_aria": "Context for the AI to read",
  "cue.ctx_placeholder": "Freely describe the situation for the AI to refer to…",

  // panel chrome
  "panel.dialog_label": "Settings",
  "panel.title": "Settings",
  "panel.tablist_label": "Settings area",
  "panel.drag_hint": "Drag to move",
  "panel.pop_out": "Pop out to window",
  "panel.close": "Close",
  "panel.rail_collapse": "Collapse sections rail",
  "panel.rail_expand": "Expand sections rail",

  // tabs
  "tabs.talk": "Talk",
  "tabs.char": "Character",
  "tabs.input": "Input",
  "tabs.adv": "Advanced",
  "tabs.react": "Reactions",

  // reasoning effort segment
  "reasoning.label": "Reasoning effort",
  "reasoning.sub": "How deeply to think before answering",
  "reasoning.none": "None",
  "reasoning.minimal": "Minimal",
  "reasoning.low": "Low",
  "reasoning.medium": "Medium",

  // instructions
  "instructions.label": "Instructions",
  "instructions.sub": "Leave empty to use the default instructions",
  "instructions.reset": "Reset to default",
  "instructions.placeholder_default": "Using the default instructions",

  // filler (thinking interjections)
  "filler.section": "Thinking interjections",
  "filler.enable_label": "Use interjections",
  "filler.enable_sub": "Say short lines while waiting for a reply",
  "filler.lang_label": "Language",
  "filler.lang_sub": "Language to speak interjections in",
  "filler.lang_aria": "Interjection language",
  "filler.first_label": "First line",
  "filler.first_sub": "Plays once immediately when a user message arrives",
  "filler.first_aria": "First line list",
  "filler.repeat_label": "Repeat lines",
  "filler.repeat_sub": "After the first line, replays every second until a response arrives",
  "filler.repeat_aria": "Repeat line list",
  "filler.hint": "Leave both lists empty to use the default phrases. One per line.",

  // language picker
  "language.label": "Language",
  "language.sub": "Display language for this app",
  "language.aria": "Display language",

  // VRM section
  "vrm.section": "VRM",
  "vrm.group_aria": "VRM",
  "vrm.add": "Add from file…",
  "vrm.import_error": "Could not load this file. Check that it is a VRM file.",
  "vrm.in_use": "In use",
  "vrm.rename": "Rename",
  "vrm.remove": "Delete",
  "vrm.name_aria": "VRM name",
  "vrm.rename_hint_save": "save",
  "vrm.rename_hint_cancel": "cancel",
  "vrm.loading": "Loading…",
  "vrm.swapping": "Switching…",
  "vrm.swap_error": "Could not load this model. Reverted to the previous one.",

  // speaker section
  "speaker.section": "Voice",
  "speaker.engine_label": "Voice engine",
  "speaker.engine_sub": "Synthesis engine that creates the character voice",
  "speaker.engine_aria": "Voice engine",
  "speaker.engine_irodori": "irodori",
  "speaker.engine_openai": "OpenAI-compatible",
  "speaker.openai_hint":
    "irodori only. The OpenAI-compatible engine speaks with the voice configured on the server.",
  "speaker.group_aria": "Speaker",
  "speaker.add": "Add from file…",
  "speaker.import_error":
    "Could not register this voice. Check the audio file and the irodori server.",
  "speaker.in_use": "In use",
  "speaker.rename": "Rename",
  "speaker.remove": "Delete",
  "speaker.refresh": "Refresh reference voice",
  "speaker.preview": "Preview",
  "speaker.name_aria": "Speaker name",
  "speaker.rename_hint_save": "save",
  "speaker.rename_hint_cancel": "cancel",
  "speaker.loading": "Loading…",
  "speaker.swapping": "Switching…",
  "speaker.refreshing": "Refreshing…",
  "speaker.swap_error": "Could not load this speaker. Reverted to the previous one.",
  "speaker.refresh_error": "Could not refresh the reference voice.",
  "speaker.refresh_done": "Reference voice refreshed.",

  // expression (lipsync gain)
  "expression.section": "Expression",
  "expression.mouth_label": "Mouth movement",
  "expression.mouth_sub": "How wide the mouth opens with voice volume",
  "expression.mouth_aria": "Mouth movement",
  "expression.mouth_hint": "Dragging opens the character's mouth that much in real time",

  // viewpoint (camera orbit)
  "viewpoint.section": "Viewpoint",
  "viewpoint.sub": "Shift + drag to orbit, scroll to zoom",
  "viewpoint.reset": "Reset to front",

  // screenshot / input tab
  "screenshot.label": "Attach screenshot",
  "screenshot.sub": "See your screen together while talking",
  "screenshot.source_label": "Screen to send",
  "screenshot.source_aria": "Screen to send",
  "screenshot.monitor_primary": "Primary",
  "screenshot.display": "Display {n}",
  "screenshot.foot_on": "While on, this screen is attached to every message.",
  "screenshot.foot_off": "Off by default. Turn on to send your screen too.",

  // voice input
  "voice_input.label": "Voice input",
  "voice_input.sub": "When you stop speaking, STT runs and sends it as user input",
  "voice_input.aria": "Voice input",
  "voice_input.silence_label": "Silence threshold",
  "voice_input.silence_sub": "Waits this long after speech ends before sending",
  "voice_input.silence_aria": "Silence threshold",
  "voice_input.bargein_label": "Barge-in",
  "voice_input.bargein_aria": "Barge-in (character stops when you speak)",

  // TTS output toggle
  "tts_output.label": "Voice output",
  "tts_output.sub": "Read replies aloud with TTS; off shows text only",
  "tts_output.aria": "Voice output",

  // cue lists (input tab)
  "cue.schedule_title": "Scheduled greeting",
  "cue.schedule_sub": "Greets you first if you're at your desk at the set time",
  "cue.schedule_add": "+ Add greeting",
  "cue.proactive_title": "Loop reaction",
  "cue.proactive_sub": "Checks in on a repeating schedule if you've been quiet at work",
  "cue.proactive_add": "+ Add reaction",

  // endpoints
  "endpoints.section": "Endpoints",
  "endpoints.summary_hint": "Advanced — server addresses · model",
  "endpoints.field_sub": "Leave empty to use the default",
  "endpoints.reset": "Reset to default",
  "endpoints.url_error": "Not a valid URL (http:// or https://)",
  "endpoints.chat_base_url.label": "Chat server URL",
  "endpoints.stt_base_url.label": "Speech recognition (STT) server URL",
  "endpoints.tts_base_url.label": "Speech synthesis (TTS) server URL",
  "endpoints.irodori_base_url.label": "irodori server URL",
  "endpoints.broker_base_url.label": "Expression broker URL",
  "endpoints.chat_model.label": "Chat model",

  "endpoints.tts_voice.label": "TTS voice",

  // per-service sections (advanced tab)
  "svc.type_label": "Type",
  "svc.chat": "Chat",
  "svc.chat_aria": "Chat API type",
  "svc.chat_type_responses": "Responses API",
  "svc.chat_type_completions": "Chat Completions",
  "svc.stt": "STT",
  "svc.stt_hint": "OpenAI-compatible",
  "svc.stt_type": "OpenAI-compatible",
  "svc.tts": "TTS",
  "svc.tts_aria": "TTS engine",
  "svc.broker": "Broker",
  "svc.broker_hint": "MCP streamable-http",
  "svc.broker_type": "MCP streamable-http",
  "svc.reset_chat": "Reset Chat",
  "svc.reset_stt": "Reset STT",
  "svc.reset_tts": "Reset TTS",
  "svc.reset_broker": "Reset Broker",

  // chat API key
  "chatkey.section": "Chat API key",
  "chatkey.label": "Chat API key",
  "chatkey.sub_default": "Using the default — leave empty to use the build-time key",
  "chatkey.sub_override": "Saved on this device — clear to return to the original key",
  "chatkey.show": "Show key",
  "chatkey.hide": "Hide key",
  "chatkey.clear": "Clear key",

  // STT API key
  "sttkey.label": "STT API key",
  "sttkey.sub_default": "Using the default — leave empty to use the build-time key",
  "sttkey.sub_override": "Saved on this device — clear to return to the original key",
  "sttkey.show": "Show key",
  "sttkey.hide": "Hide key",
  "sttkey.clear": "Clear key",

  // TTS API key
  "ttskey.label": "TTS API key",
  "ttskey.sub_default": "Using the default — leave empty to use the build-time key",
  "ttskey.sub_override": "Saved on this device — clear to return to the original key",
  "ttskey.show": "Show key",
  "ttskey.hide": "Hide key",
  "ttskey.clear": "Clear key",

  // performance
  "perf.section": "Performance",
  "perf.idle_label": "Power saving when idle (30fps)",
  "perf.idle_sub":
    "Lowers the frame rate while the character is still to save power. It smooths out automatically when speaking or moving.",
  "perf.idle_aria": "Power saving when idle",
  "gaze.label": "Look at camera",
  "gaze.sub": "The character turns its eyes and head to follow the camera viewpoint.",
  "gaze.aria": "Look at camera",
  "agentNotify.label": "Agent completion notifications",
  "agentNotify.sub":
    "Speaks up when a coding agent (Claude Code, opencode, …) finishes a task on your machine.",
  "agentNotify.aria": "Agent completion notifications",

  // reactions tab
  "reactions.watchers_title": "Watchers",
  "reactions.shared_title": "Shared",
  "reactions.port_label": "Listener port",
  "reactions.port_sub": "Port the completion hook server listens on",
  "reactions.presence_label": "Present when idle for",
  "reactions.presence_sub": "Treat the session as present if the idle gap is below this",
  "reactions.seconds_suffix": "s",
  "reactions.restart_hint": "Restart the app to apply this change",
  "reactions.recent_apps_label": "Recent apps to remember",
  "reactions.recent_apps_sub": "How many recent app switches ride along on the next message",

  // session
  "session.section": "Session",
  "session.context": "Context",
  "session.action_label": "Start fresh",
  "session.action_sub": "Start a new conversation. YUI keeps the current memory until you do.",
  "session.reset": "Reset conversation",
  "session.confirm_q": "Start over?",
  "session.confirm_go": "Start fresh",
  "session.confirm_cancel": "Cancel",
};

export default en;
