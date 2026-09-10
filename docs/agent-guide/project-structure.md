# YUI — Project Structure & Stack

## Stack

| Layer | Technology | Version |
|---|---|---|
| Shell / OS | Tauri v2 (Rust) | tauri 2.11.x |
| Build / dev server | Vite | 8.x (dev port `YUI_DEV_PORT`, default **1420**; auto-port launchers pick a free port per worktree) |
| Language | TypeScript | 6.x (bundler mode, `noEmit`) |
| Render | three.js | 0.180.x |
| VRM / motion | `@pixiv/three-vrm`, `@pixiv/three-vrm-animation` | 3.5.x |
| Voice | `@ricky0123/vad-web` (Silero+ONNX) | 0.0.x |

## Directory Map

```
YUI/
  index.html                         # Vite entry
  settings.html                      # Settings-window Vite entry
  devtools.html                      # Developer Tools Vite entry
  message.html                       # Message-window Vite entry
  vite.config.ts                     # Dev port YUI_DEV_PORT|1420, strictPort, host 127.0.0.1
  biome.json                         # Format and lint config (curated rule set)
  .claude/
    hooks/                           # Workflow guards: worktree create, pre-tool bash/read/write, post-edit doc check
    skills/                          # Vendored skills (karpathy-guidelines, yui-dev-workflow, yui-install)
    agents/                          # Vendored sub-agent definitions
  scripts/                           # Dev launchers (dev-port.mjs, tauri-dev.mjs, dev-auto.mjs), release.sh, worktree-setup.sh, ci/test-guard.sh
  configs/                           # Runtime-loaded config (no hardcoding)
    endpoints.json                   # chat/stt/tts base urls + tts_model/tts_speaker + broker_base_url
    emotion_registry.json            # emotion id -> vrm_expression + fallback
    motions.json                     # Motion registry
    avatar.json                      # VRM avatar config
    filler.json                      # Backed-off filler schedule + first/repeat/long_wait/tool/timeout/unreachable phrase pools
    guardrails.json                  # Dispatcher cooldown/suppression + attachment caps (max_count, max_image_bytes)
    hotkeys.json                     # Global summon accelerator (empty = disabled)
    screen.json                      # Frontmost-transition detector thresholds (dwell/settle/session/gap/quiet)
    emotion_text/                    # Emoji voice-tag vocabulary (emotion_text/irodori.json)
  public/motions/                    # VRMA motion assets
  src/
    main.ts                          # Application entry: config load, renderer, dispatcher, and the I/O graph
    bootstrap-wiring.ts              # VRM and speaker selection stores plus their swap and import flows
    bootstrap-configured.ts          # Config-derived bootstrap: pat gesture, fall and descend configs, ambient handles
    voice-pipeline-wiring.ts         # Wires filler, TTS, and speech playback to the turn lifecycle
    logger.ts                        # Namespaced frontend logger with a runtime level
    drag.ts                          # Main-window drag gesture detection and OS-native drag handoff
    settings-main.ts                 # Settings-window entry
    devtools-main.ts                 # Developer Tools window entry
    message-main.ts                  # Message-window entry
    styles.css                       # Pet-window base stylesheet
    vite-env.d.ts                    # Vite client types and build-time env declarations
    contract/                        # TS contract types — the wire schema source of truth
      types.ts                       # Wire schema source of truth for the YUI to Hermes contract
      index.ts                       # Contract barrel
    config/                          # Config load, validate, reactive store, hot-reload
      load.ts                        # configs/*.json loader and validation, fail-loud
      store.ts                       # Reactive config snapshot with hot-reload and change subscriptions
      emotion-text.ts                # Per-provider emotion_text emoji table loader
      validators/
        avatar.ts                    # Validates avatar.json
        emotion-registry.ts          # Validates the emotion registry against the emotion enum
        endpoints.ts                 # Validates endpoint URLs and models; an empty value leaves the feature off
        filler.ts                    # Validates the filler phrase tiers
        guardrails.ts                # Validates cooldown, suppression, and attachment caps
        hotkeys.ts                   # Validates the summon accelerator; empty is disabled
        motions.ts                   # Validates the motion registry
        screen.ts                    # Validates the frontmost-transition detector thresholds
        shared.ts                    # Shared ConfigError plus issue-recording helpers
    renderer/                        # three.js + VRM rendering
      index.ts                       # three.js and VRM output layer: scene, rAF loop, VRM load and hot-swap
      alpha-hit-test.ts              # CPU-side low-res silhouette grab and sampling
      apply-directive.ts             # Pure routing of a control envelope into the emotion and motion sinks
      body-yaw.ts                    # Pure easing math for the root yaw a stroll turns by
      camera-fit.ts                  # Pure fit-to-bounds framing math
      cursor-gaze.ts                 # Stateful three.js apply layer for cursor head and eye tracking
      cycle-dwell.ts                 # Single-timer scheduler for a cycle motion's variant swap
      ease-emotion.ts                # Eases the expression back to neutral when playback ends
      emotion-crossfade.ts           # Stateful VRM-expression crossfade apply layer
      emotion-resolver.ts            # Pure expression lookup and fallback-chain traversal
      frame-gate.ts                  # Pure idle and active frame-throttle decision
      gaze-tracker.ts                # Pure cursor-gaze zone curve and angle damping
      hit-test.ts                    # Pure helpers for the alpha silhouette predicate
      mirror-clip.ts                 # Mirrors a clip across the YZ plane
      motion-controller.ts           # Pure motion scheduling and variant-resolution state machine
      motion-fallback.ts             # Idle-fallback decision for a motion whose clip fails to load
      motion-start-generation.ts     # Tracks which asynchronous motion start owns mixer playback
      mouth-lipsync.ts               # Amplitude-only mouth state machine and expression describe helper
      perch-geometry.ts              # Pure math for the window-sit perch
      perch-hold.ts                  # Held-posture suppression and baseline rules
      pin-controller.ts              # Stateful perch and peek pin apply layer
      pixel-ratio.ts                 # Pure devicePixelRatio clamp
      project-anchor.ts              # Projects the world feet point into canvas pixels
      recenter-root-motion.ts        # Strips baked horizontal drift from VRMA root motion
      self-crossfade.ts              # Clip-cache key composition and playback clip selection
      stage-coords.ts                # Client CSS px to stage-local coordinate conversion
      tap-region.ts                  # Classifies a tap point into a body region
      view-window.ts                 # Draws the reference-size framing at an offset inside a parked canvas
      vrm-participant.ts             # The per-frame lifecycle every VRM-bound sub-controller implements
    dispatcher/                      # Event bus + classify, guardrail, route
      dispatcher.ts                  # The router that enforces the firing-is-not-judgment boundary
      event-bus.ts                   # Priority queue collecting every speech-candidate event
      guardrails.ts                  # Cooldown, debounce, and rate-limit evaluation
      backend-caller.ts              # Sends a tier-2 or tier-3 event to backend judgment and streams the reply
      context-builder.ts             # Builds the per-turn client context and image attachments
      client-context-text.ts         # Renders a client context into the plain-line prompt block
      turn.ts                        # Turn identity ledger and the single definition of over
      turn-output.ts                 # Speech lifecycle port between the backend caller and the voice pipeline
      buffered-inbox-source.ts       # Shared presence-gated core for the inbox-push firing sources
      agent-source.ts                # Agent-lifecycle firing source
      signals-source.ts              # Grouped signals-ingress firing source
      proactive-source.ts            # Idle-gap proactive firing source
      proactive-pacer.ts             # The quiet gap after a turn that every proactive source shares
      schedule-source.ts             # Clock-time schedule firing source
      screen-source.ts               # Frontmost-app transition firing source with a dwell state machine
      user-input-source.ts           # Normalises typed text and STT results into bus envelopes
    ambient/                         # Backend-independent local liveliness and movement
      tier1.ts                       # Tier 1 ambient engine: blink, idle sway, breath, look-around
      cues.ts                        # Pure, side-effect-free cue math for Tier 1
      walker.ts                      # Floor stroll along the monitor's work-area bottom
      percher.ts                     # Perched dwell, stroll, and sit-back-down on a foreign window top
      climber.ts                     # Climb up a window or screen edge, dwell, and climb back down
      jumper.ts                      # Jump across to an adjacent window top
      faller.ts                      # Fall to the first surface below a character left in mid-air
      sitter.ts                      # Sit-down and stand-up seat transitions
      clip-leg.ts                    # A window leg paced by an in-place clip
    io/                              # I/O layer: chat, voice, settings stores, window and OS seams
      chat-client.ts                 # Adapter over the openai SDK Responses stream
      chat-completions.ts            # Pure Chat Completions request builders and stream-chunk reducer
      chat-history-store.ts          # Unified conversation transcript with session boundaries
      client-tools.ts                # Registry of the tools YUI declares and runs itself
      context-history.ts             # Capped ring of recent client-context entries
      session-store.ts               # Holds the last Responses response.id for conversation continuation
      session-diagnostics.ts         # Used tokens and context window for the settings window
      secret-provider.ts             # Resolves each secret from its runtime store, then the build-time fallback
      api-key-settings.ts            # Generic API-key override store behind the chat, STT, and TTS key settings
      chat-key-settings.ts           # Chat API key override store
      deadline.ts                    # Per-request deadline so a hung fetch settles
      sentence-segmenter.ts          # Segments streamed text into sentences
      strip-emoji.ts                 # Stateful emoji stripper for spoken text deltas
      stt-vad.ts                     # Voice input pipeline: VAD segmentation then STT upload
      tts-pipeline.ts                # Sentence-level TTS synthesis with in-order playback
      tts-synth.ts                   # Single-sentence speech synthesis request
      tts-voices.ts                  # Lists, uploads, and deletes reference voices on the TTS server
      audio-player.ts                # Web Audio sink that plays a wav clip and reports mouth-open amplitude
      speech-playback.ts             # Glue between TTS playback, the renderer mouth, and bubble lifetime
      filler-loop.ts                 # Bounded, event-aware TTFT filler scheduler
      filler-pool.ts                 # Resolves the effective filler pool per language and tier
      filler-settings.ts             # Filler phrase pools and behaviour flags
      filler-audio-cache.ts          # Session-scoped audio memo for filler phrases
      shuffle-bag.ts                 # Draws phrases without replacement until the pool is exhausted
      voice-import.ts                # Voice import: OS picker, native copy, speaker registration
      voice-import-flow.ts           # Two-step voice import so a naming row sits between pick and copy
      voice-list-refresh.ts          # Refetches the TTS server's voice list into a speaker manifest
      reference-clip.ts              # Reference-clip URL resolution and transport selection
      speaker-selection.ts           # Owns the active TTS speaker selection
      vrm-import.ts                  # VRM import: OS picker, native copy, avatar-option registration
      user-asset-import.ts           # Dialog result shape, lazy Tauri loaders, and orphan cleanup shared by the voice and VRM imports
      vrm-selection.ts               # Owns the active VRM selection
      selection-store.ts             # Generic selection store behind VRM and speaker selection
      safe-id.ts                     # TS mirror of the native stem sanitizer for persisted option ids
      broker-client.ts               # Write-only Expression Broker MCP client that publishes the renderable vocabulary
      broker-override-reconciler.ts  # Applies a broker-URL override to the live broker client
      avatar-rpc.ts                  # Webview end of the loopback avatar RPC surface
      avatar-executor.ts             # Answers the bridged avatar RPCs from live client state
      agent-inbox.ts                 # Subscribes to the Rust agent-inbox event channel
      signals-inbox.ts               # Subscribes to the Rust signals-inbox event channel
      create-inbox.ts                # Generic Tauri event-channel subscription seam
      tauri-listen.ts                # Shared os_event channel payload shape and listen resolver
      tauri-env.ts                   # Tauri runtime detection
      tauri-screen.ts                # Tauri-backed screen enumeration and capture
      screen-source-provider.ts      # Monitor enumeration seam
      screen-geometry.ts             # Monitor containment and work-area floor math shared by every window mover
      screenshot-context.ts          # Pure encoder for the screenshot context block
      asset-url.ts                   # Logical asset paths to runtime-fetchable URLs
      window-statics.ts              # Cached window origin and scale factors for the global-cursor poll loops
      cursor-tracker.ts              # Forwards the OS cursor position to the gaze apply layer
      frontmost-tracker.ts           # Latest frontmost-window sample off the os_event channel
      hit-test.ts                    # Click-through hit-test controller for the transparent window
      keep-on-screen.ts              # Pushes a window back until its centre lands on a monitor
      travel-frame.ts                # Parks the real window once for a scale-seam crossing
      peek-state.ts                  # Holds the current peek side and its lifecycle
      tap-source.ts                  # Turns taps on the character into bus envelopes
      drag-hold-source.ts            # Fires one proactive.drag_held candidate per sustained drag
      window-drop-source.ts          # Drag-release perch decision plus the occlusion-aware detach poll
      window-resize-source.ts        # Ctrl+wheel over the character resizes the pet window
      summon-hotkey.ts               # Registers the OS-wide summon accelerator and summons the input
      settings-bridge.ts             # Typed cross-window settings bus over Tauri emit and listen
      settings-stores.ts             # Constructs and synchronises the settings-store family
      settings-window.ts             # Settings window opener and cross-window settings sync
      devtools-window.ts             # Developer Tools window opener
      message-window.ts              # Message-window opener and its placement rule
      message-window-mode.ts         # Keeps the message window in step with the stored mode and the dock request
      message-bridge.ts              # Cross-window bus linking the pet window and the message window
      message-remote.ts              # The message window's bubble and input as a remote Surfaces half
      persisted-store.ts             # Shared bootstrap, notify, reload, and localStorage core for the settings stores
      turn-record-log.ts             # Appends one JSONL record per completed turn or skipped fire
      agent-settings.ts              # Reasoning effort and system-instructions override
      agent-notify-settings.ts       # Agent-notification enabled flag and listener port
      camera-settings.ts             # Camera zoom and orbit viewpoint
      endpoints-settings.ts          # User-editable endpoint and model overrides
      express-motion-settings.ts     # Curates the motion vocabulary the agent may choose from
      guardrails-settings.ts         # User-editable guardrail rate-limit caps
      idle-motion-settings.ts        # Selects which ambient idle variants may play
      lipsync-settings.ts            # Lip-sync gain
      message-window-settings.ts     # Message-window mode and last outer position
      cue-list-settings.ts           # Shared on/off flag plus editable cue list behind the schedule and proactive stores
      proactive-settings.ts          # Idle-gap proactive cue list and its on/off flag
      proactive-seeds.ts             # Per-locale default proactive cues seeded on a first run
      schedule-settings.ts           # Clock-time schedule cue list and its on/off flag
      schedule-seeds.ts              # Per-locale default schedule cues seeded on a first run
      screen-settings.ts             # User-editable screen-watch thresholds
      screenshot-settings.ts         # Screenshot enabled state and source
      sections-settings.ts           # Collapsed state of the Quick Controls sections
      vad-settings.ts                # VAD silence window
      workflow-settings.ts           # Workflow entry list and URL validation
    ui/                              # Floating surfaces, panels, and indicators
      surfaces.ts                    # Mounts the speech bubble, tool-status chip, and text input as one system
      surfaces-router.ts             # One Surfaces handle over the pet window and the message window
      speech-bubble.ts               # Speech bubble: dwell, scroll, markdown, and aria for streamed speech
      text-input.ts                  # Text input: submit, busy, error, and feet anchoring
      summon-key.ts                  # Binds the focused window's "/" key to open the text input
      tool-status.ts                 # Tool-status chip observing backend tool calls
      tool-labels.ts                 # Tool id to display label lookup
      turn-error.ts                  # Backend-failure reason to inline input-error message
      message-plate.ts               # Message-window name plate and OS drag handle
      anchor.ts                      # Pure mapping from the on-screen feet to the input's bottom offset
      markdown.ts                    # Speech markdown rendering through marked and DOMPurify
      image-resize.ts                # Downscales and re-encodes user-attached images
      fade-out.ts                    # Settle callback for elements that fade before leaving the a11y tree
      reflect-unless-editing.ts      # Writes a store value onto an input unless the user is editing it
      format-accel.ts                # Renders an accelerator string for display
      i18n.ts                        # Locale type, persisted locale, lookup, and subscriber notification
      cue-list.ts                    # Reusable cue-list section for schedule and proactive cues
      quick-controls.ts              # Quick-controls panel: header, tab strip, and tab body
      capture-indicator.ts           # Always-on screen-capture privacy tell
      voice-input-indicator.ts       # Voice-input indicator surface
      voice-input-status.ts          # Voice-input status model
      voice-error-dwell.ts           # How long a voice-turn failure holds the indicator's error state
      boot-error.ts                  # Boot-failure notice card
      chain-reset-notice.ts          # One-off notice when the backend resets a broken response chain
      ingress-dead-notice.ts         # One-off notice when the Rust agent ingress listener dies
      first-run-hint.ts              # First-run controls hint through the speech bubble
      mock.ts                        # Mock driver that replays every surface state from seed data
      tokens.css                     # Design tokens: colour, radius, shadow, duration
      surfaces.css                   # Speech bubble, text input, and tool-status chip styles
      message-window.css             # Message-window layout and name-plate styles
      quick-controls.css             # Quick-controls shell, tabs, rows, and switch styles
      cue-list.css                   # Cue-list section styles
      capture-indicator.css          # Capture-indicator pill styles
      voice-input-indicator.css      # Voice-indicator pill styles
      boot-error.css                 # Boot-failure notice styles
      i18n/                          # Locale catalogs
        en.ts                        # English strings, the source of truth for the key set
        ja.ts                        # Japanese strings
        ko.ts                        # Korean strings
      devtools/                      # Developer Tools window views
        shell.ts                     # Developer Tools window shell and section navigation
        context-inspector.ts         # Client-context inspector view
        advanced-settings.ts         # Advanced settings view
        motion-preview.ts            # Motion and emotion preview, lazy-loaded
        devtools.css                 # Developer Tools shell styles
        motion-preview.css           # Motion-preview styles
      quick-controls/                # Quick-controls shell parts and sections
        template.ts                  # Panel markup as pure string construction
        popover.ts                   # Popover shell: positioning, dragging, open and close lifecycle
        reflect.ts                   # Store to DOM reflection for every panel section
        constants.ts                 # Display constants shared by the panel and its sections
        sections.ts                  # Wires the collapsible details groups to the sections store
        switch-row.ts                # Switch-row element contract
        hint-tooltip.ts              # Shared hover, focus, and click tooltip for data-tip elements
        endpoints-section.ts         # Endpoint URL fields, API-key rows, chat-API picker, and resets
        monitors-section.ts          # Screen-source list and its load state
        history-section.ts           # History tab session accordion over the persisted transcript
        workflows-section.ts         # Workflow entry list editing
        express-motion-section.ts    # Category accordion curating the agent-selectable motion vocabulary
        idle-motion-section.ts       # Per-variant switches for the ambient idle pool
        filler-tool-lines.ts         # Textarea round-trip for the filler pool's tool tier
        speaker-list.ts              # Speaker radiogroup with reference-voice refresh and audition
        vrm-list.ts                  # VRM radiogroup: render, rename, import, swap, keyboard
        user-asset-list.ts           # Shared scaffolding for the VRM and speaker asset radiogroups
        endpoints-section.css        # Endpoints section and yui-select dropdown styles
        monitors-section.css         # Monitors section styles
        history-section.css          # Session history accordion styles
        workflows-section.css        # Workflows section styles
        express-motion-section.css   # Express-motion accordion styles
        hint-tooltip.css             # Hint tooltip styles
        speaker-list.css             # Speaker list styles
        user-asset-list.css          # User asset list row styles
  src-tauri/
    tauri.conf.json                  # Transparent always-on-top pet window
    src/                             # Rust shell
      main.rs                        # Binary entry that calls into lib.rs
      lib.rs                         # Tauri builder: plugins, commands, windows, and the watcher startup
      drag.rs                        # OS-native window drag with multi-monitor and DPI correction
      window_frame.rs                # Lifts AppKit frame constraining and applies logical window frames
      passthrough.rs                 # Click-through toggle over the transparent overlay
      screenshot.rs                  # Screen-source enumeration and off-thread display capture
      agent_ingress.rs               # Loopback HTTP ingress for agent hooks, signals, and the avatar RPC surface
      witness.rs                     # Transition-only log of frontmost app and idle state
      turn_log.rs                    # Appends one opaque JSON line per turn record
      log_rotation.rs                # Calendar-date log rotation with a retention window
      import_fs.rs                   # Shared import filesystem helpers: sanitize, hash, collision, signature sniff
      vrm_import.rs                  # Native copy of a user-picked .vrm into app data
      voice_import.rs                # Native copy of a user-picked reference clip into app data
      tray.rs                        # System tray menu and its show and hide actions
      os_event_watcher/
        mod.rs                       # OS polling loop that emits os_event to the webview
        macos.rs                     # macOS idle, window enumeration, and camera polling
        windows.rs                   # Windows idle, foreground window, and window enumeration polling
  Mods/                              # Standalone MCP servers, independent of the app runtime (Python/uv, own `mods` CI job)
    avatar/                          # Avatar body-state and movement Mod
    browser-cdp/                     # Browser CDP Mod
    desktop-control/                 # macOS screen and app-control Mod
    shell-sandbox/                   # Sandboxed shell Mod
    router/                          # Shared Mod router
    docker-compose.yml               # Container orchestration for Mods
    README.md                        # Mod setup and operation
  integrations/                      # Backend-side integrations, independent of the YUI app runtime
    hermes/
      desire/                        # Agent desire middleware, state helpers, monitor, and prompts (Python/uv)
      skills/                        # Backend-agent skills (yui-dispatch)
  docs/                              # Design source of truth
```
