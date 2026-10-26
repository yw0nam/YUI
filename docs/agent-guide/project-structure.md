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
  unified.html                       # Unified-chat-window Vite entry
  vite.config.ts                     # Dev port YUI_DEV_PORT|1420, strictPort, host 127.0.0.1, backend proxy plugin
  biome.json                         # Format and lint config (curated rule set)
  scripts/                           # Dev launchers (dev-port.mjs, tauri-dev.mjs for tauri:dev, dev-auto.mjs) and their shared package-manager.mjs helper, dev-backend-proxy.mjs, release.sh, worktree-setup.sh, ci/test-guard.sh, architecture-map-base.mjs (writes the map of origin/main beside the data file for the viewer's Compare view), ci/architecture-map.mjs (checks the client and plugin architecture maps against the tree)
  configs/                           # Runtime-loaded config (no hardcoding)
    endpoints.json                   # chat/stt/tts/broker base urls + chat_instructions, chat_api, chat_model_context_window + stt_model/stt_language/tts_provider/tts_model/tts_speaker/tts_max_inflight; the shipped configs/endpoints.json omits the url and speaker keys, and the settings panel overrides per device
    emotion_registry.json            # emotion id -> vrm_expression + fallback
    motions.json                     # Motion registry
    avatar.json                      # VRM avatar config
    filler.json                      # Backed-off filler schedule + first/repeat/long_wait/tool/timeout/unreachable phrase pools
    guardrails.json                  # Dispatcher cooldown/suppression + attachment caps (max_count, max_image_bytes)
    hotkeys.json                     # Global summon accelerator (empty = disabled)
    screen.json                      # Frontmost-transition detector thresholds (dwell/settle/session/gap/quiet)
    persona.json                     # Default card per UI language (en/ja/ko), the framing sentence, and the {{user}} fallback word
    emotion_text/                    # Emoji voice-tag vocabulary, loaded only when tts_provider is irodori (emotion_text/irodori.json)
  public/motions/                    # VRMA motion assets
  src/
    app/                             # Composes the pet window from the layers below
      bootstrap-configured.ts        # Pet window's config-derived bootstrap: runs the turn core and the pet-only wirings in order and drains their teardowns
      disposers.ts                   # Shared teardown bag: registers teardowns at creation sites and drains them LIFO
      relations/                     # This window's relations wiring
        wire-relations.ts            # rate_relation's open-preset targets and the ingress relations RPC, over the window's store
      turn/                          # The path of a turn: sources, voice, and push
        turn-core.ts                 # The chat turn every backend-facing window runs: voice, dispatcher, STT, VRM load, vocabulary, broker, push transport, stop, and submit
        wire-dispatcher.ts           # Turn feed, backend caller, guardrails, pacer, and the dispatcher
        wire-sources.ts              # The dispatcher's utterance sources, built and started
        wire-card.ts                 # The card module bound to the window's stores, preset, UI language, and config
        wire-greeting.ts             # The greeting after a session reset, and the reset announcement each window's Start fresh makes
        broker/                      # Expression broker wiring
          wire-broker.ts             # The broker client: boot publish, override retargeting, and republish when the vocabulary moves
        vocabulary/                  # The express vocabulary every consumer declares
          wire-vocabulary.ts         # The emotion_text table load, the derived vocabulary, and its change announcements
        push/                        # Push socket wiring and its stores
          delegation-chip-mount.ts   # The delegation chip's lazy mount and its suppression port
          wire-push.ts               # Push socket frames into turns, the stop button, and the push mode chip
          push-stores.ts             # The push socket, its chat id, and the delegations and reasoning stores its frames feed
        voice/                       # Voice input and speech playback wiring
          wire-voice.ts              # The voice-input and turn-voice wiring; a bound window builds no capture
          wire-voice-pipeline.ts     # Wires filler, TTS, and speech playback to the turn lifecycle
      stage/                         # What is bound to the pet window's stage and overlay
        stage-renderer.ts            # The renderer on the stage with its persisted camera and idle throttle, plus Tier 1 liveliness, for the pet window
        bed-scene-hold.ts            # The flag the bed scene takes while it holds the body; the camera lock and the movers read it
        create-avatar-bed.ts         # The bed as the avatar commands see it: phase, the lie-down sequence with the hold, floor placement and perch pins, and getting up
        scene-frame.ts               # The bed scene's window frame over the real window, which is wired later than the scene starts
        wire-bed-scene.ts            # The bed scene's wiring: builds the scene, starts the launch entry, reads the hold and sends the posture events
        wire-gestures.ts             # Pointer gestures on the stage: taps, pats, the window drag, and the camera orbit
        wire-window-sources.ts       # The Tauri window drop and resize sources, the avatar RPC executor, and keep-on-screen
        wire-window-geometry.ts      # The per-window saved size and position: written after the OS drag ends and a Ctrl+wheel resize, applied once at boot
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
        wire-help-guide.ts           # Guide requests submitted as user turns, from the panel's Ask buttons or the settings bridge
      settings/                      # Selections and conversation state applied to the running app
        config-defaults.ts           # The quick-controls getters over the bundled config, shared by the pet and settings windows
        conversation-stores.ts       # Constructs the shared io/chat conversation stores each window owns and disposes
        dev-key-fallback.ts          # The VITE_YUI_*_KEY build-time key values, read in dev builds only
        window-stores.ts             # Creates the settings and conversation store bags and the preset registry of the pet and settings windows and registers each store's teardown
        wire-avatar.ts               # VRM and speaker selection stores, their swap and import flows, the voice-list refresh on override commits, and the avatar config applied at boot
        wire-config.ts               # The config store over the bundled configs, the runtime key stores, the live endpoint/guardrail merges, and the reload/watch wiring
        wire-cue-locale-sync.ts      # Reseeds untouched built-in cues when the display language changes
        wire-preset.ts               # Sends a preset switch over the settings bridge and reloads each unbound window into it, after the pet window stops its turn; a bound window only rereads the list
      pet-windows/                   # Windows bound to one preset: the shared open list, their lifecycle, and the windows each one opens
        pet-window-role.ts           # The entry main composes: the registry and open list a window owns, the orphan check, and main's reconcile or a bound window's self-close
        companion-window.ts          # A companion window's boot: the orphan and owner checks, its own live key, and its teardown on a close request; the pet window's wait for its companions
        wire-pet-windows-sync.ts     # The open list in every window: a local edit out over yui://pet-windows-changed, a remote one reloaded from storage
        wire-pet-windows-reconcile.ts # Main's reconcile: prunes the list and live keys, then opens each wanted preset that has no window
        wire-preset-ids-sync.ts      # Main publishes the registry's preset ids to the shell, so a prefixed ingress route can tell a closed window from an unknown id
        wire-bound-window.ts         # A bound pet window's live key, its companions closed first, and its store teardown and close when its preset leaves the list
        close-if-orphan.ts           # Closes a bound window whose preset is no longer in the registry
      message/                       # The message window's wiring, and the character's name both windows' plates and backlogs show
        wire-message-surface-ops.ts  # Draws each surface op from the pet window onto the surfaces, which the plate follows
        character-name.ts            # In the pet window: the character's effective name, the card's while the built-in preset is unnamed, else the preset's
        mirrored-name.ts             # In the message window: the character's name as the pet window last sent it
      unified/                       # The unified chat window's wiring
        wire-unified-window.ts       # Main opens the window while it shows and destroys it otherwise
        wire-unified-close.ts        # The window closing itself turns the Unified chat switch off
      settings-window/               # The settings window's wiring
        wire-settings-window.ts      # Stores, config, cross-window sync, and the quick controls remounted on locale change, bound to the query's preset when it names one, and editing the preset `?edit=` names
        edit-target-url.ts           # The settings URL with its `edit` param set to the picked preset, or dropped for the window's own
        wire-voice-mirror.ts         # Mirrors the voice toggle to the pet window and the pet window's voice state back; main only
      voice/                         # Desktop voice wiring
        voice-fix.ts                 # The desktop pill's setup-needed tap: open Connection, then back to listening
    logger.ts                        # Namespaced frontend logger with a runtime level
    tauri-env.ts                     # Tauri runtime detection
    windows/                         # One entry file per window, loaded by the matching HTML file
      main.ts                        # Pet window: config load, renderer, dispatcher, and the I/O graph
      settings-main.ts               # Settings window: mounts the settings window wiring, with the companion guard when the query binds a preset
      devtools-main.ts               # Developer Tools window
      message-main.ts                # Message window: the bubble, input, and plate, with the companion guard when the query binds a preset
      unified-main.ts                # Unified chat window: the frameless 340 px column, the speech stream into its box, and the composer that routes a message
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
      secrets.ts                     # The secret provider and the key-name constants
      validators/
        avatar/                      # Validates avatar.json, one file per section
          index.ts                   # Router: the early throws, section calls in order, and the result
          types.ts                   # The avatar.json config types
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
        filler.ts                    # The filler.json phrase-pool and loop-timing types and their validation
        guardrails.ts                # The guardrails.json debounce, rate-limit, and attachment-cap types and their validation
        hotkeys.ts                   # The hotkeys.json summon-accelerator type and its validation
        motions.ts                   # Validates the motion registry
        persona/                     # The card type, the V1/V2/V3 card reader, the V2 export envelope, and the persona.json validation
          serialize-card.ts           # The card as a chara_card_v2 envelope for export
        screen.ts                    # The screen.json type and the validation of its frontmost-transition thresholds
        shared.ts                    # Shared ConfigError plus issue-recording helpers
    renderer/                        # three.js + VRM rendering
      index.ts                       # three.js and VRM output layer: scene, rAF loop, VRM load and hot-swap
      types.ts                       # Renderer options, per-frame tick context, and the Renderer surface
      apply-directive.ts             # Pure routing of a control envelope into the emotion and motion sinks
      frame-gate.ts                  # Pure idle and active frame-throttle decision
      frame-loop.ts                  # The rAF loop with its clock, hidden-document pause, and idle-throttle gate
      pin-controller.ts              # Stateful perch and peek pin apply layer
      vrm-loading.ts                 # VRM optimisation of a loaded glTF and the display-name read
      vrm-participant.ts             # The per-frame lifecycle every VRM-bound sub-controller implements
      camera/                        # Camera framing, zoom, and orbit state
        camera-fit.ts                # Pure fit-to-bounds framing math
        pixel-ratio.ts               # Pure devicePixelRatio clamp
        rig.ts                       # Fit-to-bounds framing, wheel zoom, the eased orbit polar, and the travel view window
        view-window.ts               # Draws the reference-size framing at an offset inside a parked canvas
      geometry/                      # Silhouette hit-testing and read-only model probes
        hit/                         # Alpha-silhouette hit-testing, stage coordinates, and tap regions
          alpha-hit-test.ts          # CPU-side low-res silhouette grab and sampling
          hit-test.ts                # Pure helpers for the alpha silhouette predicate
          stage-coords.ts            # Client CSS px to stage-local coordinate conversion
          tap-region.ts              # Classifies a tap point into a body region
        probe/                       # Read-only model probes, anchor projection, and perch math
          perch-geometry.ts          # Pure math for the window-sit perch
          project-anchor.ts          # Projects the world feet point into canvas pixels
          screen-probes.ts           # Read-only screen probes of the loaded model: feet anchor, width, seat and tap points, hand anchors, pixels per metre
      motion/                        # Clip scheduling, variant swaps, and clip processing
        clip/                        # Clip cache, mirroring, and root-motion processing
          clip-library.ts            # Per-VRM .vrma clip cache: load, mirror, root-lock detrend, dead-clip memo, crossfade clone
          dead-clips.ts              # Warn-once memo of VRMA paths whose load failed for good
          mirror-clip.ts             # Mirrors a clip across the YZ plane
          recenter-root-motion.ts    # Strips baked horizontal drift from VRMA root motion
          self-crossfade.ts          # Clip-cache key composition and playback clip selection
        playback/                    # Motion scheduling, variant swaps, and mixer playback
          baseline-fallback.ts       # Idle-fallback decision for a motion whose clip fails to load
          cycle-dwell.ts             # Single-timer scheduler for a cycle motion's variant swap
          motion-hold.ts             # Rules for a hold that keeps the body on a set of motion ids
          motion-controller.ts       # Pure motion scheduling and variant-resolution state machine
          motion-playback.ts         # Mixer-driven motion playback: controller decisions, action crossfade, finish → next, idle baseline
          motion-start-generation.ts # Tracks which asynchronous motion start owns mixer playback
          perch-hold.ts              # Held-posture suppression and baseline rules
        yaw/                         # Root-yaw easing math and its per-frame apply
          body-yaw.ts                # Pure easing math for the root yaw a stroll turns by
          root-yaw.ts                # Eased root yaw the ambient stroll turns the character by, written onto the model's base rotation each frame
      expression/                    # Emotion, mouth, and gaze apply layers over the face
        ease-emotion.ts              # Eases the expression back to neutral when playback ends
        emotion-crossfade.ts         # Stateful VRM-expression crossfade apply layer
        emotion-resolver.ts          # Pure expression lookup and fallback-chain traversal
        mouth-lipsync.ts             # Amplitude-only mouth state machine and expression describe helper
        gaze/                        # Cursor-gaze math and its three.js apply layer
          bone-pitch.ts              # Sign that turns a downward head pitch into a normalized bone's local rotation.x
          cursor-gaze.ts             # Stateful three.js apply layer for cursor head and eye tracking
          gaze-tracker.ts            # Pure cursor-gaze zone curve and angle damping
      props/                         # Furniture drawn in the character's scene
        props.ts                     # Prop loading, scale, fade, bounds, and the per-frame follow of the character's position
    dispatcher/                      # Event bus + classify, guardrail, route
      dispatcher.ts                  # The router that enforces the firing-is-not-judgment boundary
      core/
        classify.ts                  # Pure tier and target classification of a bus envelope, plus the paced-source table
        event-bus.ts                 # Priority queue collecting every speech-candidate event
        guardrails.ts                # Cooldown, debounce, and rate-limit evaluation
        addressed-chain.ts           # The chain cap: how many addressed turns a window takes in a row without a user turn
        paced-pipeline-busy.ts       # The pipeline-busy predicate composed with the proactive gap
        proactive-pacer.ts           # The quiet gap after a turn that every proactive source shares
        turn-gate.ts                 # The cross-window Web Lock a turn holds from its backend call to the end of its playback
      tier1/
        directive.ts                 # Pure tier-1 control directive for sit, drop, peek and pat events
        render.ts                    # Tier-1 rendering: local directives, posture ledger, pin targets, and the tap-emotion revert
      turn/
        turn.ts                      # Turn identity ledger and the single definition of over
        turn-output.ts               # Speech lifecycle port between the backend caller and the voice pipeline
        push-turn.ts                 # Push-turn ids the user stopped, so their late frames drop whole, and the wait for a sent turn to finish
        quoted-turn.ts               # The admitted turn the bubble quotes: the user's message, or a signal turn's source lines at its first utterance
        signal-lines.ts              # A trigger's signal groups as source lines, urgent first
        render-turn.ts               # Plays a finished backend turn that arrived as a render frame on the push socket
        turn-feed.ts                 # Shared tool-status and reasoning consumer for every transport
      backend/
        backend-caller.ts            # Sends a tier-2 event to backend judgment and streams the reply
        push-call.ts                 # Push transport path of a turn: frame send and the wait for its turn_end
        settle-reply.ts              # Settles a finished reply: directive render, cue routing, speech gate
        stream-attempt.ts            # One stream attempt of a turn: stream events to the speech pipeline and the verdict on how it ended
        turn-recording.ts            # Records a sent turn into the transcript, the context history, and the turn-record log
        request-input.ts             # Pure encoders for a turn's Responses input: post-history and client_context blocks, user item, and the items before it
        turn-outcome.ts              # How a backend call settled
        background-marker.ts         # Placeholder user-content text for a turn with no real user utterance
        idle-watchdog.ts             # Idle-gap watchdog over the backend event stream and its two timeout budgets
        context-builder.ts           # Builds the per-turn client context and image attachments
        client-context-text.ts       # Renders a client context into the plain-line prompt block
        previous-turn.ts             # Persisted record of how the last turn that tried to speak ended
      sources/
        user-input-source.ts         # Normalises typed text and STT results into bus envelopes
        inbox/                       # The inbox-push firing sources
          buffered-inbox-source.ts   # Shared presence-gated core for the inbox-push firing sources
          agent-source.ts            # Agent-lifecycle firing source
          signals-source.ts          # Grouped signals-ingress firing source
        idle-tick/                   # Idle-gap, clock-time, milestone, and screen firing sources
          proactive-source.ts        # Idle-gap proactive firing source
          schedule-source.ts         # Clock-time schedule firing source
          milestone-source.ts        # Once-per-day first-activity milestone firing source
          screen-source.ts           # Frontmost-app transition firing source with a dwell state machine
        gesture/                     # Tap, drag-hold, and window-drop firing sources
          tap-source.ts              # Turns taps on the character into bus envelopes
          drag-hold-source.ts        # Fires one proactive.drag_held candidate per sustained drag
          window-drop/               # Drag-release perch settle, armed-perch poll, and placement
            window-drop-source.ts    # Drag-release settle composing the perch watch and placement
            perch-watch.ts           # Armed perch and peek state with the occlusion-aware detach poll
            placement.ts             # Programmatic placement of the character on a named window
        wake/                        # The bed wake firing source
          wake-source.ts             # Fires the wake candidate as she gets out of bed, carrying the day's first activity while it is owed
        addressed/                   # The character-addressed firing source and the speaking half
          addressed-source.ts        # Turns a character-addressed bridge event for this preset into the addressed.character candidate
          addressed-producer.ts      # Emits the character-addressed event for this window's reply once its turn is over
        routed/                      # The unified chat window's messages arriving as user turns
          routed-user-source.ts      # Submits a user-turn-routed event naming this preset as a user turn with its send id and mention
          user-turn-done.ts          # Reports user-turn-done for a closed or dropped turn's send id
    ambient/                         # Backend-independent local liveliness and movement
      bed-scene/                     # Bed scene
        bed-scene.ts                 # Asleep on a bed at launch or lying down on command, the wake, the bed's fade, and the one exit that releases the hold and the frame; runs again after it ends
      liveliness/                    # Tier 1 idle-life engine and its cue math
        tier1.ts                     # Tier 1 ambient engine: blink, idle sway, breath, look-around
        cues.ts                      # Pure, side-effect-free cue math for Tier 1
      locomotion/                    # Movement loops: stroll, perch, climb, jump, fall, and sit transitions
        walk/                        # Floor stroll
          walker.ts                  # Floor stroll along the monitor's work-area bottom
          wire-walk.ts               # Walker start and teardown, and the reflex-turn stroll cancel
        perch/                       # Window-top perch and jump
          percher.ts                 # Perched dwell, stroll, and sit-back-down on a foreign window top
          jumper.ts                  # Jump across to an adjacent window top
          wire-perch.ts              # Percher and jumper start and teardown
        climb/                       # Window and screen-edge climb
          climber.ts                 # Climb up a window or screen edge, dwell, and climb back down
          climb-geometry.ts          # Pure wall geometry and the climb and descent target picks
          wire-climb.ts              # Climber start, enable latch, and teardown
        fall/                        # Fall to the surface below
          faller.ts                  # Fall to the first surface below a character left in mid-air
          wire-fall.ts               # Faller start, the fall switch, and landing events
        travel/                      # Travel frame shared by the stroll, fall, and climb
          wire-travel-frame.ts       # Real-window travel frame wiring
        sitter.ts                    # Sit-down and stand-up seat transitions
        clip-leg.ts                  # A window leg paced by an in-place clip
    settings/                        # Persisted user settings, one store per setting, grouped by the part of the app they configure
      persisted-store.ts             # Shared bootstrap, notify, reload, and localStorage core for the settings stores
      settings-stores.ts             # Constructs and synchronises the persisted user-setting stores
      backend/                       # What the backend connection uses
        agent-settings.ts            # Reasoning effort, the preset's card (null means the UI language's default), and the send switch
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
      browser/                       # The browser tool's on/off flag
        browser-settings.ts          # Whether the browser tool may run scripts through ego lite, off by default
      avatar/                        # Camera, motion, and lip-sync
        bed-scene-settings.ts        # Launch bed scene on/off and its wake timeout
        camera-settings.ts           # Camera zoom and orbit viewpoint
        camera-gestures.ts           # Maps orbit moves and pinch ratios onto the camera store
        express-motion-settings.ts   # Curates the motion vocabulary the agent may choose from
        idle-motion-settings.ts      # Selects which ambient idle variants may play
        lipsync-settings.ts          # Lip-sync gain
      voice/                         # Filler speech and voice activity detection
        filler-settings.ts           # Filler phrase pools and behaviour flags
        vad-settings.ts              # VAD silence window
      preset/                        # Presets: which keys belong to one, the active one, the registry, and the windows bound to one
        preset-keys.ts               # The per-preset key list and where a key lives under a given preset
        active-preset.ts             # The registry's stored shape and the id a window resolves its keys under: the preset query, else the active preset
        bound-preset.ts              # The page queries that bind a window to one preset (`?preset=`) and name the preset a settings window edits (`?edit=`)
        preset-registry.ts           # Preset list and active preset under yui.presets: create, rename (everyone, here and all are refused), remove, activate, setThumbnail (with crop)
        photo-crop.ts                # A photo's crop area as ratios, its validator, and the default, whole-photo and face framings
        import-card-preset.ts        # Creates a preset from an imported card and rolls it back on any failure
        pet-windows.ts               # The desired open set under yui.windows, the open presets with names, and the live key each window holds under yui.live-window.<label>
      relations/                     # Each preset's relation toward the user and the other presets
        relations-store.ts           # The per-preset store under yui.<id>.relations: bands, the daily cap, the range clamp, the user's own set, and the read of another preset's store
        relations-switch.ts          # The device-wide Relations switch under yui.relations-enabled, on by default
        relation-lines.ts            # The relation entries a turn carries: user first, then the other presets in registry order; none while the switch is off
        relation-targets.ts          # The label a prompt line or the rate_relation enum shows for a preset: one named `user` is disambiguated
      unified/                       # The unified chat window's switch and position
        unified-chat-switch.ts       # The device-wide Unified chat switch under yui.unified-chat, off by default
        unified-shown.ts             # Whether the unified window shows: the switch on, two or more open presets, a window can exist; every pet and settings window reads it
        unified-window-settings.ts   # The unified window's last position under yui.unified-window, device-wide
      identity/                      # Who the user is to the character
        user-name-settings.ts        # Device-wide "Your name", what {{user}} resolves to
      panels/                        # Panel and window state
        delegation-chip-settings.ts  # Per-device fold state of the delegation chip
        message-window-settings.ts   # Message-window mode and last outer position under the window's preset key
        window-geometry-settings.ts  # Per-window-label size and position the user's drags and resizes leave
    io/                              # I/O layer: chat, voice, window and OS seams
      chat/
        secret-provider.ts             # Resolves each secret from its runtime store, then the build-time fallback
        stream/                        # Streaming model calls and the silence filter
          chat-client.ts               # Builds the openai SDK client and routes to the selected transport's stream
          responses-stream.ts          # Responses streaming loop
          chat-completions.ts          # Pure Chat Completions request builders and stream-chunk reducer
          chat-completions-stream.ts   # Chat Completions streaming loop with its tool round trips
          stream-helpers.ts            # Express-tool and error helpers both streaming loops use
          client-tool-run.ts           # Runs a model's tool call on the client and decides when results go back
          silence-token.ts             # Stateful [SILENT] token filter for spoken output_text deltas
        push/                          # The push transport's turn and reply WebSocket
          push-frames.ts               # Push frame wire types and the unreadable-frame checks
          push-socket.ts               # Single WebSocket the push transport runs turns and replies on
          tool-calls.ts                # Validates, queues and answers the backend's tool_call frames
        tools/                         # The tools YUI declares to the backend and runs itself
          client-tools.ts              # Registry of the declared tools and the ClientTool type
          execute.ts                   # The bounded execute both the request transports and the push consumer call
          express.ts                   # The generate_express tool
          avatar.ts                    # The body_action and look tools over the avatar executor
          relation.ts                  # The rate_relation tool: one accepted call per target per turn
          address-character.ts         # The address_character tool: names the character a reply is for, once per reply
          pet-window-tools.ts          # Builds the tool list a pet window declares: rate_relation and address_character everywhere, browser under Tauri, body_action and look in main
        vocabulary/                    # The emotion, motion, and voice-tone ids the agent may cue with
          express-vocabulary.ts        # Derives the express vocabulary from the loaded config and the motion selection
        broker/                        # The Expression Broker client and its URL override reconciler
          broker-client.ts             # Write-only Expression Broker MCP client that publishes the renderable vocabulary
          broker-override-reconciler.ts # Applies a broker-URL override to the live broker client
        card/                          # The card a preset sends: resolution, assembly with macros, and the greeting pick
          resolve-card.ts              # The preset's card and its effective name; null on push or with the switch off
          assemble-card.ts             # The first system message and the post-history text, with {{char}}, {{user}}, {{original}}
          pick-greeting.ts             # One of the card's greetings at random
        conversation/                  # Transcript, context, and session state for conversation continuation
          chat-history-store.ts        # Unified conversation transcript with session boundaries
          signal-history-store.ts      # Per-turn signal records, one per group, spoken or silent
          context-history.ts           # Capped ring of recent client-context entries
          overheard/                   # What this window has heard of the other open presets
            overheard-reader.ts        # Reads the lines other open presets exchanged since this window last heard them
            overheard-store.ts         # Per other preset, the cursor up to which this window has heard its transcript
          session-store.ts             # Holds the last Responses response.id for conversation continuation
          session-diagnostics.ts       # Used tokens and context window for the settings window
        record/                        # The turn-record JSONL log
          turn-record-log.ts           # Appends one JSONL record per completed turn or skipped fire
      browser/                         # The browser tool's adapter to the Rust relay
        browser-relay.ts               # browser_run and browser_guide invocations, and the outcome and guide shapes they answer
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
          fish-voices.ts               # Fish Audio's /model API: the account's voice models, import from a clip, and delete
          voice-import.ts              # Voice import: OS picker, native copy, speaker registration
          voice-import-flow.ts         # Two-step voice import so a naming row sits between pick and copy
          voice-id-migration.ts        # Moves imported voices whose stored ids the TTS server would reject onto the ids an import of the same label produces
          voice-list-refresh.ts        # Refetches the TTS server's voice list into a speaker manifest
          reference-clip.ts            # Reference-clip URL resolution and transport selection
          speaker-selection.ts         # Owns the active TTS speaker selection
      stage/                           # What every stage surface shares for pointer gestures
        press-travel.ts                # Pointer travel past which a press is a drag
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
          companion-position.ts        # Where a companion window (message, unified) opens: its stored position, else beside the pet window, kept on screen; the column's width and handle height
          companion-column.ts          # A companion column window's focus, OS drag, content-height resize and moved-position report
          keep-on-screen.ts            # Pushes a window back until its centre lands on a monitor
          travel-frame.ts              # Parks the real window once for a scale-seam crossing
          stationary-frame.ts          # Widens the real window around a character that stays where she is
          tauri-frame-window.ts        # The real pet window as one FrameWindow seam, built once for the movers
          perch.ts                     # Perch values, perch-target and placement types, and the host-edge span shared by the drop source, avatar RPC and locomotion
          visible-viewport.ts          # Cached height of the pet window part above the work-area bottom
        openers/                       # Openers and placement of the message, settings, devtools, and pet windows, the first two bound to a pet window's preset
          settings-window.ts           # Settings window opener, settings-<id> for a bound id, and cross-window settings sync
          devtools-window.ts           # Developer Tools window opener
          message-window.ts            # Message-window opener, message-<id> for a bound id
          message-window-mode.ts       # Keeps the message window in step with the stored mode, the unified chat window and the dock request
          unified-window.ts            # Unified chat window opener: shows the one frameless window labelled unified, or creates it at its stored position, and destroys it; its permissions are src-tauri/capabilities/unified.json
          pet-window.ts                # Bound pet window opener: creates pet-<id> and lists the windows that exist
          companion-windows.ts         # Closes a bound pet window's settings-<id> and message-<id>, and watches a companion's owner window
          current-window.ts            # Closes the current window and listens for its close request
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
        message/                       # The pet ↔ message window bus and its remote half
          message-bridge.ts            # Cross-window bus linking the pet window and the message window
          message-remote.ts            # The message window's bubble and input as a remote Surfaces half
          stream-bridge.ts             # The speech stream as a message bridge: the pet's ops stamped with its preset, the unified window's ask as `ready`, and a click on an error's fix that names this preset
        delegations/                   # The backend's background-work list, live and persisted
          delegations-store.ts         # Background work the backend reports on the push socket
          delegations-bridge.ts        # Delegations list as seen from a window that does not own the push socket
          delegation-history.ts        # Every delegation the client has seen, persisted for the settings window's Session section
        reasoning/                     # The backend's reasoning text as written and as mirrored
          reasoning-store.ts           # Backend reasoning text as the current turn writes it
          reasoning-bridge.ts          # Reasoning text as seen from a window that does not own the push socket
        push/                          # Push socket state mirrored to windows that do not own it
          push-socket-bridge.ts        # Push socket state as seen from a window that does not own it
        inbox/                         # The Tauri inbox seam, the channels read through it, and the preset ids the shell routes by
          avatar-rpc.ts                # Webview end of the loopback avatar RPC surface
          avatar-executor.ts           # Answers the avatar RPCs addressed to its own window from live client state
          relations-rpc.ts             # Answers the relations RPCs from its own window's relation store
          agent-inbox.ts               # Subscribes to the Rust agent-inbox event channel
          signals-inbox.ts             # Subscribes to the Rust signals-inbox event channel
          preset-ids.ts                # sync_preset_ids: the registry's preset ids published to the shell for ingress routing
          create-inbox.ts              # Generic Tauri event-channel subscription seam
      assets/
        vrm-import.ts                  # VRM import: OS picker, native copy, avatar-option registration
        card/                          # The card's file steps: import, export, and the thumbnail URL
          card-import.ts               # Card import: OS picker, native read/parse, rollback of the temp thumbnail
          card-thumbnail.ts            # Thumbnail retain (temp id → preset id), remove, and the photo pick that stores a preset's thumbnail, through the shell
          photo-size.ts                # The natural size of a photo, read by decoding it
          card-export.ts               # Card export: OS save dialog, native write, and the export file-name sanitizer
        user-asset-import.ts           # Lazy invoke loader and orphan cleanup shared by the voice and VRM imports
        vrm-selection.ts               # Owns the active VRM selection
        selection-store.ts             # Generic selection store behind VRM and speaker selection
        safe-id.ts                     # TS mirror of the native stem sanitizer for persisted option ids
      guide/                           # The bundled guide docs handed to the backend on an Ask press
        guide-docs.ts                  # The guide docs bundled with the app and the guide: block of the client context
      image/                           # The bitmap → JPEG data URL encode the image paths share
        jpeg-encode.ts                 # Draws a bitmap onto a canvas and returns its JPEG data URL
      locks/                           # The exclusive Web Lock a window holds across windows
        exclusive-hold.ts              # Takes a named Web Lock, holds it until release, and frees it when the window dies
        fake-lock-manager.ts           # The in-memory exclusive lock the gate tests share
    ui/                              # Floating surfaces, panels, and indicators
      i18n.ts                        # Locale type, persisted locale, lookup, and subscriber notification
      tokens.css                     # Design tokens: colour, radius, shadow, duration
      surfaces/                      # Speech-bubble and text-input host surface
        surfaces.ts                  # Mounts the speech bubble and text input as one system, with the name plate and backlog when asked, forwarding tool status
        surfaces-router.ts           # One Surfaces handle over the pet window, the message window and the speech stream, which takes the chat while the unified window shows
        wire.ts                      # Local surfaces plus the message-window bridge and the speech stream, routed by the stored window mode and the unified window, scoped to the window's preset
        apply-speech-op.ts           # Draws one bubble op on a Surfaces, for the message window and the unified box
        summon-key.ts                # Binds the focused window's "/" key to open the text input
        anchor.ts                    # Pure mapping from the on-screen feet to the input's bottom offset
        reflect-unless-editing.ts    # Writes a store value onto an input unless the user is editing it
        interactive-overlay.ts       # Selectors of overlay elements that take OS pointer events while shown
        mock.ts                      # Mock driver that replays every surface state from seed data
        surfaces.css                 # Speech bubble and text input styles
      input/                         # Text entry and its supporting transforms
        text-input.ts                # Text input: submit, busy, error, and feet anchoring
        action-button.ts             # The composer's stop and send button
        image-resize.ts              # Downscales and re-encodes user-attached images
        format-accel.ts              # Renders an accelerator string for display
      message/                       # The bubble, the name plate riding its box in both modes, and cue-list rendering
        speech-bubble.ts             # Speech bubble: dwell, scroll, markdown, and aria for streamed speech
        typewriter.ts                # Pure reveal cursor: types a line at 40 ms per character or paced by each sentence's audio, from elapsed time
        stable-markdown.ts           # The prefix of a streaming line whose rendering later text cannot change
        text-prefix.ts               # A rendered line's text as the typewriter counts it, and cutting a rendering to its first characters
        backlog.ts                   # The current session's earlier lines, opened above the box by a toggle on its bottom edge
        user-quote.ts                # The user's message quoted on the bubble's first line
        signal-source-lines.ts       # A signal turn's source lines in the bubble's quote slot
        reasoning-disclosure.ts      # Backend reasoning folded under the quoted line at the top of the bubble in the message window
        message-plate.ts             # Name plate on the box's top-left edge in both modes: face, name, state; the message window's OS drag handle
        plate-state.ts               # The plate's turn state in both modes: responding from a line's begin to its end or hide, thinking while busy
        markdown.ts                  # Speech markdown rendering through marked and DOMPurify
        cue-list.ts                  # Reusable cue-list section for schedule and proactive cues
        message-plate.css            # Name-plate chip styles: face, name, state dot, state label, and dock button
        message-window.css           # Message-window layout and name-plate styles
        cue-list.css                 # Cue-list section styles
      unified/                       # The unified chat window
        unified-view.ts              # Wires the modules; keeps the pending sends
        lane-queue.ts                # One lane per preset: one line holds the box until done, the next lane replays what it buffered
        cast-state.ts                # Each preset's turn state and sent name, and the talk/think/idle rule for its chip
        cast-chips.ts                # The head row: a chip per open preset with its line state, the × and the drag handle
        backlog-lines.ts             # The backlog's lines: the user's under "You → <recipient>", a character's under its name
        merge.ts                     # Pure: the open presets' transcripts and the pending sends as one time-ordered list, each user row with its recipient
        targets.ts                   # Pure: the fallback target, the targets of a message, and the send built from what the user typed
        sequence.ts                  # One-at-a-time delivery of a send, target by target, with its queue, 60 s timeout, cancel and log line
        composer.ts                  # The message window's field under the text input, with the recipient chips, send and stop, and the inline error
        mention-picker.ts            # The @ list over the field: a combobox of the open presets and @everyone
        avatar.ts                    # A preset's face, drawn by every window: its photo framed on the stored crop in a circle over the preset's hue, else a dot; the plate and the unified window reuse it
        avatar.css                   # The face's size and shape, for every window that draws one
        unified-window.css           # The 340 px column: cast row, box, recipient chips, composer and @ list
      signals/                       # The source line of a signal group, shared by the bubble and History
        source-line.ts               # Renders one source line: delivery-class dot, source, label
        source-line.css              # Source-line styles: filled urgent dot, ring batched dot
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
      quick-controls/                # Quick-controls shell parts and sections
        quick-controls.ts            # Quick-controls panel: header, the rail of the character's pages then every character's pages, and the page body
        quick-controls.css           # Quick-controls shell, tab rail, sections, groups, and rows
        controls.css                 # Switch, segment, field, text-button, disclosure, slider, and confirm styles
        template.ts                  # Panel markup as pure string construction
        markup.ts                    # Panel markup primitives the template and the tab modules share
        popover.ts                   # Popover shell: positioning, dragging, open and close lifecycle
        constants.ts                 # Display constants shared by the panel, its sections, and the chips that reuse its glyphs
        switch-row.ts                # Switch-row element contract, the row table filling it, and each row's store follower
        seg-keyboard.ts              # Arrow, Home, End and commit keyboard handling shared by the segmented controls
        slider-binding.ts            # Input and release wiring shared by the range sliders
        hint-tooltip.ts              # Shared hover, focus, and click tooltip for data-tip elements
        hint-tooltip.css             # Hint tooltip styles
        character/                   # The Body page and the Motion and desktop page's character rows
          character-tab.ts           # Builds both stacks: VRM list, relations rows and view reset; mouth gain, motions and bed scene
          character-html.ts          # Markup of the two stacks
          vrm/                       # VRM list
            vrm-list.ts              # VRM asset list
            vrm-list.css             # VRM list styles
          idle-motion/               # Ambient idle pool
            idle-motion-section.ts   # Idle variant switches
          express-motion/            # Express motion vocabulary
            express-motion-section.ts  # Express motion categories
            express-motion-section.css # Express motion styles
          bed-scene/                 # Launch bed scene
            bed-scene-section.ts     # Bed scene switch and wake timeout
          relations/                 # Relations section
            relations-edit-section.ts  # One slider row per target that sets the relation by hand, shown while the Relations switch is on
            relations-edit.css       # Relations rows, the centre-out slider fill, and the number
          gain/                      # Mouth gain
            gain-row.ts              # Mouth gain preview
          viewpoint/                 # Camera view reset
            viewpoint-row.ts         # Camera view reset button
        connection/                  # Connection page and its endpoint/API-key section
          connection-tab.ts          # The Connection page, with the reasoning-effort row after the chat section
          chat-type.ts               # The chat type row: long names in the open list, short name over the closed select, description line
          chat-type.css              # The overlay, option colours and description line of that row
          endpoints-section.ts       # Endpoint URL fields, the chat and TTS key rows, chat-API picker, and resets
          endpoints-section.css      # Endpoints section and yui-select dropdown styles
        cue-lists/                   # Schedule and proactive cue lists of the Proactive page
          cue-lists.ts               # Mounts and tears down the two cue lists
        delegations/                 # Delegated-work refresh for the session section
          delegation-sync.ts         # Minute refresh timer that follows the running delegated items
        header/                      # Popover header bar buttons
          header-buttons.ts          # Pop-out, message, devtools and close buttons with their listeners
        preset/                      # Preset strip above the rail
          preset-strip.ts            # Active-preset picker, the switching state, the page scope lines and the rail's character heading it fills; in the settings window the character header picks the preset to edit (`?edit=`)
          character-header.ts        # The settings window's header: every preset with its face, transport and window state; a click edits it
          preset-manage.ts           # Manage popover: rows with inline rename, delete confirm, "Use in main" in the settings window (it switches main's preset), and the new-preset field
          preset-scope.ts            # Scope line text: only the edited character, or every character
          preset.css                 # Strip, manage popover, scope line, relation line, and reasons card styles
          photo-dialog/              # The profile-photo dialog
            photo-dialog.ts          # The modal dialog: the photo under a circular mask, zoom, the fixed framings, Choose another, and the previews at the sizes a face is drawn
            crop-stage.ts            # The stage geometry: a photo's position and zoom under the mask, and its conversion to and from a crop
            photo-dialog.css         # The dialog's layout
          relations/                 # The relation line under the preset row, and the reasons card
            relations-section.ts     # Composes the two, re-renders on the store's notifications, and moves the changed relations
            relation-glyph.ts        # The five-step glyph and its band motion, the relation chip, the direction mark, and the age text
            relation-line.ts         # This preset's relation toward each rated target, sorted by strength, on one row: the closed presets and the chips past its width folded into a +N chip, refolded on a width change
            reasons-card.ts          # The band, the engine's note, and the last three reasons of a hovered or focused relation
            view.ts                  # What the two read: this preset's relations as stored now, a target's name, and the rated targets' order
        history/                     # History page and its session accordion section
          history-tab.ts             # The History page's session list, with its start-fresh row
          history-section.ts         # History page session accordion over the persisted transcript and the signal records
          history-rows.ts            # Merges a session's chat entries with the signal records of the turns that ran in it
          history-section.css        # Session history accordion styles
        search/                      # Settings search
          settings-search.ts         # The field over the rail: per-page match counts, dimmed pages and matched rows
          settings-search.css        # Field, count badge and matched-row styles
        together/                    # The Together page's character list
          characters-section.ts      # One row per preset with an "On the desktop" switch, main locked on, the open-preset cap
          characters-section.css     # Character row styles
          together-rows.ts           # The page's switch rows and the chain cap
        sections/                    # The page sections the shell mounts, the rows and lines the Connection page and other sections share, and the list helpers
          agent/                     # Locale, reasoning-effort, and instructions controls
            agent-section.ts         # Locale segment, reasoning-effort segment, the card's system-prompt textarea, and their redraw
          help/                      # Help section of the General page
          key-row/                   # One secret API key row
            key-row.ts               # Masked input, reveal and clear, sub line, commit on blur; the chat and TTS rows and the Listening page's STT row
          push-reason/               # Controls the push transport cannot use
            push-reason.ts           # The reason line under such a control and its link to the chat protocol select
            push-reason.css          # Reason line styles
          user-name/                 # "Your name" on the General page
            user-name-section.ts     # The device-wide user name row, its fallback placeholder and redraw
            help-section.ts          # One Ask button per bundled guide
          monitors/                  # Screen-source radiogroup of the screenshot section
            monitors-section.ts      # Screen-source list and its load state
            monitors-section.css     # Monitors section styles
          session/                   # Settings-window context readout and delegated-work list
            session-section.ts       # Readout, delegated list, their subscriptions, redraws and minute refresh
            session-section.css      # Session context-occupancy readout and meter styles
          screenshot/                # Screenshot-attach switch and when the monitor list loads
            screenshot-section.ts    # Attach switch, its subscription and redraw, and the monitor-list load
          screen/                    # Screen-watch thresholds and the min-gap the screen source fires on
            screen-section.ts        # Screen-watch threshold knobs, the min-gap slider, and their redraw
          reactions/                 # Agent notification, presence, pacer gap, and rate-limit cap rows
            reactions-section.ts     # Agent-port, presence, pacer-gap, and rate-limit cap inputs and their redraw
          workflows/                 # Saved webhook workflows of the Proactive page
            workflows-section.ts     # Workflow entry list editing
            workflows-section.css    # Workflows section styles
          voice-input/               # Voice input switch and silence slider
            voice-input-section.ts   # Voice switch, VAD slider binding, their subscriptions and redraw; the switch row is absent when the panel hides it
          filler/                    # Thinking-filler section
            filler-section.ts        # Language segment and phrase-pool textareas, with their store subscription and reflect
            filler-tool-lines.ts     # Textarea round-trip for the filler pool's tool tier
          speaker/                   # TTS speaker picker of the Voice page
            speaker-list.ts          # Speaker radiogroup with reference-voice refresh and audition
            speaker-list.css         # Speaker list styles
          user-asset-list.ts         # Shared scaffolding for the VRM and speaker asset radiogroups
          user-asset-list.css        # Radio row, tick, and state styles shared by the monitor, VRM, and speaker lists
        switches/                    # Switch rows
          switch-rows.ts             # Row markup, click binding, repaint, and the store following while open
        tabs/                        # The tablist
          tab-rail.ts                # Rail: selection, roving tabindex, arrow keyboard, and the button/panel markup pairs
      i18n/                          # Locale catalogs
        en.ts                        # English strings, the source of truth for the key set
        ja.ts                        # Japanese strings
        ko.ts                        # Korean strings
      devtools/                      # Developer Tools window views
        shell.ts                     # Developer Tools window shell and section navigation
        shell-rebuild.ts             # Locale-driven shell rebuild that keeps focus
        context-inspector.ts         # Client-context inspector view
        advanced-settings.ts         # Advanced settings view
        motion-preview/              # Motion and emotion preview, lazy-loaded
          motion-preview.ts          # Mounts the preview and routes its parts
          view.ts                    # Preview markup, element references, and slider readouts
          variants.ts                # Pooled-variant expansion into playable entries
          registry-list.ts           # Motion registry list and crossfade options
          motion-controls.ts         # Playback overrides and the play, stop, and idle buttons
          emotion-panel.ts           # Emotion rows, sliders, and the neutral and hold buttons
          live-status.ts             # Per-frame current-motion sync, fps, and elapsed time
          perch-hook.ts              # Dev-only perch globals for the console
          motion-preview.css         # Motion-preview styles
        devtools.css                 # Developer Tools shell styles
  src-tauri/
    tauri.conf.json                  # Transparent always-on-top pet window
    capabilities/                    # Per-window permissions; desktop.json holds the desktop-only plugin permissions
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
      image_encode.rs                # Long-edge resize and JPEG data-URL encode shared by capture and the browser relay
      browser/                       # The browser tool's half in the shell: scripts and the guide through ego lite
        mod.rs                       # browser_run and browser_guide commands
        locate.rs                    # Finds the ego-browser binary under the home directory, then on PATH
        relay.rs                     # One script run per task space under the space lock, the backstop kill, and the guide run
        script.rs                    # The prelude wrapped around the caller's code
        shots.rs                     # The per-call screenshot folder, its collection and encode, and the stale sweep
      agent_ingress/
        mod.rs                       # Loopback HTTP listener for agent hooks, signals, and the avatar RPC surface, routed to main or the pet window a /presets/<id>/ path names
        payload.rs                   # Request parsing, size caps, and event payload types
        route.rs                     # Path parsing into a route family and a target window: bare paths to main, /presets/<id>/ to pet-<id>
        avatar_rpc.rs                # Avatar RPC bridge between HTTP requests and the webview
      turn_log.rs                    # Appends one opaque JSON line per turn record
      log_rotation.rs                # Calendar-date log rotation with a retention window
      import_fs.rs                   # Shared import filesystem helpers: sanitize, hash, dest stem candidates, bounded streamed copy, signature sniff
      vrm_import.rs                  # Native copy of a user-picked .vrm into app data
      voice_import.rs                # Native copy of a user-picked reference clip into app data
      card_import.rs                 # Card file import (JSON or a PNG's tEXt card JSON), the thumbnail copy, the preset photo pick (a PNG or a JPEG fitted and re-encoded), and the exported card write
      tray.rs                        # System tray menu and its show and hide actions
      os_event_watcher/
        mod.rs                       # OS polling loop that emits os_event to the webview
        witness.rs                   # Transition-only log of frontmost app and idle state
        drop_release.rs              # Drop-release probe that emits window_drop_release
        pure_helpers.rs              # Idle conversion and frontmost-window pick
        macos.rs                     # macOS idle, window enumeration, and camera polling
        windows.rs                   # Windows idle, foreground window, and window enumeration polling
  fixtures/                          # JSON case tables the TS and Rust sanitizer tests both read
  Mods/                              # Standalone MCP servers, independent of the app runtime (Python/uv, own `mods` and `mods-lint` CI jobs)
    avatar/                          # Avatar body-state and movement Mod
    browser-cdp/                     # Browser CDP Mod
    desktop-control/                 # macOS screen and app-control Mod
    factorio/                        # Factorio RCON poll, event cache, and urgent signals Mod
      game-mod/                      # The coop-agent Lua game mod; its tests/ uv project runs in the mods CI job
    shell-sandbox/                   # Sandboxed shell Mod
    router/                          # Shared Mod router
    docker-compose.yml               # Container orchestration for Mods
    README.md                        # Mod setup and operation
  integrations/                      # Backend-side integrations, independent of the YUI app runtime
    hermes/
      README.md                      # Hermes Agent adapter setup (Responses mode, dev proxy, auth)
      desire/                        # Agent desire middleware, state helpers, monitor, and prompts (Python/uv)
      platform/                      # Hermes gateway push-transport plugin: one WebSocket carrying turns in and finished replies out (Python/uv)
        yui/src/tools/               # The client-declared tools: registration from hello.tools, the blocking handler, and the per-chat pending calls
    skills/
      yui-daily-briefing/            # Backend-agnostic skill: scheduled producers write dated markdown briefings (scripts/briefing.py) that the backend agent speaks on first activity
      yui-wake-character/            # Backend-agnostic skill: wake one character through its preset ingress URL and act on 200, 404, and 503
  docs/                              # Design source of truth
    agent-guide/architecture/        # Architecture map of the client
      map.js                         # Modules, their parts, exchanges, and flows of src/ and src-tauri/src
      index.html                     # Viewer that draws a map data file when opened from disk
```
