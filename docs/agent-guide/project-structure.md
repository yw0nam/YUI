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
  phone.html                         # Phone-window Vite entry, the Android window
  vite.config.ts                     # Dev port YUI_DEV_PORT|1420, strictPort, host 127.0.0.1
  biome.json                         # Format and lint config (curated rule set)
  scripts/                           # Dev launchers (dev-port.mjs, tauri-dev.mjs for tauri:dev and android:dev, dev-auto.mjs) and their shared package-manager.mjs helper, release.sh, worktree-setup.sh, ci/test-guard.sh
  configs/                           # Runtime-loaded config (no hardcoding)
    endpoints.json                   # chat/stt/tts/broker base urls + chat_instructions, chat_api, chat_model_context_window + stt_model/tts_provider/tts_model/tts_speaker/tts_max_inflight; the shipped configs/endpoints.json omits the url and speaker keys, and the settings panel overrides per device
    emotion_registry.json            # emotion id -> vrm_expression + fallback
    motions.json                     # Motion registry
    avatar.json                      # VRM avatar config
    filler.json                      # Backed-off filler schedule + first/repeat/long_wait/tool/timeout/unreachable phrase pools
    guardrails.json                  # Dispatcher cooldown/suppression + attachment caps (max_count, max_image_bytes)
    hotkeys.json                     # Global summon accelerator (empty = disabled)
    screen.json                      # Frontmost-transition detector thresholds (dwell/settle/session/gap/quiet)
    emotion_text/                    # Emoji voice-tag vocabulary, loaded only when tts_provider is irodori (emotion_text/irodori.json)
  public/motions/                    # VRMA motion assets
  src/
    app/                             # Composes the pet window from the layers below
      bootstrap-configured.ts        # Pet window's config-derived bootstrap: runs the turn core and the pet-only wirings in order and drains their teardowns
      disposers.ts                   # Shared teardown bag: registers teardowns at creation sites and drains them LIFO
      turn/                          # The path of a turn: sources, voice, and push
        turn-core.ts                 # The chat turn every backend-facing window runs: voice, dispatcher, STT, VRM load, broker, push transport, stop, and submit
        wire-dispatcher.ts           # Turn feed, backend caller, guardrails, pacer, and the dispatcher
        wire-sources.ts              # Tauri window sources and the dispatcher's paced proactive sources
        wire-voice.ts                # Expression broker client and the voice-input and turn-voice wiring
        wire-voice-pipeline.ts       # Wires filler, TTS, and speech playback to the turn lifecycle
        wire-push.ts                 # Push socket frames into turns, the stop button, and the push mode chip
        push-stores.ts               # The push socket, its chat id, and the delegations and reasoning stores its frames feed
      stage/                         # What is bound to the pet window's stage and overlay
        stage-renderer.ts            # The renderer on the stage with its persisted camera and idle throttle, plus Tier 1 liveliness, for the pet and phone windows
        wire-gestures.ts             # Pointer gestures on the stage: taps, pats, the window drag, and the camera orbit
        wire-locomotion.ts           # Travel frame, the five locomotion loops, and the window sources composed into one handle
        wire-pet-stage.ts            # Stage wheel zoom, the persisted camera and throttle flow, and the feet-follow input anchor
        wire-summon.ts               # Peek state and exit triggers, tray summon, and the global summon hotkey
        wire-stage.ts                # Click-through hit-test and cursor-gaze wiring over the stage
      dev/                           # DEV-only console handles
        wire-dev-globals.ts          # The DEV console and global handles for inspection and firing dispatcher events
      cross-window/                  # State the windows share
        wire-cross-window.ts         # Per-window sync for the pet, settings, and devtools windows
        wire-window-sync.ts          # Settings broadcast, guardrail overrides, and the shared cross-window sync core
      controls/                      # The pet window's summonable control surfaces
        wire-pet-controls.ts         # Quick-controls panel, remounted on locale change, and the stage context menu
      settings/                      # Selections and conversation state applied to the running app
        config-defaults.ts           # The quick-controls getters over the bundled config, shared by the pet and settings windows
        conversation-stores.ts       # Constructs the four shared io/chat conversation stores each window owns and disposes
        window-stores.ts             # Creates the settings and conversation store bags of the pet and phone windows and registers each store's teardown
        wire-avatar.ts               # VRM and speaker selection stores, their swap and import flows, the voice-list refresh on override commits, and the avatar config applied at boot
        wire-config.ts               # The config store over the bundled configs, the runtime key stores, the live endpoint/guardrail merges, and the reload/watch wiring
        wire-cue-locale-sync.ts      # Reseeds untouched built-in cues when the display language changes
      message/                       # The message window's wiring
        wire-message-surface-ops.ts  # Draws each surface op from the pet window onto the surfaces and the plate
        wire-message-tauri-window.ts # Window focus, the OS drag, the content-height resize, and the moved-position record
      settings-window/               # The settings window's wiring
        wire-settings-window.ts      # Stores, config, cross-window sync, and the quick controls remounted on locale change
        wire-voice-mirror.ts         # Mirrors the voice toggle to the pet window and the pet window's voice state back
      voice/                         # Desktop voice wiring
        voice-fix.ts                 # The desktop pill's setup-needed tap: open Connection, then back to listening
      phone/                         # The phone window's config-derived half
        bootstrap-phone.ts           # Phone window's config-derived bootstrap: starts and connects the turn core under one teardown bag
        stage/                       # The phone stage's touch camera and tap
          wire-phone-stage.ts        # Upper-body fit band, the tap source and the stage touch gesture composed for the phone
          touch-camera.ts            # Binds orbit, pinch and tap callbacks to the camera store and the tap
          stage-tap.ts               # Hands a tap to the tap source in stage-local px
        voice/                       # The phone's voice input
          voice-controller.ts        # Capture intent over the mic button, the voice mode, the foreground and the STT setting
    logger.ts                        # Namespaced frontend logger with a runtime level
    tauri-env.ts                     # Tauri runtime detection
    windows/                         # One entry file per window, loaded by the matching HTML file
      main.ts                        # Pet window: config load, renderer, dispatcher, and the I/O graph
      settings-main.ts               # Settings window: mounts the settings window wiring
      devtools-main.ts               # Developer Tools window
      message-main.ts                # Message window
      phone-main.ts                  # Phone window: stage, persistent composer, and push chat
    styles.css                       # Pet-window base stylesheet
    vite-env.d.ts                    # Vite client types and build-time env declarations
    contract/                        # TS contract types — the wire schema source of truth
      types.ts                       # Wire schema source of truth for the YUI to backend contract
      index.ts                       # Contract barrel
    config/                          # Config load, validate, reactive store, hot-reload, and the runtime URL resolver
      load.ts                        # configs/*.json loader and validation, fail-loud
      asset-url.ts                   # Bundled asset paths and imported user files to runtime-fetchable URLs
      store.ts                       # Reactive config snapshot with hot-reload and change subscriptions
      emotion-text.ts                # Per-provider emotion_text emoji table loader
      tts-provider.ts                # The tts_provider values and the Irodori default for an unset one
      validators/
        avatar/                      # Validates avatar.json, one file per section
          index.ts                   # Router: the early throws, section calls in order, and the result
          helpers.ts                 # Shared issue-recording field readers and unknown-key check
          available.ts               # The available VRM manifest
          framing.ts                 # The fit-to-bounds camera
          hit-test.ts                # Click-through polling and the alpha cut
          tap.ts                     # Tap regions and touch cues
          peek.ts                    # Side-peek geometry
          walk.ts                    # Floor stroll and window-top stroll
          fall.ts                    # Drag-release fall and monitor descent
          climb.ts                   # Ambient window climb
          jump.ts                    # Window-to-window flight
          gestures.ts                # Drag-hold duration and gesture cues
          gaze.ts                    # Cursor tracking angles and damping
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
      types.ts                       # Renderer options, per-frame tick context, and the Renderer surface
      apply-directive.ts             # Pure routing of a control envelope into the emotion and motion sinks
      frame-loop.ts                  # The rAF loop with its clock, hidden-document pause, and idle-throttle gate
      pin-controller.ts              # Stateful perch and peek pin apply layer
      vrm-loading.ts                 # VRM optimisation of a loaded glTF and the display-name read
      vrm-participant.ts             # The per-frame lifecycle every VRM-bound sub-controller implements
      camera/                        # Camera framing, zoom, and orbit state
        rig.ts                       # Fit-to-bounds framing, wheel zoom, the eased orbit polar, and the travel view window
      geometry/                      # Pure math and pixel sampling with no three.js state
        alpha-hit-test.ts            # CPU-side low-res silhouette grab and sampling
        body-yaw.ts                  # Pure easing math for the root yaw a stroll turns by
        bone-pitch.ts                # Sign that turns a downward head pitch into a normalized bone's local rotation.x
        camera-fit.ts                # Pure fit-to-bounds framing math
        fit-band.ts                  # Pure height-bound fit of a vertical band of the model box
        frame-gate.ts                # Pure idle and active frame-throttle decision
        gaze-tracker.ts              # Pure cursor-gaze zone curve and angle damping
        hit-test.ts                  # Pure helpers for the alpha silhouette predicate
        perch-geometry.ts            # Pure math for the window-sit perch
        pixel-ratio.ts               # Pure devicePixelRatio clamp
        project-anchor.ts            # Projects the world feet point into canvas pixels
        screen-probes.ts             # Read-only screen probes of the loaded model: feet anchor, width, seat and tap points, hand anchors, pixels per metre
        stage-coords.ts              # Client CSS px to stage-local coordinate conversion
        tap-region.ts                # Classifies a tap point into a body region
        view-window.ts               # Draws the reference-size framing at an offset inside a parked canvas
      motion/                        # Clip scheduling, variant swaps, and clip processing
        clip-library.ts              # Per-VRM .vrma clip cache: load, mirror, root-lock detrend, dead-clip memo, crossfade clone
        cycle-dwell.ts               # Single-timer scheduler for a cycle motion's variant swap
        mirror-clip.ts               # Mirrors a clip across the YZ plane
        motion-controller.ts         # Pure motion scheduling and variant-resolution state machine
        motion-fallback.ts           # Idle-fallback decision for a motion whose clip fails to load
        motion-playback.ts           # Mixer-driven motion playback: controller decisions, action crossfade, finish → next, idle baseline
        motion-start-generation.ts   # Tracks which asynchronous motion start owns mixer playback
        perch-hold.ts                # Held-posture suppression and baseline rules
        recenter-root-motion.ts      # Strips baked horizontal drift from VRMA root motion
        root-yaw.ts                  # Eased root yaw the ambient stroll turns the character by, written onto the model's base rotation each frame
        self-crossfade.ts            # Clip-cache key composition and playback clip selection
      expression/                    # Emotion, mouth, and gaze apply layers over the face
        cursor-gaze.ts               # Stateful three.js apply layer for cursor head and eye tracking
        ease-emotion.ts              # Eases the expression back to neutral when playback ends
        emotion-crossfade.ts         # Stateful VRM-expression crossfade apply layer
        emotion-resolver.ts          # Pure expression lookup and fallback-chain traversal
        mouth-lipsync.ts             # Amplitude-only mouth state machine and expression describe helper
    dispatcher/                      # Event bus + classify, guardrail, route
      dispatcher.ts                  # The router that enforces the firing-is-not-judgment boundary
      core/
        classify.ts                  # Pure tier and target classification of a bus envelope, plus the paced-source table
        event-bus.ts                 # Priority queue collecting every speech-candidate event
        guardrails.ts                # Cooldown, debounce, and rate-limit evaluation
        proactive-pacer.ts           # The quiet gap after a turn that every proactive source shares
        tier1-directive.ts           # Pure tier-1 control directive for sit, drop, peek and pat events
        tier1-render.ts              # Tier-1 rendering: local directives, posture ledger, pin targets, and the tap-emotion revert
      turn/
        turn.ts                      # Turn identity ledger and the single definition of over
        turn-output.ts               # Speech lifecycle port between the backend caller and the voice pipeline
        push-turn.ts                 # Push-turn ids the user stopped, so their late frames drop whole, and the wait for a sent turn to finish
        quoted-turn.ts               # The admitted user turn the bubble quotes, and what was observed of it
        render-turn.ts               # Plays a finished backend turn that arrived as a render frame on the push socket
        turn-feed.ts                 # Shared tool-status and reasoning consumer for every transport
      backend/
        backend-caller.ts            # Sends a tier-2 event to backend judgment and streams the reply
        push-call.ts                 # Push transport path of a turn: frame send and the wait for its turn_end
        turn-recording.ts            # Records a sent turn into the transcript, the context history, and the turn-record log
        request-input.ts             # Pure encoders for a turn's Responses input: client_context block and user item
        turn-outcome.ts              # How a backend call settled
        background-marker.ts         # Placeholder user-content text for a turn with no real user utterance
        idle-watchdog.ts             # Idle-gap watchdog over the backend event stream and its two timeout budgets
        context-builder.ts           # Builds the per-turn client context and image attachments
        client-context-text.ts       # Renders a client context into the plain-line prompt block
        previous-turn.ts             # Persisted record of how the last turn that tried to speak ended
      sources/
        buffered-inbox-source.ts     # Shared presence-gated core for the inbox-push firing sources
        agent-source.ts              # Agent-lifecycle firing source
        signals-source.ts            # Grouped signals-ingress firing source
        proactive-source.ts          # Idle-gap proactive firing source
        schedule-source.ts           # Clock-time schedule firing source
        milestone-source.ts          # Once-per-day first-activity milestone firing source
        screen-source.ts             # Frontmost-app transition firing source with a dwell state machine
        user-input-source.ts         # Normalises typed text and STT results into bus envelopes
        tap-source.ts                # Turns taps on the character into bus envelopes
        drag-hold-source.ts          # Fires one proactive.drag_held candidate per sustained drag
        window-drop/                 # Drag-release perch settle, armed-perch poll, and placement
          window-drop-source.ts      # Drag-release settle composing the perch watch and placement
          perch-watch.ts             # Armed perch and peek state with the occlusion-aware detach poll
          placement.ts               # Programmatic placement of the character on a named window
    ambient/                         # Backend-independent local liveliness and movement
      liveliness/                    # Tier 1 idle-life engine and its cue math
        tier1.ts                     # Tier 1 ambient engine: blink, idle sway, breath, look-around
        cues.ts                      # Pure, side-effect-free cue math for Tier 1
      locomotion/                    # Movement loops: stroll, perch, climb, jump, fall, and sit transitions
        walker.ts                    # Floor stroll along the monitor's work-area bottom
        percher.ts                   # Perched dwell, stroll, and sit-back-down on a foreign window top
        climber.ts                   # Climb up a window or screen edge, dwell, and climb back down
        climb-geometry.ts            # Pure wall geometry and the climb and descent target picks
        jumper.ts                    # Jump across to an adjacent window top
        faller.ts                    # Fall to the first surface below a character left in mid-air
        sitter.ts                    # Sit-down and stand-up seat transitions
        clip-leg.ts                  # A window leg paced by an in-place clip
        wire.ts                      # Travel frame plus the walk, perch, fall, and climb ambient loops
    settings/                        # Persisted user settings, one store per setting, grouped by the part of the app they configure
      persisted-store.ts             # Shared bootstrap, notify, reload, and localStorage core for the settings stores
      settings-stores.ts             # Constructs and synchronises the persisted user-setting stores
      backend/                       # What the backend connection uses
        agent-settings.ts            # Reasoning effort and system-instructions override
        agent-notify-settings.ts     # Agent-notification enabled flag and listener port
        api-key-settings.ts          # Generic API-key override store behind the chat, STT, and TTS key settings
        chat-id-settings.ts          # Conversation id this installation sends in every push hello
        endpoints-settings.ts        # User-editable endpoint and model overrides
        guardrails-settings.ts       # User-editable guardrail rate-limit caps
        workflow-settings.ts         # Workflow entry list and URL validation
      cues/                          # Proactive and schedule cue lists
        cue-list-settings.ts         # Shared on/off flag plus editable cue list behind the schedule and proactive stores
        proactive-settings.ts        # Idle-gap proactive cue list and its on/off flag
        proactive-seeds.ts           # Per-locale default proactive cues seeded on a first run
        schedule-settings.ts         # Clock-time schedule cue list and its on/off flag
        schedule-seeds.ts            # Per-locale default schedule cues seeded on a first run
      capture/                       # Screen watching and screenshots
        screen-settings.ts           # User-editable screen-watch thresholds
        screenshot-settings.ts       # Screenshot enabled state and source
      avatar/                        # Camera, motion, and lip-sync
        camera-settings.ts           # Camera zoom and orbit viewpoint
        camera-gestures.ts           # Maps orbit moves and pinch ratios onto the camera store
        express-motion-settings.ts   # Curates the motion vocabulary the agent may choose from
        idle-motion-settings.ts      # Selects which ambient idle variants may play
        lipsync-settings.ts          # Lip-sync gain
      voice/                         # Filler speech and voice activity detection
        filler-settings.ts           # Filler phrase pools and behaviour flags
        vad-settings.ts              # VAD silence window
        voice-mode.ts                # The phone's mic mode: tap to toggle or keep listening
      panels/                        # Panel and window state
        delegation-chip-settings.ts  # Per-device fold state of the delegation chip
        message-window-settings.ts   # Message-window mode and last outer position
    io/                              # I/O layer: chat, voice, window and OS seams
      chat/
        chat-client.ts                 # Adapter over the openai SDK Responses stream
        chat-completions.ts            # Pure Chat Completions request builders and stream-chunk reducer
        chat-completions-stream.ts     # Chat Completions streaming loop with its tool round trips
        stream-helpers.ts              # Express-tool and error helpers both streaming loops use
        chat-history-store.ts          # Unified conversation transcript with session boundaries
        client-tools.ts                # Registry of the tools YUI declares and runs itself
        context-history.ts             # Capped ring of recent client-context entries
        session-store.ts               # Holds the last Responses response.id for conversation continuation
        session-diagnostics.ts         # Used tokens and context window for the settings window
        secret-provider.ts             # Resolves each secret from its runtime store, then the build-time fallback
        broker-client.ts               # Write-only Expression Broker MCP client that publishes the renderable vocabulary
        broker-override-reconciler.ts  # Applies a broker-URL override to the live broker client
        turn-record-log.ts             # Appends one JSONL record per completed turn or skipped fire
        push-socket.ts                 # Single WebSocket the push transport runs turns and replies on
        silence-token.ts               # Stateful [SILENT] token filter for spoken output_text deltas
      voice/
        deadline.ts                    # Per-request deadline and the body-read race that settle a stalled fetch
        stt-vad.ts                     # Voice input pipeline: VAD segmentation then STT upload
        mic-error.ts                   # The mic failure cause codes the voice status carries
        filler/                        # TTFT filler phrases spoken while a turn is thinking
          filler-loop.ts               # Bounded, event-aware TTFT filler scheduler
          filler-pool.ts               # Resolves the effective filler pool per language and tier
          filler-audio-cache.ts        # Session-scoped audio memo for filler phrases
          shuffle-bag.ts               # Draws phrases without replacement until the pool is exhausted
        tts/                           # Speech synthesis, in-order playback, and the spoken-text filters
          sentence-segmenter.ts        # Segments streamed text into sentences
          strip-emoji.ts               # Stateful emoji stripper for spoken text deltas
          strip-links.ts               # Stateful markdown-link stripper for spoken text deltas
          tts-pipeline.ts              # Sentence-level TTS synthesis with in-order playback
          tts-synth.ts                 # Single-sentence speech synthesis request, shaped per TTS provider
          audio-player.ts              # Web Audio sink that plays a wav clip and reports mouth-open amplitude
          speech-playback.ts           # Glue between TTS playback, the renderer mouth, and bubble lifetime
        voices/                        # The speaker catalogue: selection, the voices API, and voice import
          tts-voices.ts                # Lists, uploads, and deletes reference voices on Irodori's voices API
          voice-apis.ts                # Voice list, upload, and delete per TTS provider; OpenAI's fixed built-in list
          voice-import.ts              # Voice import: OS picker, native copy, speaker registration
          voice-import-flow.ts         # Two-step voice import so a naming row sits between pick and copy
          voice-list-refresh.ts        # Refetches the TTS server's voice list into a speaker manifest
          reference-clip.ts            # Reference-clip URL resolution and transport selection
          speaker-selection.ts         # Owns the active TTS speaker selection
      stage/                           # What every stage surface shares for pointer gestures
        press-travel.ts                # Pointer travel past which a press is a drag
        touch/                         # Touch gestures on the stage
          touch-gesture.ts             # Pure orbit, pinch and tap recognizer over pointer ids
          stage-touch.ts               # Feeds the stage's pointer events into the recognizer
      window/
        tauri-listen.ts                # Shared os_event channel payload shape and listen resolver
        frontmost-tracker.ts           # Latest frontmost-window sample off the os_event channel
        own-origin-fetch.ts             # Keeps each webview's own origin on native fetch instead of the CORS proxy
        capture/                       # Screen enumeration and screenshot capture
          tauri-screen.ts              # Tauri-backed screen enumeration and capture
          screen-source-provider.ts    # Monitor enumeration seam
          screenshot-context.ts        # Pure encoder for the screenshot context block
        geometry/                      # Monitor and floor math the window movers share
          screen-geometry.ts           # Monitor containment, work-area floor math, and window clamping shared by every window mover
          keep-on-screen.ts            # Pushes a window back until its centre lands on a monitor
          travel-frame.ts              # Parks the real window once for a scale-seam crossing
          perch.ts                     # Perch values, perch-target and placement types, and the host-edge span shared by the drop source, avatar RPC and locomotion
        openers/                       # Openers and placement of the message, settings, and devtools windows
          settings-window.ts           # Settings window opener and cross-window settings sync
          devtools-window.ts           # Developer Tools window opener
          message-window.ts            # Message-window opener and its placement rule
          message-window-mode.ts       # Keeps the message window in step with the stored mode and the dock request
        pet/                           # The pet window's own gestures, hit-test, gaze cursor, and peek
          window-statics.ts            # Cached window origin and scale factors for the global-cursor poll loops
          cursor-tracker.ts            # Forwards the OS cursor position to the gaze apply layer
          hit-test.ts                  # Click-through hit-test controller for the transparent window
          peek-state.ts                # Holds the current peek side and its lifecycle
          gesture/                     # The three pointer-gesture detectors the stage wires
            orbit-gesture.ts           # Shift + left-drag camera orbit gesture detector
            click-gesture.ts           # Sub-threshold click and press-and-hold pat detectors
            window-drag.ts             # Threshold-gated OS-native drag handoff for the main window
          window-resize-source.ts      # Ctrl+wheel over the character resizes the pet window
          summon-hotkey.ts             # Registers the OS-wide summon accelerator and summons the input
      bridge/
        settings-bridge.ts             # Typed cross-window settings bus over Tauri emit and listen
        core/                          # The cross-window bus every bridge here is built on
          bridge-core.ts               # Transports, message envelope and listener bookkeeping shared by every bridge
          state-mirror.ts              # One window's value published to the others and mirrored back
        message-bridge.ts              # Cross-window bus linking the pet window and the message window
        message-remote.ts              # The message window's bubble and input as a remote Surfaces half
        push-socket-bridge.ts          # Push socket state as seen from a window that does not own it
        delegations-store.ts           # Background work the backend reports on the push socket
        delegations-bridge.ts          # Delegations list as seen from a window that does not own the push socket
        delegation-history.ts          # Every delegation the client has seen, persisted for the settings window's Session section
        reasoning-store.ts             # Backend reasoning text as the current turn writes it
        reasoning-bridge.ts            # Reasoning text as seen from a window that does not own the push socket
        inbox/                         # The Tauri inbox seam and the channels read through it
          avatar-rpc.ts                # Webview end of the loopback avatar RPC surface
          avatar-executor.ts           # Answers the bridged avatar RPCs from live client state
          agent-inbox.ts               # Subscribes to the Rust agent-inbox event channel
          signals-inbox.ts             # Subscribes to the Rust signals-inbox event channel
          create-inbox.ts              # Generic Tauri event-channel subscription seam
      assets/
        vrm-import.ts                  # VRM import: OS picker, native copy, avatar-option registration
        user-asset-import.ts           # Dialog result shape, lazy Tauri loaders, and orphan cleanup shared by the voice and VRM imports
        vrm-selection.ts               # Owns the active VRM selection
        selection-store.ts             # Generic selection store behind VRM and speaker selection
        safe-id.ts                     # TS mirror of the native stem sanitizer for persisted option ids
    ui/                              # Floating surfaces, panels, and indicators
      i18n.ts                        # Locale type, persisted locale, lookup, and subscriber notification
      tokens.css                     # Design tokens: colour, radius, shadow, duration
      surfaces/                      # Speech-bubble and text-input host surface
        surfaces.ts                  # Mounts the speech bubble and text input as one system, forwarding tool status
        surfaces-router.ts           # One Surfaces handle over the pet window and the message window
        wire.ts                      # Local surfaces plus the message-window bridge, routed by the stored window mode
        summon-key.ts                # Binds the focused window's "/" key to open the text input
        anchor.ts                    # Pure mapping from the on-screen feet to the input's bottom offset
        reflect-unless-editing.ts    # Writes a store value onto an input unless the user is editing it
        interactive-overlay.ts       # Selectors of overlay elements that take OS pointer events while shown
        mock.ts                      # Mock driver that replays every surface state from seed data
        surfaces.css                 # Speech bubble and text input styles
      input/                         # Text entry and its supporting transforms
        text-input.ts                # Text input: submit, busy, error, and feet anchoring
        action-button.ts             # The composer's stop, send and mic button
        image-resize.ts              # Downscales and re-encodes user-attached images
        format-accel.ts              # Renders an accelerator string for display
      message/                       # Message-window plate, bubble, and cue-list rendering
        speech-bubble.ts             # Speech bubble: dwell, scroll, markdown, and aria for streamed speech
        user-quote.ts                # The user's message quoted on the bubble's first line
        reasoning-disclosure.ts      # Backend reasoning folded under the quoted line at the top of the bubble in the message and phone windows
        message-plate.ts             # Message-window name plate and OS drag handle
        markdown.ts                  # Speech markdown rendering through marked and DOMPurify
        cue-list.ts                  # Reusable cue-list section for schedule and proactive cues
        message-window.css           # Message-window layout and name-plate styles
        cue-list.css                 # Cue-list section styles
      chips/                         # Status and delegation chips beside the avatar and on the message-window plate
        status-pill.ts               # Status pill: capture, voice, and backend tool tells in one pill
        tool-labels.ts               # Tool id to display label lookup
        delegation-chip.ts           # Push-transport delegation chip beside the avatar with its tap-to-toggle list popover
        delegation-rows.ts           # Delegation list's shared row rendering and relative time text
        voice-input-status.ts        # Voice-input status model
        voice-error-dwell.ts         # How long a voice-turn failure holds the status pill's voice error state
        status-pill.css              # Status-pill styles
        delegation-chip.css          # Delegation-chip pill, list popover, and folded-dot styles
        delegation-rows.css          # Delegation row styles shared by the chip's list and the settings panel
      notices/                       # One-off and error notices
        turn-error.ts                # Backend-failure reason to inline input-error message
        fade-out.ts                  # Settle callback for elements that fade before leaving the a11y tree
        boot-error.ts                # Boot-failure notice card
        chain-reset-notice.ts        # One-off notice when the backend resets a broken response chain
        ingress-dead-notice.ts       # One-off notice when the Rust agent ingress listener dies
        first-run-hint.ts            # First-run controls hint through the speech bubble
        boot-error.css               # Boot-failure notice styles
      phone/                         # Phone-window layout
        phone-viewport.ts            # Sizes the phone root to the visual viewport and writes the keyboard overlap
        phone.css                    # Phone root, safe area, stage background, and touch-sized composer and bubble
      quick-controls/                # Quick-controls shell parts and sections
        quick-controls.ts            # Quick-controls panel: header, tab rail, and tab body
        quick-controls.css           # Quick-controls shell, tab rail, sections, groups, and rows
        controls.css                 # Switch, segment, field, text-button, disclosure, slider, and confirm styles
        template.ts                  # Panel markup as pure string construction
        popover.ts                   # Popover shell: positioning, dragging, open and close lifecycle
        reflect.ts                   # Store to DOM reflection for every panel section
        constants.ts                 # Display constants shared by the panel, its sections, and the chips that reuse its glyphs
        switch-row.ts                # Switch-row element contract and the row table filling it
        seg-keyboard.ts              # Arrow, Home, End and commit keyboard handling shared by the segmented controls
        slider-binding.ts            # Input and release wiring shared by the range sliders
        hint-tooltip.ts              # Shared hover, focus, and click tooltip for data-tip elements
        hint-tooltip.css             # Hint tooltip styles
        character/                   # Character tab shared by the desktop panel and the phone settings view
          character-tab.ts           # Tab shell: the rows the caller picks, their subscriptions, open and close hooks
          character-html.ts          # Tab markup per row set and surface
          gain-row.ts                # Mouth-gain slider with its live preview
          viewpoint-row.ts           # Camera view reset button
          vrm-list.ts                # VRM radiogroup: render, rename, import, swap, keyboard
          idle-motion-section.ts     # Per-variant switches for the ambient idle pool
          express-motion-section.ts  # Category accordion curating the agent-selectable motion vocabulary
          vrm-list.css               # VRM list styles
          express-motion-section.css # Express-motion accordion styles
        connection/                  # Connection tab and its endpoint/API-key section
          endpoints-section.ts       # Endpoint URL fields, API-key rows, chat-API picker, and resets
          endpoints-section.css      # Endpoints section and yui-select dropdown styles
        cue-lists/                   # Schedule and proactive cue lists of the Proactive tab
          cue-lists.ts               # Mounts and tears down the two cue lists
        delegations/                 # Delegated-work refresh for the session section
          delegation-sync.ts         # Minute refresh timer that follows the running delegated items
        history/                     # History tab and its session accordion section
          history-section.ts         # History tab session accordion over the persisted transcript
          history-section.css        # Session history accordion styles
        sections/                    # The tab sections the shell mounts and the list helpers only they use
          agent-section.ts           # Locale segment, reasoning-effort segment, and instructions textarea
          monitors-section.ts        # Screen-source list and its load state
          screen-section.ts          # Screen-watch threshold knobs and the min-gap slider
          reactions-section.ts       # Agent-port, presence, pacer-gap, and rate-limit cap inputs
          workflows-section.ts       # Workflow entry list editing
          filler/                    # Thinking-filler section
            filler-section.ts        # Language segment and phrase-pool textareas, with their store reflect
            filler-tool-lines.ts     # Textarea round-trip for the filler pool's tool tier
          speaker-list.ts            # Speaker radiogroup with reference-voice refresh and audition
          user-asset-list.ts         # Shared scaffolding for the VRM and speaker asset radiogroups
          monitors-section.css       # Monitors section styles
          session-section.css        # Session context-occupancy readout and meter styles
          workflows-section.css      # Workflows section styles
          speaker-list.css           # Speaker list styles
          user-asset-list.css        # Radio row, tick, and state styles shared by the monitor, VRM, and speaker lists
      i18n/                          # Locale catalogs
        en.ts                        # English strings, the source of truth for the key set
        ja.ts                        # Japanese strings
        ko.ts                        # Korean strings
      devtools/                      # Developer Tools window views
        shell.ts                     # Developer Tools window shell and section navigation
        shell-rebuild.ts             # Locale-driven shell rebuild that keeps focus
        context-inspector.ts         # Client-context inspector view
        advanced-settings.ts         # Advanced settings view
        motion-preview.ts            # Motion and emotion preview, lazy-loaded
        devtools.css                 # Developer Tools shell styles
        motion-preview.css           # Motion-preview styles
  src-tauri/
    tauri.conf.json                  # Transparent always-on-top pet window
    tauri.android.conf.json          # Android overrides: com.yui.mobile identifier, bundled configs and the default VRM only
    capabilities/                    # Per-window permissions; desktop.json holds the desktop-only plugin permissions
    gen/android/                     # Android Studio project generated by `tauri android init`
    src/                             # Rust shell
      main.rs                        # Binary entry that calls into lib.rs
      lib.rs                         # Module declarations and run(), which chains plugins, setup, and commands
      plugins.rs                     # Plugin registration
      setup.rs                       # Startup work: log sink, turn-record log, import sweep, OS watcher, tray
      commands.rs                    # IPC command table
      app_log.rs                     # Log plugin sink, timezone, line format, and log directory
      drag.rs                        # OS-native window drag with multi-monitor and DPI correction
      window_frame.rs                # Lifts AppKit frame constraining and applies logical window frames
      passthrough.rs                 # Click-through toggle over the transparent overlay
      screenshot.rs                  # Screen-source enumeration and off-thread display capture
      agent_ingress/
        mod.rs                       # Loopback HTTP listener for agent hooks, signals, and the avatar RPC surface
        payload.rs                   # Request parsing, size caps, and event payload types
        avatar_rpc.rs                # Avatar RPC bridge between HTTP requests and the webview
      witness.rs                     # Transition-only log of frontmost app and idle state
      turn_log.rs                    # Appends one opaque JSON line per turn record
      log_rotation.rs                # Calendar-date log rotation with a retention window
      import_fs.rs                   # Shared import filesystem helpers: sanitize, hash, dest stem candidates, bounded streamed copy, signature sniff
      vrm_import.rs                  # Native copy of a user-picked .vrm into app data
      voice_import.rs                # Native copy of a user-picked reference clip into app data
      tray.rs                        # System tray menu and its show and hide actions
      os_event_watcher/
        mod.rs                       # OS polling loop that emits os_event to the webview
        drop_release.rs              # Drop-release probe that emits window_drop_release
        pure_helpers.rs              # Idle conversion and frontmost-window pick
        macos.rs                     # macOS idle, window enumeration, and camera polling
        windows.rs                   # Windows idle, foreground window, and window enumeration polling
  fixtures/                          # JSON case tables the TS and Rust sanitizer tests both read
  Mods/                              # Standalone MCP servers, independent of the app runtime (Python/uv, own `mods` and `mods-lint` CI jobs)
    avatar/                          # Avatar body-state and movement Mod
    browser-cdp/                     # Browser CDP Mod
    desktop-control/                 # macOS screen and app-control Mod
    shell-sandbox/                   # Sandboxed shell Mod
    router/                          # Shared Mod router
    docker-compose.yml               # Container orchestration for Mods
    README.md                        # Mod setup and operation
  integrations/                      # Backend-side integrations, independent of the YUI app runtime
    hermes/
      README.md                      # Hermes Agent adapter setup (Responses mode, dev proxy, auth)
      desire/                        # Agent desire middleware, state helpers, monitor, and prompts (Python/uv)
      platform/                      # Hermes gateway push-transport plugin: one WebSocket carrying turns in and finished replies out (Python/uv)
    skills/
      yui-daily-briefing/            # Backend-agnostic skill: scheduled producers write dated markdown briefings (scripts/briefing.py) that the backend agent speaks on first activity
  docs/                              # Design source of truth
```
