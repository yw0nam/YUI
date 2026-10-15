globalThis.YUI_MAP =
{
  "title": "Hermes YUI platform plugin",
  "zones": [
    {
      "id": "socket",
      "title": "Client socket",
      "note": "frames in and out, held replies"
    },
    {
      "id": "turn",
      "title": "Turn work",
      "note": "the answer's sentences and cues, and what the agent does beside them"
    },
    {
      "id": "shared",
      "title": "Shared state and wiring",
      "note": "read by the modules above; no lines drawn"
    }
  ],
  "modules": [
    {
      "id": "client",
      "label": "YUI client",
      "kind": "external",
      "col": 0,
      "row": 1,
      "desc": "Opens one WebSocket on /ws, sends turns, renders the frames that come back"
    },
    {
      "id": "adapter",
      "label": "Socket adapter",
      "kind": "module",
      "col": 1,
      "row": 1,
      "zone": "socket",
      "desc": "WebSocket server, frame routing, gateway messages, replies held for an away client"
    },
    {
      "id": "speech",
      "label": "Speech stream",
      "kind": "module",
      "col": 2,
      "row": 0,
      "zone": "turn",
      "desc": "The streamed answer cut into finished sentences for speech frames"
    },
    {
      "id": "express",
      "label": "Expression cues",
      "kind": "module",
      "col": 3,
      "row": 0,
      "zone": "turn",
      "desc": "generate_express schema from the vocabulary, the cue gate, cue placement on sentences"
    },
    {
      "id": "gateway",
      "label": "Gateway",
      "kind": "external",
      "col": 4,
      "row": 1,
      "desc": "Runs the agent; calls the platform adapter and the hooks and tools the plugin registered"
    },
    {
      "id": "activity",
      "label": "Activity",
      "kind": "module",
      "col": 2,
      "row": 2,
      "zone": "turn",
      "desc": "Reasoning, tool status, token usage, delegations, held reports and replies"
    },
    {
      "id": "client-tools",
      "label": "Client tools",
      "kind": "module",
      "col": 3,
      "row": 2,
      "zone": "turn",
      "desc": "Tools the client declared: registration, the blocking handler, the pending calls"
    },
    {
      "id": "turns",
      "label": "Turn state",
      "kind": "module",
      "col": 1,
      "row": 3,
      "zone": "shared",
      "desc": "Per-chat open and joined turns, buffered cues, vocabulary, connected chats"
    },
    {
      "id": "registration",
      "label": "Registration",
      "kind": "module",
      "col": 2,
      "row": 3,
      "zone": "shared",
      "desc": "register: the hooks, generate_express, the tool context, the platform adapter"
    }
  ],
  "links": [
    {
      "from": "client",
      "to": "adapter",
      "label": "hello, turn, stop, reset, tool_result"
    },
    {
      "from": "adapter",
      "to": "client",
      "label": "ready, speech, render, turn_end, tool_call"
    },
    {
      "from": "adapter",
      "to": "gateway",
      "label": "MessageEvent"
    },
    {
      "from": "gateway",
      "to": "adapter",
      "label": "send, processing start and complete"
    },
    {
      "from": "gateway",
      "to": "speech",
      "label": "answer deltas"
    },
    {
      "from": "speech",
      "to": "adapter",
      "label": "finished sentences"
    },
    {
      "from": "gateway",
      "to": "express",
      "label": "generate_express call"
    },
    {
      "from": "gateway",
      "to": "activity",
      "label": "subagent, stream, tool, API hooks"
    },
    {
      "from": "activity",
      "to": "adapter",
      "label": "reasoning, tool state, delegations"
    },
    {
      "from": "gateway",
      "to": "client-tools",
      "label": "client tool call"
    },
    {
      "from": "client-tools",
      "to": "adapter",
      "label": "tool_call to send"
    }
  ],
  "nodes": [
    {
      "id": "client",
      "module": "client",
      "label": "YUI client",
      "external": true,
      "paths": [],
      "role": "The client on the push transport: one WebSocket per chat_id, frames in both directions."
    },
    {
      "id": "gateway",
      "module": "gateway",
      "label": "Hermes gateway",
      "external": true,
      "paths": [],
      "role": "The gateway process: loads the plugin, runs the agent per session, calls the platform adapter, fires the hooks and runs the registered tools."
    },
    {
      "id": "entry",
      "module": "registration",
      "label": "register",
      "paths": [
        "integrations/hermes/platform/yui/__init__.py"
      ],
      "role": "register(ctx): hands the hooks, generate_express, the tool context and the YuiAdapter factory to the gateway; the platform hint and the readiness probes."
    },
    {
      "id": "transport/adapter",
      "module": "adapter",
      "label": "YuiAdapter",
      "paths": [
        "integrations/hermes/platform/yui/src/transport/adapter.py"
      ],
      "role": "The /ws server: the hello handshake, frame routing, MessageEvents to the gateway, the gateway's sends turned into render, error and turn_end frames, and the threadsafe sinks the hooks call."
    },
    {
      "id": "transport/frames",
      "module": "adapter",
      "label": "frame size",
      "paths": [
        "integrations/hermes/platform/yui/src/transport/frames.py"
      ],
      "role": "The 256 KiB frame cap and the 4 MiB turn cap; trims an outbound frame to fit."
    },
    {
      "id": "transport/playback",
      "module": "adapter",
      "label": "playback notices",
      "paths": [
        "integrations/hermes/platform/yui/src/transport/playback.py"
      ],
      "role": "Turns a failed playback frame into an internal notice, skipping turns already closed with an error frame."
    },
    {
      "id": "transport/turn-images",
      "module": "adapter",
      "label": "turn images",
      "paths": [
        "integrations/hermes/platform/yui/src/transport/turn_images.py"
      ],
      "role": "Decodes a turn's image data URLs into cached files for the gateway."
    },
    {
      "id": "speech",
      "module": "speech",
      "label": "Speaker",
      "paths": [
        "integrations/hermes/platform/yui/src/speech"
      ],
      "role": "The on_stream_delta text hook and each chat's Stream: finished sentences out, what a later send still has to say."
    },
    {
      "id": "express/tools",
      "module": "express",
      "label": "generate_express",
      "paths": [
        "integrations/hermes/platform/yui/src/express/tools.py"
      ],
      "role": "Builds the tool schema from a vocabulary, registers it, and buffers each gated cue for the turn in flight."
    },
    {
      "id": "express/gate",
      "module": "express",
      "label": "cue gate",
      "paths": [
        "integrations/hermes/platform/yui/src/express/gate.py"
      ],
      "role": "Vocabulary from the client's payload; drops cue values outside it."
    },
    {
      "id": "express/segments",
      "module": "express",
      "label": "cue placement",
      "paths": [
        "integrations/hermes/platform/yui/src/express/segments.py"
      ],
      "role": "Sentence splitting and the placement of cues on the sentences they name."
    },
    {
      "id": "activity/reasoning",
      "module": "activity",
      "label": "reasoning",
      "paths": [
        "integrations/hermes/platform/yui/src/activity/reasoning.py"
      ],
      "role": "The on_stream_delta reasoning hook, the text so far per chat, and the 100 ms Coalescer."
    },
    {
      "id": "activity/tool-status",
      "module": "activity",
      "label": "tool status",
      "paths": [
        "integrations/hermes/platform/yui/src/activity/tool_status.py"
      ],
      "role": "The pre_tool_call and post_tool_call hooks: running, done or failed for a YUI turn's own tool calls."
    },
    {
      "id": "activity/usage",
      "module": "activity",
      "label": "usage",
      "paths": [
        "integrations/hermes/platform/yui/src/activity/usage.py"
      ],
      "role": "The post_api_request hook: the latest call's token usage per chat."
    },
    {
      "id": "activity/delegations",
      "module": "activity",
      "label": "delegations",
      "paths": [
        "integrations/hermes/platform/yui/src/activity/delegations.py"
      ],
      "role": "The subagent_start and subagent_stop hooks: each chat's list of background work."
    },
    {
      "id": "activity/reports",
      "module": "activity",
      "label": "away buffer",
      "paths": [
        "integrations/hermes/platform/yui/src/activity/reports.py"
      ],
      "role": "Reports and finished replies held per chat while no socket is ready, forty of each."
    },
    {
      "id": "tools/registry",
      "module": "client-tools",
      "label": "registry",
      "paths": [
        "integrations/hermes/platform/yui/src/tools/registry.py"
      ],
      "role": "Registers each function the hello frame's tools declare, once per schema fingerprint."
    },
    {
      "id": "tools/handler",
      "module": "client-tools",
      "label": "handler",
      "paths": [
        "integrations/hermes/platform/yui/src/tools/handler.py"
      ],
      "role": "The blocking handler a gateway worker thread runs: sends tool_call and waits for the result."
    },
    {
      "id": "tools/pending",
      "module": "client-tools",
      "label": "pending calls",
      "paths": [
        "integrations/hermes/platform/yui/src/tools/pending.py"
      ],
      "role": "The per-chat lock and waiter table; resolves a call or fails every call of a chat or turn."
    },
    {
      "id": "tools/image-result",
      "module": "client-tools",
      "label": "image results",
      "paths": [
        "integrations/hermes/platform/yui/src/tools/image_result.py"
      ],
      "role": "A result with images as an ImageResult, and as the _multimodal envelope the model reads."
    },
    {
      "id": "turns/state",
      "module": "turns",
      "label": "turn state",
      "paths": [
        "integrations/hermes/platform/yui/src/turns/state.py"
      ],
      "role": "Per-chat vocabulary, open and joined turns, buffered cues, delivered, muted and closing marks, connected chats."
    },
    {
      "id": "turns/session",
      "module": "turns",
      "label": "session",
      "paths": [
        "integrations/hermes/platform/yui/src/turns/session.py"
      ],
      "role": "The chat of the turn in flight, or the sole connected chat when the session context is empty."
    }
  ],
  "edges": [
    {
      "id": "frame-hello",
      "from": "client",
      "to": "transport/adapter",
      "carries": "hello {key, chat_id, accepts, vocabulary, tools}",
      "kind": "websocket",
      "transport": "push"
    },
    {
      "id": "frame-vocabulary",
      "from": "client",
      "to": "transport/adapter",
      "carries": "vocabulary {vocabulary}",
      "kind": "websocket",
      "transport": "push"
    },
    {
      "id": "frame-turn",
      "from": "client",
      "to": "transport/adapter",
      "carries": "turn {turn_id, client_context, text, images}",
      "kind": "websocket",
      "transport": "push"
    },
    {
      "id": "frame-stop",
      "from": "client",
      "to": "transport/adapter",
      "carries": "stop {turn_ids}",
      "kind": "websocket",
      "transport": "push"
    },
    {
      "id": "frame-reset",
      "from": "client",
      "to": "transport/adapter",
      "carries": "reset",
      "kind": "websocket",
      "transport": "push"
    },
    {
      "id": "frame-playback",
      "from": "client",
      "to": "transport/adapter",
      "carries": "playback {turn_id, ended: failed}",
      "kind": "websocket",
      "transport": "push"
    },
    {
      "id": "frame-tool-result",
      "from": "client",
      "to": "transport/adapter",
      "carries": "tool_result {id, result, images}",
      "kind": "websocket",
      "transport": "push"
    },
    {
      "id": "frame-ready",
      "from": "transport/adapter",
      "to": "client",
      "carries": "ready {chat_id, max_turn_bytes: 4 MiB}",
      "kind": "websocket",
      "transport": "push"
    },
    {
      "id": "frame-close",
      "from": "transport/adapter",
      "to": "client",
      "carries": "close 4401 on a wrong key or no chat_id; close 4409 to the socket a second hello replaces",
      "kind": "websocket",
      "transport": "push"
    },
    {
      "id": "frame-speech",
      "from": "transport/adapter",
      "to": "client",
      "carries": "speech {turn_id, segments: one sentence with its cues}",
      "kind": "websocket",
      "transport": "push"
    },
    {
      "id": "frame-render",
      "from": "transport/adapter",
      "to": "client",
      "carries": "render {turn_id, source: hermes, segments, reasoning}",
      "kind": "websocket",
      "transport": "push"
    },
    {
      "id": "frame-turn-end",
      "from": "transport/adapter",
      "to": "client",
      "carries": "turn_end {turn_id, usage}",
      "kind": "websocket",
      "transport": "push"
    },
    {
      "id": "frame-error",
      "from": "transport/adapter",
      "to": "client",
      "carries": "error {turn_id, message}, to a client whose hello accepts error",
      "kind": "websocket",
      "transport": "push"
    },
    {
      "id": "frame-reasoning",
      "from": "transport/adapter",
      "to": "client",
      "carries": "reasoning {turn_id, delta}, one per 100 ms window",
      "kind": "websocket",
      "transport": "push"
    },
    {
      "id": "frame-tool-status",
      "from": "transport/adapter",
      "to": "client",
      "carries": "tool_status {turn_id, state: running, done or failed, tool_id}",
      "kind": "websocket",
      "transport": "push"
    },
    {
      "id": "frame-tool-call",
      "from": "transport/adapter",
      "to": "client",
      "carries": "tool_call {id, turn_id, name, arguments}",
      "kind": "websocket",
      "transport": "push"
    },
    {
      "id": "frame-delegations",
      "from": "transport/adapter",
      "to": "client",
      "carries": "delegations {items}",
      "kind": "websocket",
      "transport": "push"
    },
    {
      "id": "register-hooks",
      "from": "entry",
      "to": "gateway",
      "carries": "ctx.register_hook: subagent_start, subagent_stop, on_stream_delta twice, pre_tool_call, post_tool_call, post_api_request",
      "kind": "call",
      "transport": "push"
    },
    {
      "id": "register-platform",
      "from": "entry",
      "to": "gateway",
      "carries": "ctx.register_platform(name yui, adapter_factory, check_fn, is_connected, platform_hint)",
      "kind": "call",
      "transport": "push"
    },
    {
      "id": "register-express",
      "from": "entry",
      "to": "express/tools",
      "carries": "set_context(ctx), declare(Vocabulary())",
      "kind": "call",
      "transport": "push"
    },
    {
      "id": "register-registry",
      "from": "entry",
      "to": "tools/registry",
      "carries": "set_context(ctx)",
      "kind": "call",
      "transport": "push"
    },
    {
      "id": "express-register",
      "from": "express/tools",
      "to": "gateway",
      "carries": "ctx.register_tool(generate_express, toolset yui) when the schema changes",
      "kind": "call",
      "transport": "push"
    },
    {
      "id": "registry-register",
      "from": "tools/registry",
      "to": "gateway",
      "carries": "ctx.register_tool(<declared name>, toolset yui, handler.handle(name)) once per schema fingerprint",
      "kind": "call",
      "transport": "push"
    },
    {
      "id": "gateway-lifecycle",
      "from": "gateway",
      "to": "transport/adapter",
      "carries": "adapter_factory(config) → YuiAdapter; connect(), disconnect()",
      "kind": "call",
      "transport": "push",
      "wiring": "integrations/hermes/platform/yui/__init__.py"
    },
    {
      "id": "gateway-processing",
      "from": "gateway",
      "to": "transport/adapter",
      "carries": "on_processing_start(event), on_processing_complete(event, outcome)",
      "kind": "call",
      "transport": "push"
    },
    {
      "id": "gateway-send",
      "from": "gateway",
      "to": "transport/adapter",
      "carries": "send(chat_id, content, metadata): the agent's text, gateway notices and the failure line; _send_with_retry marks unmarked sends as notices",
      "kind": "call",
      "transport": "push"
    },
    {
      "id": "gateway-internal",
      "from": "gateway",
      "to": "transport/adapter",
      "carries": "handle_message(internal event): a background report",
      "kind": "call",
      "transport": "push"
    },
    {
      "id": "gateway-unspoken",
      "from": "gateway",
      "to": "transport/adapter",
      "carries": "send_or_update_status, emit_warning, send_voice, send_document, send_video, send_image_file, send_image: logged, never sent; _should_auto_tts_for_chat → False",
      "kind": "call",
      "transport": "push"
    },
    {
      "id": "gateway-confirm",
      "from": "gateway",
      "to": "transport/adapter",
      "carries": "send_slash_confirm(chat_id, title, message, session_key, confirm_id)",
      "kind": "call",
      "transport": "push"
    },
    {
      "id": "gateway-express",
      "from": "gateway",
      "to": "express/tools",
      "carries": "generate_express handler({cues}) → JSON ack",
      "kind": "callback",
      "transport": "push",
      "wiring": "integrations/hermes/platform/yui/src/express/tools.py"
    },
    {
      "id": "gateway-tool-handler",
      "from": "gateway",
      "to": "tools/handler",
      "carries": "run(args) on a worker thread → result text or _multimodal envelope",
      "kind": "callback",
      "transport": "push",
      "wiring": "integrations/hermes/platform/yui/src/tools/registry.py"
    },
    {
      "id": "hook-speech",
      "from": "gateway",
      "to": "speech",
      "carries": "on_stream_delta(delta, kind text, turn_id, iteration, surface yui)",
      "kind": "callback",
      "transport": "push",
      "wiring": "integrations/hermes/platform/yui/__init__.py"
    },
    {
      "id": "hook-reasoning",
      "from": "gateway",
      "to": "activity/reasoning",
      "carries": "on_stream_delta(delta, kind reasoning, surface yui)",
      "kind": "callback",
      "transport": "push",
      "wiring": "integrations/hermes/platform/yui/__init__.py"
    },
    {
      "id": "hook-tool-status",
      "from": "gateway",
      "to": "activity/tool-status",
      "carries": "pre_tool_call, post_tool_call(tool_name, task_id, session_id, result, status)",
      "kind": "callback",
      "transport": "push",
      "wiring": "integrations/hermes/platform/yui/__init__.py"
    },
    {
      "id": "hook-usage",
      "from": "gateway",
      "to": "activity/usage",
      "carries": "post_api_request(platform, usage)",
      "kind": "callback",
      "transport": "push",
      "wiring": "integrations/hermes/platform/yui/__init__.py"
    },
    {
      "id": "hook-delegations",
      "from": "gateway",
      "to": "activity/delegations",
      "carries": "subagent_start, subagent_stop(child ids, goal, status, summary)",
      "kind": "callback",
      "transport": "push",
      "wiring": "integrations/hermes/platform/yui/__init__.py"
    },
    {
      "id": "adapter-handle-message",
      "from": "transport/adapter",
      "to": "gateway",
      "carries": "handle_message(MessageEvent): a turn's text and cached image paths with reply_expected false; /new and /stop with allow_gateway_control; held reports, one by one or merged",
      "kind": "call",
      "transport": "push"
    },
    {
      "id": "adapter-busy",
      "from": "transport/adapter",
      "to": "gateway",
      "carries": "_event_session_key, _active_sessions: whether the session already runs a turn",
      "kind": "call",
      "transport": "push"
    },
    {
      "id": "adapter-confirm",
      "from": "transport/adapter",
      "to": "gateway",
      "carries": "slash_confirm.resolve(session_key, confirm_id, once)",
      "kind": "call",
      "transport": "push"
    },
    {
      "id": "adapter-home",
      "from": "transport/adapter",
      "to": "gateway",
      "carries": "persist_home_channel(HomeChannel) for the first chat that connects",
      "kind": "call",
      "transport": "push"
    },
    {
      "id": "adapter-base",
      "from": "transport/adapter",
      "to": "gateway",
      "carries": "build_source(chat_id, dm); extract_media, extract_images, strip_media_directives_for_display, extract_local_files",
      "kind": "call",
      "transport": "push"
    },
    {
      "id": "turn-images-cache",
      "from": "transport/turn-images",
      "to": "gateway",
      "carries": "cache_image_from_bytes_async(bytes, extension) → cached path",
      "kind": "call",
      "transport": "push"
    },
    {
      "id": "session-env",
      "from": "turns/session",
      "to": "gateway",
      "carries": "get_session_env(HERMES_SESSION_CHAT_ID)",
      "kind": "call",
      "transport": "push"
    },
    {
      "id": "adapter-frames",
      "from": "transport/adapter",
      "to": "transport/frames",
      "carries": "inbound_frame_cap(frame), fit_frame(frame) → body or None, encoded(frame)",
      "kind": "call",
      "transport": "push"
    },
    {
      "id": "frames-images",
      "from": "transport/frames",
      "to": "tools/image-result",
      "carries": "has_images(images)",
      "kind": "call",
      "transport": "push"
    },
    {
      "id": "adapter-turn-images",
      "from": "transport/adapter",
      "to": "transport/turn-images",
      "carries": "cache_turn_images(images) → paths, mime types",
      "kind": "call",
      "transport": "push"
    },
    {
      "id": "adapter-playback",
      "from": "transport/adapter",
      "to": "transport/playback",
      "carries": "handle(frame, source, handle_message); record_closed(chat_id, turn_ids) after error frames",
      "kind": "call",
      "transport": "push"
    },
    {
      "id": "playback-notice",
      "from": "transport/playback",
      "to": "transport/adapter",
      "carries": "handle_message(internal event: [playback] failed turn=<id>)",
      "kind": "callback",
      "transport": "push"
    },
    {
      "id": "adapter-state",
      "from": "transport/adapter",
      "to": "turns/state",
      "carries": "set_connected, set_vocabulary, open_turn, mark_joined, turn_id, open_turns, close_turns, pop_cues, delivered, muted and closing marks",
      "kind": "call",
      "transport": "push"
    },
    {
      "id": "adapter-gate",
      "from": "transport/adapter",
      "to": "express/gate",
      "carries": "Vocabulary.from_payload(vocabulary)",
      "kind": "call",
      "transport": "push"
    },
    {
      "id": "adapter-declare",
      "from": "transport/adapter",
      "to": "express/tools",
      "carries": "declare(vocabulary, chat_id) as a turn opens",
      "kind": "call",
      "transport": "push"
    },
    {
      "id": "adapter-segments",
      "from": "transport/adapter",
      "to": "express/segments",
      "carries": "build_segments(rest, placements), place_matched(rest, placements)",
      "kind": "call",
      "transport": "push"
    },
    {
      "id": "adapter-speaker",
      "from": "transport/adapter",
      "to": "speech",
      "carries": "Speaker.speak(chat, turn, iteration, delta); stream(chat): begin, unspoken, seal, close; stop(chat)",
      "kind": "call",
      "transport": "push"
    },
    {
      "id": "adapter-reasoning",
      "from": "transport/adapter",
      "to": "activity/reasoning",
      "carries": "Coalescer.collect, forget, close; live_text(chat), clear(chat)",
      "kind": "call",
      "transport": "push"
    },
    {
      "id": "adapter-usage",
      "from": "transport/adapter",
      "to": "activity/usage",
      "carries": "take(chat) → usage for turn_end",
      "kind": "call",
      "transport": "push"
    },
    {
      "id": "adapter-delegations",
      "from": "transport/adapter",
      "to": "activity/delegations",
      "carries": "items(chat), forget(chat) on reset",
      "kind": "call",
      "transport": "push"
    },
    {
      "id": "adapter-reports",
      "from": "transport/adapter",
      "to": "activity/reports",
      "carries": "queue, take, merged_text for reports; queue_render, take_renders for replies",
      "kind": "call",
      "transport": "push"
    },
    {
      "id": "adapter-registry",
      "from": "transport/adapter",
      "to": "tools/registry",
      "carries": "declare(hello.tools, chat_id)",
      "kind": "call",
      "transport": "push"
    },
    {
      "id": "adapter-pending",
      "from": "transport/adapter",
      "to": "tools/pending",
      "carries": "resolve(chat, id, result, images); fail(chat, client disconnected) on close and replacement; fail(chat, turn stopped, turn_ids) on stop",
      "kind": "call",
      "transport": "push"
    },
    {
      "id": "speech-sink",
      "from": "speech",
      "to": "transport/adapter",
      "carries": "push_speech(chat_id, turn_id, iteration, delta) from the hook thread",
      "kind": "callback",
      "transport": "push",
      "wiring": "integrations/hermes/platform/yui/src/transport/adapter.py"
    },
    {
      "id": "speech-send",
      "from": "speech",
      "to": "transport/adapter",
      "carries": "_send_speech(chat_id, sentence, cues) → sent; _as_sent(text)",
      "kind": "callback",
      "transport": "push",
      "wiring": "integrations/hermes/platform/yui/src/transport/adapter.py"
    },
    {
      "id": "reasoning-sink",
      "from": "activity/reasoning",
      "to": "transport/adapter",
      "carries": "push_reasoning(chat_id, delta) from the hook thread",
      "kind": "callback",
      "transport": "push",
      "wiring": "integrations/hermes/platform/yui/src/transport/adapter.py"
    },
    {
      "id": "reasoning-send",
      "from": "activity/reasoning",
      "to": "transport/adapter",
      "carries": "_send_reasoning(chat_id, delta) once per window",
      "kind": "callback",
      "transport": "push",
      "wiring": "integrations/hermes/platform/yui/src/transport/adapter.py"
    },
    {
      "id": "tool-status-sink",
      "from": "activity/tool-status",
      "to": "transport/adapter",
      "carries": "push_tool_status(chat_id, state, tool_name)",
      "kind": "callback",
      "transport": "push",
      "wiring": "integrations/hermes/platform/yui/src/transport/adapter.py"
    },
    {
      "id": "delegations-notify",
      "from": "activity/delegations",
      "to": "transport/adapter",
      "carries": "notify_delegations(chat_id) when the list changes",
      "kind": "callback",
      "transport": "push",
      "wiring": "integrations/hermes/platform/yui/src/transport/adapter.py"
    },
    {
      "id": "handler-send",
      "from": "tools/handler",
      "to": "transport/adapter",
      "carries": "send_tool_call(chat_id, frame) → on the wire within 5 s",
      "kind": "callback",
      "transport": "push",
      "wiring": "integrations/hermes/platform/yui/src/transport/adapter.py"
    },
    {
      "id": "speech-segments",
      "from": "speech",
      "to": "express/segments",
      "carries": "split_finished(text), opening_cues(sentence, placements)",
      "kind": "call",
      "transport": "push"
    },
    {
      "id": "speech-state",
      "from": "speech",
      "to": "turns/state",
      "carries": "is_muted, cues, drop_cues",
      "kind": "call",
      "transport": "push"
    },
    {
      "id": "speech-session",
      "from": "speech",
      "to": "turns/session",
      "carries": "current_chat_id()",
      "kind": "call",
      "transport": "push"
    },
    {
      "id": "express-gate",
      "from": "express/tools",
      "to": "express/gate",
      "carries": "validate_cue(cue, vocabulary), cue_of(applied)",
      "kind": "call",
      "transport": "push"
    },
    {
      "id": "express-state",
      "from": "express/tools",
      "to": "turns/state",
      "carries": "vocabulary(chat), append_cue(chat, cue, sentence)",
      "kind": "call",
      "transport": "push"
    },
    {
      "id": "express-session",
      "from": "express/tools",
      "to": "turns/session",
      "carries": "current_chat_id()",
      "kind": "call",
      "transport": "push"
    },
    {
      "id": "reasoning-session",
      "from": "activity/reasoning",
      "to": "turns/session",
      "carries": "current_chat_id()",
      "kind": "call",
      "transport": "push"
    },
    {
      "id": "tool-status-session",
      "from": "activity/tool-status",
      "to": "turns/session",
      "carries": "current_chat_id()",
      "kind": "call",
      "transport": "push"
    },
    {
      "id": "tool-status-image",
      "from": "activity/tool-status",
      "to": "tools/image-result",
      "carries": "result_text(result)",
      "kind": "call",
      "transport": "push"
    },
    {
      "id": "usage-session",
      "from": "activity/usage",
      "to": "turns/session",
      "carries": "current_chat_id()",
      "kind": "call",
      "transport": "push"
    },
    {
      "id": "delegations-session",
      "from": "activity/delegations",
      "to": "turns/session",
      "carries": "current_chat_id()",
      "kind": "call",
      "transport": "push"
    },
    {
      "id": "registry-handler",
      "from": "tools/registry",
      "to": "tools/handler",
      "carries": "handle(name) → handler",
      "kind": "call",
      "transport": "push"
    },
    {
      "id": "handler-pending",
      "from": "tools/handler",
      "to": "tools/pending",
      "carries": "register(chat, id, turn_id), chat_lock(chat), discard; waits on the future",
      "kind": "call",
      "transport": "push"
    },
    {
      "id": "handler-state",
      "from": "tools/handler",
      "to": "turns/state",
      "carries": "is_connected(chat), turn_id(chat)",
      "kind": "call",
      "transport": "push"
    },
    {
      "id": "handler-session",
      "from": "tools/handler",
      "to": "turns/session",
      "carries": "current_chat_id()",
      "kind": "call",
      "transport": "push"
    },
    {
      "id": "handler-image",
      "from": "tools/handler",
      "to": "tools/image-result",
      "carries": "model_result(result)",
      "kind": "call",
      "transport": "push"
    },
    {
      "id": "pending-image",
      "from": "tools/pending",
      "to": "tools/image-result",
      "carries": "client_result(text, images)",
      "kind": "call",
      "transport": "push"
    },
    {
      "id": "session-state",
      "from": "turns/session",
      "to": "turns/state",
      "carries": "connected_chats()",
      "kind": "call",
      "transport": "push"
    }
  ],
  "flows": [
    {
      "id": "handshake",
      "title": "Handshake",
      "steps": [
        {
          "from": "client",
          "label": "hello with key, chat_id, accepts, vocabulary and tools",
          "edges": [
            "frame-hello"
          ],
          "to": "adapter"
        },
        {
          "from": "adapter",
          "label": "A wrong key or no chat_id closes the socket with 4401 and sends nothing",
          "edges": [
            "frame-close"
          ],
          "to": "client"
        },
        {
          "from": "adapter",
          "label": "The socket becomes the chat's; the vocabulary is stored",
          "edges": [
            "adapter-state",
            "adapter-gate"
          ]
        },
        {
          "from": "adapter",
          "label": "A replaced socket's pending calls answer client disconnected",
          "edges": [
            "adapter-pending"
          ],
          "to": "client-tools"
        },
        {
          "from": "adapter",
          "label": "The first chat becomes the home channel",
          "edges": [
            "adapter-home"
          ],
          "to": "gateway"
        },
        {
          "from": "adapter",
          "label": "registry.declare(hello.tools)",
          "edges": [
            "adapter-registry"
          ],
          "to": "client-tools"
        },
        {
          "from": "client-tools",
          "label": "register_tool for each declared function",
          "edges": [
            "registry-register"
          ],
          "to": "gateway"
        },
        {
          "from": "adapter",
          "label": "ready with max_turn_bytes",
          "edges": [
            "frame-ready"
          ],
          "to": "client"
        },
        {
          "from": "adapter",
          "label": "The replaced socket closes with 4409",
          "edges": [
            "frame-close"
          ],
          "to": "client"
        },
        {
          "from": "adapter",
          "label": "delegations.items(chat)",
          "edges": [
            "adapter-delegations"
          ],
          "to": "activity"
        },
        {
          "from": "adapter",
          "label": "delegations",
          "edges": [
            "frame-delegations"
          ],
          "to": "client"
        },
        {
          "from": "adapter",
          "label": "Replies and reports held while the client was away go out next",
          "edges": [
            "adapter-reports"
          ],
          "to": "activity"
        }
      ]
    },
    {
      "id": "turn",
      "title": "A client turn into an agent run",
      "steps": [
        {
          "from": "client",
          "label": "turn with client_context, text and images",
          "edges": [
            "frame-turn"
          ],
          "to": "adapter"
        },
        {
          "from": "adapter",
          "label": "Checks the frame against the 4 MiB turn cap",
          "edges": [
            "adapter-frames"
          ]
        },
        {
          "from": "adapter",
          "label": "Turn images become cached files",
          "edges": [
            "adapter-turn-images",
            "turn-images-cache"
          ],
          "to": "gateway"
        },
        {
          "from": "adapter",
          "label": "A session already running a turn marks this one joined",
          "edges": [
            "adapter-busy"
          ],
          "to": "gateway"
        },
        {
          "from": "adapter",
          "label": "mark_joined(chat, turn_id)",
          "edges": [
            "adapter-state"
          ],
          "to": "turns"
        },
        {
          "from": "adapter",
          "label": "handle_message: client_context, a blank line, the utterance; reply_expected false",
          "edges": [
            "adapter-handle-message"
          ],
          "to": "gateway"
        },
        {
          "from": "gateway",
          "label": "on_processing_start(event)",
          "edges": [
            "gateway-processing"
          ],
          "to": "adapter"
        },
        {
          "from": "adapter",
          "label": "open_turn under the client's turn_id",
          "edges": [
            "adapter-state"
          ],
          "to": "turns"
        },
        {
          "from": "adapter",
          "label": "The chat's stream begins",
          "edges": [
            "adapter-speaker"
          ],
          "to": "speech"
        },
        {
          "from": "adapter",
          "label": "reasoning.clear, Coalescer.forget",
          "edges": [
            "adapter-reasoning"
          ],
          "to": "activity"
        },
        {
          "from": "adapter",
          "label": "declare generate_express from the chat's vocabulary",
          "edges": [
            "adapter-declare"
          ],
          "to": "express"
        },
        {
          "from": "express",
          "label": "register_tool when the schema changed",
          "edges": [
            "express-register"
          ],
          "to": "gateway"
        },
        {
          "from": "gateway",
          "label": "Runs the agent",
          "edges": []
        },
        {
          "from": "gateway",
          "label": "post_api_request keeps the call's usage",
          "edges": [
            "hook-usage"
          ],
          "to": "activity"
        },
        {
          "from": "gateway",
          "label": "pre_tool_call",
          "edges": [
            "hook-tool-status"
          ],
          "to": "activity"
        },
        {
          "from": "activity",
          "label": "push_tool_status(running)",
          "edges": [
            "tool-status-sink"
          ],
          "to": "adapter"
        },
        {
          "from": "adapter",
          "label": "tool_status running",
          "edges": [
            "frame-tool-status"
          ],
          "to": "client"
        },
        {
          "from": "gateway",
          "label": "on_stream_delta reasoning",
          "edges": [
            "hook-reasoning"
          ],
          "to": "activity"
        },
        {
          "from": "activity",
          "label": "push_reasoning, then one send per 100 ms window",
          "edges": [
            "reasoning-sink",
            "adapter-reasoning",
            "reasoning-send"
          ],
          "to": "adapter"
        },
        {
          "from": "adapter",
          "label": "reasoning",
          "edges": [
            "frame-reasoning"
          ],
          "to": "client"
        },
        {
          "from": "gateway",
          "label": "generate_express({cues})",
          "edges": [
            "gateway-express"
          ],
          "to": "express"
        },
        {
          "from": "express",
          "label": "Each gated cue is buffered for the turn",
          "edges": [
            "express-state",
            "express-session"
          ],
          "to": "turns"
        }
      ]
    },
    {
      "id": "reply",
      "title": "The reply back to the client",
      "steps": [
        {
          "from": "gateway",
          "label": "on_stream_delta text",
          "edges": [
            "hook-speech"
          ],
          "to": "speech"
        },
        {
          "from": "speech",
          "label": "push_speech from the hook thread",
          "edges": [
            "speech-sink"
          ],
          "to": "adapter"
        },
        {
          "from": "adapter",
          "label": "Speaker.speak, in arrival order under the stream lock",
          "edges": [
            "adapter-speaker"
          ],
          "to": "speech"
        },
        {
          "from": "speech",
          "label": "Cuts finished sentences and takes the cues that open each",
          "edges": [
            "speech-segments"
          ],
          "to": "express"
        },
        {
          "from": "speech",
          "label": "cues, drop_cues",
          "edges": [
            "speech-state"
          ],
          "to": "turns"
        },
        {
          "from": "speech",
          "label": "_send_speech(sentence, cues)",
          "edges": [
            "speech-send"
          ],
          "to": "adapter"
        },
        {
          "from": "adapter",
          "label": "speech, one sentence per frame",
          "edges": [
            "frame-speech"
          ],
          "to": "client"
        },
        {
          "from": "gateway",
          "label": "send(reply)",
          "edges": [
            "gateway-send"
          ],
          "to": "adapter"
        },
        {
          "from": "adapter",
          "label": "The text past the streamed sentences",
          "edges": [
            "adapter-speaker"
          ],
          "to": "speech"
        },
        {
          "from": "adapter",
          "label": "build_segments places the remaining cues",
          "edges": [
            "adapter-segments"
          ],
          "to": "express"
        },
        {
          "from": "adapter",
          "label": "live_text(chat) rides on the render",
          "edges": [
            "adapter-reasoning"
          ],
          "to": "activity"
        },
        {
          "from": "adapter",
          "label": "render",
          "edges": [
            "frame-render"
          ],
          "to": "client"
        },
        {
          "from": "gateway",
          "label": "on_processing_complete(event, outcome)",
          "edges": [
            "gateway-processing"
          ],
          "to": "adapter"
        },
        {
          "from": "adapter",
          "label": "close_turns, take_delivered, pop_cues",
          "edges": [
            "adapter-state"
          ],
          "to": "turns"
        },
        {
          "from": "adapter",
          "label": "usage.take(chat)",
          "edges": [
            "adapter-usage"
          ],
          "to": "activity"
        },
        {
          "from": "adapter",
          "label": "A render of cues left over, then turn_end with usage for each closed turn",
          "edges": [
            "frame-render",
            "frame-turn-end"
          ],
          "to": "client"
        },
        {
          "from": "gateway",
          "label": "A failed turn: send(failure line)",
          "edges": [
            "gateway-send"
          ],
          "to": "adapter"
        },
        {
          "from": "adapter",
          "label": "error then turn_end to a client that accepts error; the line as a render otherwise",
          "edges": [
            "frame-error",
            "frame-turn-end",
            "frame-render"
          ],
          "to": "client"
        }
      ]
    },
    {
      "id": "tool-call",
      "title": "A client-declared tool call",
      "steps": [
        {
          "from": "gateway",
          "label": "run(args) on a worker thread",
          "edges": [
            "gateway-tool-handler"
          ],
          "to": "client-tools"
        },
        {
          "from": "client-tools",
          "label": "The chat and turn of the call; with no ready socket it answers client disconnected at once",
          "edges": [
            "handler-session",
            "handler-state"
          ],
          "to": "turns"
        },
        {
          "from": "client-tools",
          "label": "Registers the call and takes the chat's lock: one call at a time per chat",
          "edges": [
            "handler-pending"
          ]
        },
        {
          "from": "client-tools",
          "label": "send_tool_call(frame)",
          "edges": [
            "handler-send"
          ],
          "to": "adapter"
        },
        {
          "from": "adapter",
          "label": "tool_call",
          "edges": [
            "frame-tool-call"
          ],
          "to": "client"
        },
        {
          "from": "client",
          "label": "tool_result",
          "edges": [
            "frame-tool-result"
          ],
          "to": "adapter"
        },
        {
          "from": "adapter",
          "label": "pending.resolve(chat, id, result, images)",
          "edges": [
            "adapter-pending"
          ],
          "to": "client-tools"
        },
        {
          "from": "client-tools",
          "label": "The waiter returns; a wait that passes answers no reply from the client within <n> s",
          "edges": [
            "handler-pending",
            "pending-image"
          ]
        },
        {
          "from": "client-tools",
          "label": "The result text, or a _multimodal envelope with the images",
          "edges": [
            "gateway-tool-handler",
            "handler-image"
          ],
          "to": "gateway"
        },
        {
          "from": "gateway",
          "label": "post_tool_call",
          "edges": [
            "hook-tool-status"
          ],
          "to": "activity"
        },
        {
          "from": "activity",
          "label": "done, or failed for an error or a client verdict that is not ok",
          "edges": [
            "tool-status-sink"
          ],
          "to": "adapter"
        },
        {
          "from": "adapter",
          "label": "tool_status",
          "edges": [
            "frame-tool-status"
          ],
          "to": "client"
        },
        {
          "from": "client",
          "label": "stop naming the call's turn",
          "edges": [
            "frame-stop"
          ],
          "to": "adapter"
        },
        {
          "from": "adapter",
          "label": "Waiting and in-flight calls of the turn answer turn stopped",
          "edges": [
            "adapter-pending"
          ],
          "to": "client-tools"
        }
      ]
    },
    {
      "id": "backend-turn",
      "title": "A backend-started turn and the away buffer",
      "steps": [
        {
          "from": "gateway",
          "label": "subagent_start, subagent_stop",
          "edges": [
            "hook-delegations"
          ],
          "to": "activity"
        },
        {
          "from": "activity",
          "label": "notify_delegations while the client is connected",
          "edges": [
            "delegations-notify"
          ],
          "to": "adapter"
        },
        {
          "from": "adapter",
          "label": "items(chat)",
          "edges": [
            "adapter-delegations"
          ],
          "to": "activity"
        },
        {
          "from": "adapter",
          "label": "delegations",
          "edges": [
            "frame-delegations"
          ],
          "to": "client"
        },
        {
          "from": "gateway",
          "label": "handle_message(internal report)",
          "edges": [
            "gateway-internal"
          ],
          "to": "adapter"
        },
        {
          "from": "adapter",
          "label": "The client is away: the report is held",
          "edges": [
            "adapter-reports"
          ],
          "to": "activity"
        },
        {
          "from": "adapter",
          "label": "The client is connected: the report goes on to the gateway",
          "edges": [
            "adapter-handle-message"
          ],
          "to": "gateway"
        },
        {
          "from": "gateway",
          "label": "on_processing_start(internal event)",
          "edges": [
            "gateway-processing"
          ],
          "to": "adapter"
        },
        {
          "from": "adapter",
          "label": "open_turn under a minted hermes-<n> id",
          "edges": [
            "adapter-state"
          ],
          "to": "turns"
        },
        {
          "from": "gateway",
          "label": "send(reply)",
          "edges": [
            "gateway-send"
          ],
          "to": "adapter"
        },
        {
          "from": "adapter",
          "label": "render under hermes-<n>, then its turn_end",
          "edges": [
            "frame-render",
            "frame-turn-end"
          ],
          "to": "client"
        },
        {
          "from": "adapter",
          "label": "A render or turn_end the socket cannot take is held",
          "edges": [
            "adapter-reports"
          ],
          "to": "activity"
        },
        {
          "from": "gateway",
          "label": "send with no turn in flight",
          "edges": [
            "gateway-send"
          ],
          "to": "adapter"
        },
        {
          "from": "adapter",
          "label": "render under a newly minted hermes-<n>, and its turn_end at once",
          "edges": [
            "frame-render",
            "frame-turn-end"
          ],
          "to": "client"
        },
        {
          "from": "client",
          "label": "hello on reconnect",
          "edges": [
            "frame-hello"
          ],
          "to": "adapter"
        },
        {
          "from": "adapter",
          "label": "take_renders(chat)",
          "edges": [
            "adapter-reports"
          ],
          "to": "activity"
        },
        {
          "from": "adapter",
          "label": "The held replies in order",
          "edges": [
            "frame-render",
            "frame-turn-end"
          ],
          "to": "client"
        },
        {
          "from": "adapter",
          "label": "take(chat), and merged_text for more than one report",
          "edges": [
            "adapter-reports"
          ],
          "to": "activity"
        },
        {
          "from": "adapter",
          "label": "One turn for the held reports",
          "edges": [
            "adapter-handle-message"
          ],
          "to": "gateway"
        }
      ]
    }
  ]
}
