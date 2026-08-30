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
  // the one voice failure the settings panel resolves — the chip becomes the fix
  "voice.error.not_configured": "Setup needed",
  "voice.error.not_configured_fix": "backend not configured — open Advanced settings",

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
  "aria.dismiss_bubble": "Dismiss speech bubble",
  "aria.dismiss_error": "Dismiss error",
  "input.placeholder": "Say something…",
  "input.error_auth": "Auth failed · check API key",
  "input.error_network": "No response · check connection",
  "input.error_stall": "Backend stopped responding",
  "input.error_parse": "Response parse failed",
  "input.error_not_configured": "Backend not configured",
  "input.error_open_advanced": "Open Advanced",
  "input.attach_too_many": "Too many images · up to {max} per turn",
  "input.attach_too_large": "Image too large · up to {max}MB each",

  // chain-break (404) recovery notice
  "chain.reset_notice": "Conversation context was reset",
  "hotkey.register_failed":
    "Summon hotkey {accelerator} could not be registered — another app may hold it",
  "ingress.dead_notice":
    "Agent event listener failed to start (port {port} in use) — agent notifications are off this session",

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
  "devtools.label": "Developer Tools",
  "devtools.sub": "Inspect sent context and preview motions",
  "devtools.open": "Open",
  "devtools.nav_aria": "Developer tools sections",
  "devtools.nav.context": "Context Inspector",
  "devtools.nav.advanced": "Advanced Settings",
  "devtools.nav.motion": "Motion Preview",
  "devtools.loading_motion": "Loading motion preview…",
  "devtools.motion_load_failed": "Motion preview failed to load. Select this tab to retry.",
  "devtools.inspector.turns_aria": "Recent turns",
  "devtools.inspector.empty_title": "No sent context yet",
  "devtools.inspector.empty_sub": "Successful turns appear here.",
  "devtools.advanced.limits": "Limits",
  "devtools.advanced.context_window_label": "Context window (tokens)",
  "devtools.advanced.context_window_sub": "Empty uses the bundled endpoint configuration",
  "devtools.advanced.context_window_default": "Default",

  // tabs
  "tabs.talk": "Talk",
  "tabs.char": "Character",
  "tabs.input": "Input",
  "tabs.adv": "Advanced",
  "tabs.react": "Proactive",
  "tabs.react_hint": "Rules for when YUI speaks up first",
  "tabs.hist": "History",

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
  "filler.repeat_sub":
    "After the first line, replays a few times with growing pauses, then falls back to the long wait line",
  "filler.repeat_aria": "Repeat line list",
  "filler.hint": "Leave a list empty to use its default phrases. One per line.",
  "filler.more": "More phrases",
  "filler.long_wait_label": "Long wait line",
  "filler.long_wait_sub": "Plays once if the repeats run out and a reply still hasn't arrived",
  "filler.long_wait_aria": "Long wait line list",
  "filler.timeout_label": "Timeout line",
  "filler.timeout_sub": "Plays when a reply takes too long and YUI gives up waiting",
  "filler.timeout_aria": "Timeout line list",
  "filler.unreachable_label": "Connection lost line",
  "filler.unreachable_sub": "Plays when the backend can't be reached",
  "filler.unreachable_aria": "Connection lost line list",
  "filler.tool_label": "Tool lines",
  "filler.tool_sub":
    'One per line. "terminal = Running that..." targets a tool by id; a plain line is the shared fallback',
  "filler.tool_aria": "Tool line list",

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
  "vrm.remove_confirm": "Delete?",
  "vrm.remove_confirm_aria": "Delete? {name}",
  "vrm.name_aria": "VRM name",
  "vrm.import_overwrite_warn": "replaces the existing model of this name",
  "vrm.rename_hint_save": "save",
  "vrm.rename_hint_cancel": "cancel",
  "vrm.loading": "Loading…",
  "vrm.swapping": "Switching…",
  "vrm.swap_error": "Could not load this model. Reverted to the previous one.",

  // speaker section
  "speaker.section": "Voice",
  "speaker.group_aria": "Speaker",
  "speaker.add": "Add from file…",
  "speaker.import_error": "Could not upload this voice. Check the audio file and the TTS server.",
  "speaker.in_use": "In use",
  "speaker.rename": "Rename",
  "speaker.remove": "Delete",
  "speaker.remove_confirm": "Delete?",
  "speaker.remove_confirm_aria": "Delete? {name}",
  "speaker.refresh": "Refresh reference voice",
  "speaker.preview": "Preview",
  "speaker.name_aria": "Speaker name",
  "speaker.rename_hint_save": "save",
  "speaker.rename_hint_cancel": "cancel",
  "speaker.import_overwrite_warn": "replaces the existing voice of this name",
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

  // idle motion selection (labels keyed by the variant file stem)
  "idle_motion.section": "Idle motion",
  "idle_motion.group_aria": "Idle motion selection",
  "idle_motion.always_on": "always on",
  "idle_motion.calm.label": "Standing calmly",
  "idle_motion.calm.sub": "Baseline pose, hands folded in front",
  "idle_motion.idle_01.label": "Playful gesture",
  "idle_motion.idle_01.sub": "Hands framed at the chest with a slight turn",
  "idle_motion.idle_04.label": "Touching her hair",
  "idle_motion.idle_04.sub": "A coy three-quarter turn, one hand to her hair",
  "idle_motion.idle_12.label": "Leaning on one hip",
  "idle_motion.idle_12.sub": "Weight shifted to one side with a subtle head tilt",

  // express motion (agent-selectable motion vocabulary)
  "express_motion.section": "Expression motion",
  "express_motion.sub":
    "Motions she may pick while talking — turning one off drops it from her vocabulary",
  "express_motion.group_aria": "Expression motion selection",
  "express_motion.count": "{on}/{total} on",
  "express_motion.master_aria": "All of {group}",
  "express_motion.group.reaction": "Emotional reactions",
  "express_motion.group.action": "Actions · states",
  "express_motion.group.other": "Other",
  "express_motion.happy.label": "Happy",
  "express_motion.happy.sub": "A delighted reaction",
  "express_motion.laugh.label": "Laugh",
  "express_motion.laugh.sub": "Laughing out loud",
  "express_motion.embarrassed.label": "Embarrassed",
  "express_motion.embarrassed.sub": "A shy, finger-fidgeting gesture",
  "express_motion.sheepish.label": "Sheepish",
  "express_motion.sheepish.sub": "An awkward gesture, one hand to her head",
  "express_motion.calm.label": "Calm",
  "express_motion.calm.sub": "Standing calmly, hands folded in front",
  "express_motion.sulk.label": "Sulk",
  "express_motion.sulk.sub": "A pouting, turned-away gesture",
  "express_motion.idle_lively.label": "Lively fidget",
  "express_motion.idle_lively.sub": "A brief burst of livelier movement",
  "express_motion.sleeping.label": "Sleeping",
  "express_motion.sleeping.sub": "Lies down on her side and sleeps",
  "express_motion.dance.label": "Dance",
  "express_motion.dance.sub": "Random, from a short step to a full routine",

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
  "screenshot.monitors_error": "Could not load the display list.",
  "screenshot.monitors_empty": "No displays found.",
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
  "bubble_persist.label": "Keep bubble until dismissed",
  "bubble_persist.sub": "The speech bubble stays on screen until you close it",
  "bubble_persist.aria": "Keep speech bubble until dismissed",

  // history tab
  "history.current": "Current conversation",
  "history.turns": "{n} turns",
  "history.who_user": "You",
  "history.who_yui": "YUI",
  "history.empty": "Nothing has been said yet",
  "history.foot": "Last 200 turns · stored on this device only",

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
  "endpoints.broker_base_url.label": "Expression broker URL",
  "endpoints.chat_model.label": "Chat model",

  // per-service sections (advanced tab)
  "svc.type_label": "Type",
  "svc.chat": "Chat",
  "svc.chat_aria": "Chat API type",
  "svc.chat_type_responses": "Responses API",
  "svc.chat_type_completions": "Chat Completions",
  "svc.chat_preset_label": "Provider",
  "svc.chat_preset_aria": "Chat provider preset",
  "svc.chat_preset_custom": "Custom",
  "svc.stt": "STT",
  "svc.stt_hint": "OpenAI-compatible",
  "svc.stt_type": "OpenAI-compatible",
  "svc.tts": "TTS",
  "svc.tts_hint": "OpenAI-compatible",
  "svc.tts_type": "OpenAI-compatible",
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
  "gaze.label": "Follow cursor",
  "gaze.sub": "The character turns its eyes and head to follow your mouse cursor.",
  "gaze.aria": "Follow cursor",
  "climb.label": "Window climbing",
  "climb.sub": "Climbs up and sits on other windows now and then (in development).",
  "climb.aria": "Window climbing",
  "agentNotify.label": "Agent notifications",
  "agentNotify.sub":
    "Speaks up when a coding agent (Claude Code, opencode, …) finishes a task or needs your input on your machine.",
  "agentNotify.aria": "Agent notifications",

  // first-run onboarding hint
  "hint.first_run": "Right-click me for controls · press {hotkey} to talk",
  "hint.first_run_no_hotkey": "Right-click me for controls",
  "hint.setup_backend":
    "I have no backend to think with yet — right-click me, open Advanced, and point me at an OpenAI-compatible server",

  // reactions tab
  "reactions.watchers_title": "Watchers",
  "reactions.shared_title": "Shared",
  "reactions.port_label": "Listener port",
  "reactions.port_sub": "Port the completion hook server listens on",
  "reactions.presence_label": "Present when idle for",
  "reactions.presence_sub": "Treat the session as present if the idle gap is below this",
  "reactions.seconds_suffix": "s",
  "reactions.restart_hint": "Restart the app to apply this change",
  "reactions.pacer_gap_label": "Proactive gap",
  "reactions.pacer_gap_sub": "Minimum quiet gap after any turn before YUI speaks up on her own",
  "reactions.pacer_gap_hint": "0 lets every source speak up without waiting.",
  "reactions.minutes_suffix": "min",
  "reactions.rate_title": "Hourly limits",
  "reactions.rate_hint":
    "Backstop on how often YUI speaks up on her own. Your own messages are never counted. Empty means the shipped default.",
  "reactions.rate_tier2_label": "Cues per hour",
  "reactions.rate_tier2_sub": "Idle, proactive, schedule, and agent cues together",
  "reactions.rate_overall_label": "Total self-started turns per hour",
  "reactions.rate_overall_sub": "Crossing it holds every cue for a cooldown",
  "reactions.rate_hint_text":
    "Ceiling on how many times YUI may speak up on her own in an hour. Turns you start are never counted.",

  // screen watch (proactive tab)
  "screen.section": "Screen watch",
  "screen.hint":
    "Notices when you move between apps or stay on one thing for a long stretch, and speaks up. Whether screen pixels are sent still follows the screenshot toggle in the Input tab.",
  "screen.label": "React to screen changes",
  "screen.sub": "Notices app switches and long stretches, then speaks up first",
  "screen.aria": "React to screen changes",
  "screen.min_gap_label": "Minimum gap between cues",
  "screen.min_gap_aria": "Minimum gap between screen-watch cues",
  "screen.min_gap_value": "{n} min",
  "screen.minutes_suffix": "min",
  "screen.seconds_suffix": "s",
  "screen.prev_dwell_label": "Counts as an app switch after",
  "screen.prev_dwell_sub": "Only when the app you left was held this long",
  "screen.settle_label": "New app settles after",
  "screen.settle_sub": "A quick glance is ignored",
  "screen.long_session_label": "Notices a long stretch every",
  "screen.long_session_sub": "One app held this long counts as a long session",
  "screen.quiet_label": "Stay quiet after a turn for",
  "screen.quiet_sub": "So a cue never piles onto what was just said",
  "screen.recent_cap_label": "Remembers up to",
  "screen.recent_cap_sub":
    "How many app switches held during a pause carry into the next screen turn",
  "screen.count_suffix": "entries",
  "screen.foot":
    "Sending screen pixels follows the screenshot toggle in the Input tab. Nothing is said while do-not-disturb is on.",

  // workflows
  "workflows.title": "Workflows",
  "workflows.sub":
    "Fire a saved endpoint on demand; ▶ runs it, and the first run doubles as your connection test.",
  "workflows.label_label": "Label",
  "workflows.label_ph": "e.g. Morning digest",
  "workflows.url_label": "URL",
  "workflows.url_ph": "https://…",
  "workflows.url_error": "Enter a valid URL, e.g. https://example.com/hook",
  "workflows.add": "Add",
  "workflows.empty": "No workflows yet; add one below.",
  "workflows.fire_aria": "Fire {name}",
  "workflows.delete_aria": "Delete {name}",

  // session
  "session.section": "Session",
  "session.context": "Context",
  "session.action_label": "Start fresh",
  "session.action_sub": "Start a new conversation. Everything so far stays in the list above.",
  "session.reset": "Reset conversation",
  "session.confirm_q": "Start over?",
  "session.confirm_go": "Start fresh",
  "session.confirm_cancel": "Cancel",
};

export default en;
