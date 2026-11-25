# YUI — Project Structure & Stack

## Stack

| Layer | Technology | Version |
|---|---|---|
| Shell / OS | Tauri v2 (Rust) | tauri 2.11.x |
| Build / dev server | Vite | 8.x (dev port `YUI_DEV_PORT`, default **1420**; auto-port launchers pick a free port per worktree) |
| Language | TypeScript | 6.x (bundler mode, `noEmit`) |
| Render | three.js | 0.180.x |
| Window UI | React 19 with `@vitejs/plugin-react` (Fast Refresh); the settings pages ported so far, other surfaces are imperative DOM | 19.3.x |
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
  threads.html                       # Threads-window Vite entry
  vite.config.ts                     # Dev port YUI_DEV_PORT|1420, strictPort, host 127.0.0.1, backend proxy plugin
  biome.json                         # Format and lint config (curated rule set)
  scripts/                           # Summarised: dev launchers (dev-port.mjs, tauri-dev.mjs for tauri:dev, dev-auto.mjs) and their shared package-manager.mjs helper, dev-backend-proxy.mjs, release.sh, worktree-setup.sh, rust-lines.sh (code and test line counts of a Rust file), architecture-map-base.mjs (writes the map of origin/main beside the data file for the viewer's Compare view), and ci/ (test-guard.sh, gates.sh, architecture-map.mjs, command-paths.mjs, css-selectors.mjs, logger-namespace.mjs)
  configs/                           # Runtime-loaded config (no hardcoding)
    endpoints.json                   # chat/stt/tts base urls + chat_instructions, chat_api, chat_model_context_window + stt_model/stt_language/tts_provider/tts_model/tts_speaker/tts_max_inflight; the shipped configs/endpoints.json omits the url and speaker keys, and the settings panel overrides per device
    emotion_registry.json            # emotion id -> vrm_expression + fallback
    motions.json                     # Motion registry
    avatar.json                      # VRM avatar config
    filler.json                      # Backed-off filler schedule + first/repeat/long_wait/tool/timeout/unreachable/threads_open/threads_raise phrase pools
    guardrails.json                  # Dispatcher debounce and hourly caps + attachment caps (max_count, max_image_bytes)
    hotkeys.json                     # Global summon accelerator (empty = disabled)
    screen.json                      # Frontmost-transition detector thresholds (dwell/settle/session/gap/quiet)
    persona.json                     # Default card per UI language (en/ja/ko), the framing sentence, and the {{user}} fallback word
    emotion_text/                    # Emoji voice-tag vocabulary, loaded only when tts_provider is irodori (emotion_text/irodori.json)
  public/motions/                    # VRMA motion assets
  src/
    app/                             # Composes the pet window from the layers below
      bootstrap-configured.ts        # Pet window's config-derived bootstrap: runs the turn core and the pet-only wirings in order and drains their teardowns
      csp-violation.ts               # Logs every Content-Security-Policy violation the window reports
      disposers.ts                   # Shared teardown bag: registers teardowns at creation sites and drains them LIFO
      active-hours/                  # One pet window's active hours: the proactive gap and idle cue scale, and the window's do-not-disturb
        window-active-hours.ts       # Scales the gap and idle cue minutes by the base pace times the current span's pace; holds do-not-disturb during an off span
      card-io/                       # The card's file steps bound to a preset registry
        import-preset.ts             # The import a card section runs: native file step, copied voice registration, VRM list entry, preset creation, and rollback
        wire-card-io.ts              # The card's import, export, thumbnail, photo pick, and preset creation ports
      relations/                     # This window's relations wiring
        wire-relations.ts            # rate_relation's open-preset targets and the ingress relations RPC, over the window's store
      turn/                          # The path of a turn: sources, voice, and push
        turn-core.ts                 # The chat turn every backend-facing window runs: voice, dispatcher, STT, VRM load, vocabulary, push transport, stop, and submit
        wire-dispatcher.ts           # Turn feed, backend caller, guardrails, pacer, and the dispatcher
        report-turn-failure.ts       # Where a failed user turn shows: the open input, or a notice on the status pill
        wire-sources.ts              # The dispatcher's utterance sources, built and started
        wire-card.ts                 # The card module bound to the window's stores, preset, UI language, and config
        wire-greeting.ts             # The greeting after a session reset, and the reset announcement each window's Start fresh makes
        wire-first-conversation.ts   # After Quick start connects, and on its Replay: the greeting on an empty session, then the input and the controls hint with the two guides
        ask-queue.ts                 # The window's Ask queue: the push socket's Asks and the Settings requests, shown oldest first, the user's pick sent to the owner of the one shown
        settings-request.ts          # A yui_run write's allow paths as one Settings request in the Ask queue, answered Allow or Deny
        wire-yui-run.ts              # Builds the ports a yui_run script reaches from this window's stores, Ask queue, selections and Tauri commands
        session-reset-announcer.ts   # What a window's Start fresh announces: the bridge event, then this pet window's own greeting
        vocabulary/                  # The express vocabulary every consumer declares
          wire-vocabulary.ts         # The emotion_text table load, the derived vocabulary, and its change announcements
        push/                        # Push socket wiring and its stores
          delegation-chip-mount.ts   # The delegation chip's lazy mount and its suppression port
          playback.ts                # Reports a failed turn's end to the push socket as a playback frame
          wire-push.ts               # Push socket frames into turns, the stop button, and the push mode chip
          push-stores.ts             # The push socket, its chat id, and the delegations and reasoning stores its frames feed
        voice/                       # Voice input and speech playback wiring
          wire-voice.ts              # The voice-input and turn-voice wiring; a bound window builds no capture
          wire-voice-pipeline.ts     # Wires filler, TTS, and speech playback to the turn lifecycle
          speak-turn.ts              # The speech turn behind TurnOutput: thinking guard and motion hold, filler availability, failure asides, barge-in
          unified-voice.ts           # Main's speech while the unified chat window shows, and the user speaking answered like a stop
          wire-synth-failure-notice.ts # The first synth failure per pet window run: the bubble's Choose another action, opening the Voice page
      stage/                         # What is bound to the pet window's stage and overlay
        stage-renderer.ts            # The renderer on the stage with its persisted camera and idle throttle, plus Tier 1 liveliness, for the pet window
        wire-gestures.ts             # Pointer gestures on the stage: taps, pats, the window drag, and the camera orbit
        wire-window-sources.ts       # The Tauri window drop and resize sources, the avatar RPC executor, and keep-on-screen
        wire-window-geometry.ts      # The per-window saved size and position: written after the OS drag ends and a Ctrl+wheel resize, applied once at boot
        wire-locomotion.ts           # Travel frame, the five locomotion loops, and the window sources composed into one handle, held still per holder
        wire-come-along.ts           # Her own settings window's stage slots and close into the come-along, and the stage ask at boot
        wire-pet-stage.ts            # Stage wheel zoom, the persisted camera and throttle flow, and the feet-follow input anchor
        wire-summon.ts               # Peek state and exit triggers, tray summon, and the global summon hotkey
        wire-stage.ts                # Click-through hit-test and cursor-gaze wiring over the stage
      dev/                           # DEV-only console handles
        wire-dev-globals.ts          # The DEV console and global handles for inspection and firing dispatcher events
      cross-window/                  # State the windows share
        wire-cross-window.ts         # Per-window sync for the pet, settings, and devtools windows
        wire-window-sync.ts          # Settings broadcast, guardrail overrides, and the shared cross-window sync core
      controls/                      # The pet window's summonable control surface
        wire-pet-controls.ts         # The popped-out surfaces' settings asks and the cue locale sync
        wire-devtools-request.ts     # Main's pet window opens Developer Tools when the settings window asks
        wire-help-guide.ts           # Guide requests the settings window sends over the bridge, submitted as user turns
      settings/                      # Selections and conversation state applied to the running app
        config-defaults.ts           # The quick-controls getters over the bundled config, shared by the pet and settings windows
        conversation-stores.ts       # Constructs the shared io/chat conversation stores each window owns and disposes
        dev-key-fallback.ts          # The VITE_YUI_*_KEY build-time key values, read in dev builds only
        window-stores.ts             # Creates the settings and conversation store bags and the preset registry of the pet and settings windows and registers each store's teardown
        window-vrm-selection.ts      # The store-only VRM selection of a window without a renderer
        wire-window-settings.ts      # The settings side the settings window uses: stores, theme, config, voices, settings-window sync, the mirrored push socket and the reset announcer
        wire-avatar.ts               # VRM and speaker selection stores, their swap and import flows, the voice-list refresh on override commits, and the avatar config applied at boot
        wire-config.ts               # The config store over the bundled configs, the runtime key stores, the live endpoint/guardrail merges, and the reload/watch wiring
        wire-cue-locale-sync.ts      # Reseeds untouched built-in cues when the display language changes
        wire-preset.ts               # Sends a preset switch over the settings bridge and reloads each unbound window into it, after the pet window stops its turn; a bound window only rereads the list
      signal-chips/                  # The signal chips beside the avatar
        wire-signal-chips.ts         # The signal chips on every transport, sharing the delegation chip's fold store
      threads-reaction/              # Main's Thread reactions: the Threads client, the Threads window, the chip's taps, presence, speech, the turn pipeline, the stage and the renderer
        wire-thread-reactions.ts     # Wires the thread reaction in main; a window without a Threads client wires nothing
      threads-attach/                # Main's attached Threads, wired by the chat turn in main's window only
        attached-threads.ts          # The list: each Thread once, toggled, dropped by the Threads a send carried, and a failed send's put back
        wire-threads-attach.ts       # The Threads window's toggles and the chips' × into the list, the list into every composer and out to the Threads window, a send's drop
      threads-chip/                  # Main's ways into the Threads window: the chip, the tray's Terminal item and a bound Character menu's requests
        wire-threads-chip.ts         # The chip from the store's snapshots, on the shared fold store, opening the Threads window and reporting its taps
        wire-threads-open-requests.ts # The tray's Terminal item and a bound Character menu's request, opening the Threads window on their tab
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
        wire-plate-name.ts           # The plate's character name and the bound preset's face, or the active preset's when unbound
      unified/                       # The unified chat window's wiring
        wire-unified-window.ts       # Main opens the window while it shows and destroys it otherwise
        wire-unified-close.ts        # The window closing itself turns the Unified chat switch off
      character-menu/               # The Character menu in the pet window
        wire-character-menu.ts       # Opens the menu on her right-click, focuses the window, and closes it when focus leaves or her travel aborts
        character-menu-frame.ts      # Widens the pet window to the menu's reach and restores it, holding her still meanwhile
        character-menu-ports.ts      # The menu's actions over the stores and openers the pet window has: Rest, Listen, Body, Voice, Pace, Keep bubble, Unified chat, Reset chat, Threads, Turn off
      threads-window/                # The Threads window's wiring
        wire-threads-window.ts       # Snapshots into the view, read marks to the store, main's attached Threads into the pane and its Attach to chat back, the frame store into placement and resize, the list choice, the open request, theme and language
        threads-placement.ts         # The window's frame: beside main's pet window the first time, its stored frame after that, its head's native drag, and the frame saved once a move settles
        threads-presence.ts          # One open or close at a time: show and grow, or focus or raise without focus while shown; shrink and hide, then the closed report, and the presented report for an automatic request
        threads-resize.ts            # A handle drag into the window's box, applied at most once a frame, the frame saved after the last apply
      settings-window/               # The settings window's wiring
        wire-settings-window.ts      # Stores, config, cross-window sync, and the settings panel remounted on locale change, bound to the query's preset when it names one, and editing the preset `?edit=` names
        edit-target-url.ts           # The settings URL with its `edit` param set to the picked preset, or dropped for the window's own, and its `page` and `focus` params set to the requested page and field
        wire-settings-page.ts        # Takes the URL's page and focus, and answers an opener's page request: switches to the opener's character, then selects the page and focuses the field it names
        wire-voice-mirror.ts         # Mirrors the voice toggle to the pet window and the pet window's voice state back; main only
    logger.ts                        # Namespaced frontend logger with a runtime level
    tauri-env.ts                     # Tauri runtime detection
    windows/                         # One entry file per window, loaded by the matching HTML file
      main.ts                        # Pet window: config load, renderer, dispatcher, and the I/O graph
      settings-main.ts               # Settings window: mounts the settings window wiring, with the companion guard when the query binds a preset
      devtools-main.ts               # Developer Tools window
      message-main.ts                # Message window: the bubble, input, and plate, with the companion guard when the query binds a preset
      unified-main.ts                # Unified chat window: the frameless 340 px column, the speech stream into its box, and the composer that routes a message
      threads-main.ts                # Threads window: boots the Threads window wiring
    styles.css                       # Pet-window base stylesheet
    vite-env.d.ts                    # Vite client types and build-time env declarations
    contract/                        # TS contract types — the wire schema source of truth
      types.ts                       # Wire schema source of truth for the YUI to backend contract
      index.ts                       # Contract barrel
      builtin-client-tools.json      # Built-in client tool names; the MCP host's name conflict rule reads them and a Vitest test checks them against the tool registry
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
          persona.ts                  # The persona.json card, framing sentence, and user fallback validation
          read-card.ts                # The V1, V2, and V3 card reader with its issues
          types.ts                    # A card's Tavern Card V2 shape, its limits, and the persona config type
          serialize-card.ts           # The card as a chara_card_v2 envelope for export
        screen.ts                    # The screen.json type and the validation of its frontmost-transition thresholds
        shared.ts                    # Shared ConfigError plus issue-recording helpers
    renderer/                        # three.js + VRM rendering
      index.ts                       # three.js and VRM output layer: scene, rAF loop, VRM load and hot-swap
      types.ts                       # Renderer options, per-frame tick context, and the Renderer surface
      apply-directive.ts             # Pure routing of a control envelope into the emotion and motion sinks
      frame-gate.ts                  # Pure idle and active frame-throttle decision
      frame-loop.ts                  # The rAF loop with its clock, hidden-document pause, and idle-throttle gate
      landing.ts                     # Her landing bounce on the canvas after a sit, about the live seat
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
          alpha-hit-test.ts          # CPU-side low-res silhouette grab, its sampling and its bounds
          hit-test.ts                # Pure helpers for the alpha silhouette predicate and its bounds
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
          fallback.ts                # Idle-fallback decision for a motion whose clip fails to load
          cycle-dwell.ts             # Single-timer scheduler for a cycle motion's variant swap
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
    dispatcher/                      # Event bus + classify, guardrail, route
      dispatcher.ts                  # The router that enforces the firing-is-not-judgment boundary
      core/
        classify.ts                  # Pure tier and target classification of a bus envelope, plus the paced-source table
        event-bus.ts                 # Priority queue collecting every speech-candidate event
        guardrails.ts                # Debounce and rate-limit evaluation
        addressed-chain.ts           # The chain cap: how many addressed turns a window takes in a row without a user turn
        paced-pipeline-busy.ts       # The pipeline-busy predicate composed with the proactive gap
        proactive-pacer.ts           # The proactive gap after a turn that every proactive source shares
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
            perch-follow.ts          # Carries a seated character with her host window as it moves or resizes
            placement.ts             # Programmatic placement of the character on a named window
        addressed/                   # The character-addressed firing source and the speaking half
          addressed-source.ts        # Turns a character-addressed bridge event for this preset into the addressed.character candidate
          addressed-producer.ts      # Emits the character-addressed event for this window's reply once its turn is over
        routed/                      # The unified chat window's messages arriving as user turns
          routed-user-source.ts      # Submits a user-turn-routed event naming this preset as a user turn with its send id and mention
          user-turn-done.ts          # Reports user-turn-done for a closed or dropped turn's send id
    ambient/                         # Backend-independent local liveliness and movement
      come-along/                    # Her come-along onto the settings stage
        come-along.ts                # One settings window's session: the pickup and ease-in-out carry onto the slot, the dock and entry clip, following the slot, the carry home, and a drag or agent move letting her go
        entry-pick.ts                # Picks her entry clip from the Entry family of her last backend emotion
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
        hold/                        # Who holds her still
          holds.ts                   # The holders and what each hold declares: an abort, ending on a drag, keeping her geometry, pausing keep-on-screen
        sitter.ts                    # Seat transitions: crossfade and eased window move
        clip-leg.ts                  # A window leg paced by an in-place clip
      threads-reaction/              # Thread reactions: the count-edge and long-wait thresholds, and the reaction when she is free
        reaction-thresholds.ts       # The waiting count's rising edge and the per-Thread long wait that start a reaction without a chip tap
        thread-reaction.ts           # Runs a reaction on a chip tap, the count edge or a long wait when she is free: the filler line, the window open or raise without focus, her seat on it, and the expression
    settings/                        # Persisted user settings, one store per setting, grouped by the part of the app they configure
      persisted-store.ts             # Shared bootstrap, notify, reload, and localStorage core for the settings stores
      settings-stores.ts             # Constructs and synchronises the persisted user-setting stores
      appearance/                    # The window theme
        theme-settings.ts            # The dawn, hearth, or system theme under yui.theme
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
      active-hours/                  # Each character's active-hours spans and the card's spans they fall back to
        spans.ts                     # Span and pace rules: the four paces, their gap factors, and which span holds a minute
        card-active-hours.ts         # The card's extensions.yui.active_hours, the spans in use, and the export transform
        active-hours-settings.ts     # The per-character store of edited spans under yui.active-hours
        base-pace-settings.ts        # The device-wide base pace under yui.base-pace, multiplied into each pet window's span pace
      capture/                       # Screen watching and screenshots
        screen-settings.ts           # User-editable screen-watch thresholds
        screenshot-settings.ts       # Screenshot enabled state and source
      presence/                      # The user's last presence
        last-together-settings.ts    # The device-wide last present tick under yui.last-together, written at most once a minute; the milestone payload's last_together reads it
      agent-access/                  # The settings a backend agent may read and change through yui_run, and the tier each row takes
        rows.ts                      # The exposed settings rows: path, label, type, range, and the direct or allow tier
        document.ts                  # Reads the exposed settings as one document, and applies the direct rows of a JSON merge patch and returns the allow changes
        paths.ts                     # Dotted-path reads and writes over the settings document
        validate.ts                  # The store probe a row's value passes before it is written
      avatar/                        # Camera, motion, and lip-sync
        camera-settings.ts           # Camera zoom and orbit viewpoint
        camera-gestures.ts           # Maps orbit moves and pinch ratios onto the camera store
        express-motion-settings.ts   # Curates the motion vocabulary the agent may choose from
        idle-motion-settings.ts      # Selects which ambient idle variants may play
        lipsync-settings.ts          # Lip-sync gain
      voice/                         # Filler speech and voice activity detection
        card-filler.ts               # The card's extensions.yui.filler pools, and the transforms around it
        filler-settings.ts           # Filler phrase pools and behaviour flags
        readings-settings.ts         # Device-wide reading dictionary: the raw surface=reading text as typed
        vad-settings.ts              # VAD silence window
      preset/                        # Presets: which keys belong to one, the active one, the registry, and the windows bound to one
        preset-keys.ts               # The per-preset key list and where a key lives under a given preset
        active-preset.ts             # The registry's stored shape and the id a window resolves its keys under: the preset query, else the active preset
        bound-preset.ts              # The page queries that bind a window to one preset (`?preset=`), name the preset a settings window edits (`?edit=`), and the page it opens on (`?page=`)
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
      threads/                       # The Threads window's own state
        threads-window-settings.ts   # Its panel frame and list choice under yui.threads-window, per device; the minimum panel
        thread-reaction-thresholds-settings.ts # The waiting count and wait that start a Thread reaction without a chip tap under yui.thread-reaction-thresholds, device-wide
      panels/                        # Panel and window state
        delegation-chip-settings.ts  # Per-device fold state of the delegation chip
        settings-pages.ts            # The settings page ids, character pages and app pages, the focus field ids, and the checks for a page and a focus
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
          tool-results/                # Tool results encoded for each request transport
            chat-completions.ts        # Chat Completions tool messages, an image following in the next user message
            responses.ts               # Responses function-call output, with images as input_image items
        push/                          # The push transport's turn and reply WebSocket
          fit-turn-images.ts           # Shrinks a turn's images to the byte budget the backend stated for the frame
          push-frames.ts               # Push frame wire types and the unreadable-frame checks
          push-socket.ts               # Single WebSocket the push transport runs turns and replies on
          tool-calls.ts                # Validates, queues and answers the backend's tool_call frames
          tool-results/                # Tool results encoded for push frames
            encode.ts                  # Text and image tool results within the push frame's byte cap
        tools/                         # Declared client tools and built-in On-demand tools
          client-tools.ts              # Registry of the declared tools and the ClientTool type
          execute.ts                   # The bounded execute both the request transports and the push consumer call
          express.ts                   # The generate_express tool
          avatar.ts                    # The body_action and look tools over the avatar executor
          relation.ts                  # The rate_relation tool: one accepted call per target per turn
          address-character.ts         # The address_character tool: names the character a reply is for, once per reply
          pet-window-tools.ts          # Splits a window's declared tools from its Terminal and Threads On-demand tools
          bridge/                      # Bridge tools for built-in On-demand tools and enabled plugins
            bridge-tools.ts            # yui_tool_describe, yui_tool_call and plugin_skill
            on-demand-lines.ts         # Builds the lists the Bridge tool descriptions carry: built-in summaries first, then enabled plugin tools, then plugin skills
            plugin-result.ts           # A plugin tool's MCP result as a client tool result: text, images, the error mark
            first-violation.ts         # The first JSON Schema violation of a call's arguments, as an instance location and a message
          run/                         # yui_run: a backend script in a QuickJS sandbox over the yui API
            yui-run-tool.ts            # The yui_run tool: runs the script and answers its JSON result
            sandbox.ts                 # Runs a script in a fresh QuickJS module under the CPU, stack and output limits
            help.ts                    # The text help() prints: the yui API, the settings rows, and the usage rules
            settings-api.ts            # yui.settings: the exposed document, and a patch whose allow paths wait for the user
            state-api.ts               # yui.state: start time, last presence, open characters, screen recording permission
            info-api.ts                # yui.info: the bodies, voices and monitors a setting can name
            selection-rows.ts          # The io-owned settings rows: the VRM body and the speaker voice
          screen/                      # The screen tool
            screen-query.ts            # Answers a screen query from the live monitors and a screenshot
        vocabulary/                    # The emotion, motion, and voice-tone ids the agent may cue with
          express-vocabulary.ts        # Derives the express vocabulary from the loaded config and the motion selection
        card/                          # The card a preset sends: resolution, assembly with macros, and the greeting pick
          resolve-card.ts              # The preset's card and its effective name; null on push or with the switch off
          assemble-card.ts             # The first system message and the post-history text, with {{char}}, {{user}}, {{original}}
          pick-greeting.ts             # One of the card's greetings at random
          perform-greeting.ts          # Speaks a card greeting into the transcript at a session reset
        conversation/                  # Transcript, context, and session state for conversation continuation
          chat-history-store.ts        # Unified conversation transcript with session boundaries
          signal-history-store.ts      # Per-turn signal records, one per group, spoken or silent
          context-history.ts           # Capped ring of recent client-context entries
          overheard/                   # What this window has heard of the other open presets
            overheard-reader.ts        # Reads the lines other open presets exchanged since this window last heard them
            overheard-store.ts         # Per other preset, the cursor up to which this window has heard its transcript
          session-store.ts             # Holds the last Responses response.id for conversation continuation
          session-diagnostics.ts       # Used tokens and context window for the settings window
          reset-conversation.ts        # Start fresh: the one conversation reset the History page and the Character menu call
        models/                        # The chat server's model list
          reader.ts                    # Reads the OpenAI-compatible /models list; every failure is a result kind
        record/                        # The turn-record JSONL log
          turn-record-log.ts           # Appends one JSONL record per completed turn or skipped fire
      threads/                         # The Thread store's client
        threads-client.ts              # The highest-revision snapshot from threads_snapshot and threads-snapshot, and thread_read
      presence/                        # The user's presence for main's pet window
        presence.ts                    # The last os_idle_tick idle ms read against the away threshold
      mcp-host/                        # The MCP host client and enabled plugin summaries and skills
        mcp-host.ts                    # The host's newest snapshot and its subscription, the call, cancel and skill invocations, and the settings window's managing commands
        enabled-plugins.ts             # The enabled plugins' tools with their summaries, their skills with their descriptions, and the tool lookup a call makes
      voice/
        deadline.ts                    # Per-request deadline and the body-read race that settle a stalled fetch
        stt-vad.ts                     # Voice input pipeline: VAD segmentation then STT upload
        mic-error.ts                   # The mic failure cause codes the voice status carries
        open-mic-settings.ts           # Opens the macOS Microphone privacy pane, offered by the status pill beside a blocked mic
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
          readings.ts                  # The surface=reading dictionary parser and its readings lookup
          voice-gate.ts                # One voice at a time across windows: the yui.speaking Web Lock
        voices/                        # The speaker catalogue: selection, the voices API, and voice import
          tts-voices.ts                # Lists, uploads, and deletes reference voices on Irodori's voices API
          voice-apis.ts                # Voice list, upload, and delete per TTS provider; OpenAI's fixed built-in list
          fish-voices.ts               # Fish Audio's /model API: the account's voice models, import from a clip, and delete
          fish-key-check.ts            # The Fish key check of Quick start's voice step: a voice list read that is ok, refused on 401 or 403, or failed
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
        current-window.ts              # Closes or destroys the current window and listens for its close request
        serial-queue.ts                # Runs window open and close steps one after another; a failed step is logged and the next one still runs
        latest-only.ts                 # Runs a step one at a time, once more after a run that another call came in during
        capture/                       # Screen enumeration and screenshot capture
          tauri-screen.ts              # Tauri-backed screen enumeration and capture
          screen-source-provider.ts    # Monitor enumeration seam
          screen-point.ts              # A physical screen point as a logical one over a display's scale
          screenshot-context.ts        # Pure encoder for the screenshot context block
        geometry/                      # Monitor and floor math the window movers share
          screen-geometry.ts           # Monitor containment, work-area floor math, and window clamping shared by every window mover
          companion-position.ts        # Where a companion window (message, unified) opens: its stored position, else beside the pet window, kept on screen; the column's width and handle height
          companion-column.ts          # A companion column window's focus, OS drag, content-height resize and moved-position report
          roomier-side.ts              # Which side of her has more free room in the work area
          threads-position.ts          # The Threads window's box: its first place beside the pet window on the roomier side, a stored frame moved into the nearest work area, a handle drag's box between the minimum and the work area, and the chip-sized rect its grow starts from
          keep-on-screen.ts            # Pushes a window back until its centre lands on a monitor
          travel-frame.ts              # Parks the real window once for a scale-seam crossing
          tauri-frame-window.ts        # The real pet window as one FrameWindow seam, built once for the movers
          stage-slot.ts                # Sends a settings window's stage slot to its pet window at boot, on a move, resize or visibility change, and on an ask; null while minimised
          perch.ts                     # Perch values, perch-target and placement types, and the host-edge span shared by the drop source, avatar RPC and locomotion
        openers/                       # Openers and placement of the message, settings, devtools, and pet windows, the first two bound to a pet window's preset
          settings-window.ts           # Settings window opener, settings-<id> for a bound id, landing on a page or asking the open window for it, and cross-window settings sync
          devtools-window.ts           # Developer Tools window opener
          message-window.ts            # Message-window opener, message-<id> for a bound id
          ready-window.ts              # A hidden window created once, a leftover recreated, a request held until the window reports ready
          threads-window.ts            # Threads window opener on ready-window: the chip's screen rect in each open request, the closed report passed on, present and isOpen for a Thread reaction; its permissions are src-tauri/capabilities/threads.json
          message-window-mode.ts       # Keeps the message window in step with the stored mode, the unified chat window and the dock request
          unified-window.ts            # Unified chat window opener: shows the one frameless window labelled unified, or creates it at its stored position, and destroys it; its permissions are src-tauri/capabilities/unified.json
          pet-window.ts                # Bound pet window opener: creates pet-<id> and lists the windows that exist
          companion-windows.ts         # Closes a bound pet window's settings-<id> and message-<id>, and watches a companion's owner window
        pet/                           # The pet window's own gestures, hit-test, gaze cursor, and peek
          cursor-source.ts             # One OS-cursor poll shared by gaze and the hit-test, in window-local CSS px
          hit-test.ts                  # Click-through hit-test controller for the transparent window
          peek-state.ts                # Holds the current peek side and its lifecycle
          gesture/                     # The three pointer-gesture detectors the stage wires
            orbit-gesture.ts           # Shift + left-drag camera orbit gesture detector
            click-gesture.ts           # Sub-threshold click and press-and-hold pat detectors
            window-drag.ts             # Threshold-gated OS-native drag handoff for the main window
          window-resize-source.ts      # Ctrl+wheel over the character resizes the pet window
          summon-hotkey.ts             # Registers the OS-wide summon accelerator and summons the input
          window-dock.ts               # The dock commands into her own settings window, its close event, and a physical-px move
      bridge/
        settings-bridge.ts             # Typed cross-window settings bus: one table of its channels, each with its scope and payload check
        core/                          # The cross-window bus every bridge here is built on
          bridge-core.ts               # Transports, message envelope and listener bookkeeping shared by every bridge
          channel-table.ts             # Builds a bridge's emit/on pairs from its channel table, and its state mirrors with `channelMirror`
          state-mirror.ts              # One window's value published to the others and mirrored back
        message/                       # The pet ↔ message window bus and its remote half
          message-bridge.ts            # Cross-window bus linking the pet window and the message window
          message-remote.ts            # The message window's bubble and input as a remote Surfaces half
          surface-ops.ts               # Each pet → message surface op once: its payload, the call that sends it, the call that draws it, and whether ready replays it
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
          ingress-dead.ts              # Subscribes to the Rust ingress-dead event channel
          signals-inbox.ts             # Subscribes to the Rust signals-inbox event channel
          preset-ids.ts                # sync_preset_ids: the registry's preset ids published to the shell for ingress routing
          create-inbox.ts              # Generic Tauri event-channel subscription seam
      assets/
        vrm-import.ts                  # VRM import: OS picker, native copy, avatar-option registration
        card/                          # The card's file steps: import, export, and the thumbnail URL
          card-import.ts               # Card import: OS picker, native read/parse, and the rollback of the claimed thumbnail, VRM and voice folder
          card-thumbnail.ts            # Thumbnail retain (temp id → preset id, framed by its default crop), remove, and the photo pick that stores a preset's thumbnail, through the shell
          photo-size.ts                # The natural size of a photo, read by decoding it
          card-export.ts               # The export file-name sanitizer
        preset-file/                   # The preset file (.yui) and PNG card export steps
          preset-file-export.ts        # VRM license read, preset file write, and PNG card write, through the shell
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
        apply-speech-op.ts           # Draws one bubble op on the unified box through the surface op table
        summon-key.ts                # Binds the focused window's "/" key to open the text input
        anchor.ts                    # Pure mapping from the on-screen feet to the input's bottom offset
        interactive-overlay.ts       # Selectors of overlay elements that take OS pointer events while shown
        mock.ts                      # Mock driver that replays every surface state from seed data
        surfaces.css                 # Speech bubble and text input styles
      input/                         # Text entry and its supporting transforms
        text-input.ts                # Text input: submit, busy, error, and feet anchoring
        action-button.ts             # The composer's stop and send button
        image-resize.ts              # Downscales and re-encodes user-attached images
        format-accel.ts              # Renders an accelerator string for display
      message/                       # The bubble and the name plate riding its box in both modes
        speech-bubble.ts             # Speech bubble: dwell, scroll, markdown, and aria for streamed speech
        typewriter.ts                # Pure reveal cursor: types a line at 40 ms per character, from elapsed time
        stable-markdown.ts           # The prefix of a streaming line whose rendering later text cannot change
        text-prefix.ts               # A rendered line's text as the typewriter counts it, and cutting a rendering to its first characters
        backlog.ts                   # The current session's earlier lines, opened above the box by a toggle on its bottom edge
        user-quote.ts                # The user's message quoted on the bubble's first line
        signal-source-lines.ts       # A signal turn's source lines in the bubble's quote slot
        reasoning-disclosure.ts      # Backend reasoning folded under the quoted line at the top of the bubble in the message window
        message-plate.ts             # Name plate on the box's top-left edge in both modes: face, name, state; the message window's OS drag handle
        plate-state.ts               # The plate's turn state in both modes: responding from a line's begin to its end or hide, thinking while busy
        markdown.ts                  # Markdown for the bubble, backlog and Thread entries: marked, then DOMPurify keeping only Markdown's elements
        message-plate.css            # Name-plate chip styles: face, name, state dot, state label, and dock button
        message-window.css           # Message-window layout and name-plate styles
        cue-list.css                 # Cue-list section styles
      unified/                       # The unified chat window
        unified-view.ts              # Wires the modules; keeps the pending sends
        lane-queue.ts                # One lane per preset: one line holds the box until done, the next lane replays what it buffered
        cast-state.ts                # Each preset's turn state and sent name, and the talk/think/idle rule for its chip
        cast-chips.ts                # The head row and recipient picker: a radio chip per open preset with its line state and one for everyone, the × and the drag handle
        backlog-lines.ts             # The backlog's lines: the user's under "You → <recipient>" without the @name it repeats, a character's under its name
        merge.ts                     # Pure: the open presets' transcripts and the pending sends as one time-ordered list, each user row with its recipient
        targets.ts                   # Pure: the fallback target, the targets of a message, and the send built from what the user typed
        sequence.ts                  # One-at-a-time delivery of the current send, target by target, with its 60 s timeout, cancel and log line
        composer.ts                  # The message window's field under the text input, with the recipient in its placeholder, send and stop, and the inline error
        mention-picker.ts            # The @ list over the field: a combobox of the open presets and @everyone
        avatar.ts                    # A preset's face, drawn by every window: its photo framed on the stored crop in a circle over the preset's hue, else a dot; the plate and the unified window reuse it
        avatar.css                   # The face's size and shape, for every window that draws one
        unified-window.css           # The 340 px column: cast row, box, composer and @ list
      signals/                       # The source line of a signal group, shared by the bubble and History
        source-line.ts               # Renders one source line: delivery-class dot, source, label
        source-line.css              # Source-line styles: filled urgent dot, ring batched dot
      chips/                         # Status, signal, and delegation chips beside the avatar and on the message-window plate
        status-pill.ts               # Status pill: capture, voice, and backend tool tells in one pill
        tool-labels.ts               # Tool id to display label lookup
        delegation-chip.ts           # Push-transport delegation chip beside the avatar with its tap-to-toggle list popover
        delegation-rows.ts           # Delegation list's shared row rendering and relative time text
        hold-to-fold.ts              # A press held past 500 ms folds the chips and swallows the release's click
        voice-input-status.ts        # Voice-input status model
        voice-error-dwell.ts         # How long a voice-turn failure holds the status pill's voice error state
        turn-notice.ts               # The status pill's failed-turn notice, its action, and how long it holds
        signal-chips.ts              # One pill per signal group beside the avatar, above the delegation chip
        signal-chips-model.ts        # The signal groups beside the avatar, newest first, in memory only
        signal-details.ts            # One signal group's source line, kind, label, time, what YUI said, and its raw items
        fit-sheet.ts                 # Keeps the details sheet inside the window: lift, then cap and scroll
        status-pill.css              # Status-pill styles
        delegation-chip.css          # Delegation-chip pill, list popover, and folded-dot styles
        delegation-rows.css          # Delegation row styles shared by the chip's list and the settings panel
        signal-chips.css             # Signal-chip pill, details sheet, and fold styles
      notices/                       # One-off and error notices
        turn-error.ts                # Backend-failure reason to its message, its next step (Connect, Change key, Check connection or Retry), and where it shows
        fade-out.ts                  # Settle callback for elements that fade before leaving the a11y tree
        boot-error.ts                # Boot-failure notice card
        chain-reset-notice.ts        # One-off notice when the backend resets a broken response chain
        ingress-dead-notice.ts       # One-off notice when the Rust agent ingress listener dies
        first-run-hint.ts            # First-run controls hint through the speech bubble
        boot-error.css               # Boot-failure notice styles
      threads/                       # The Threads chip and the Threads window
        thread-source.ts             # A source's name and mark; unknown sources show their raw name and a generic mark
        chip/threads-chip.ts         # The chip: newest source marks, label, count; hidden at zero and while the window is open, one wiggle on arrival, hold-to-fold, and its slot rect while hidden
        window/threads-view.ts       # The window's facade: the panel, the one React root, and the layout, splitter, resize handles, keys, motion and minute tick on the committed DOM
        window/threads-window.tsx    # The window's content: the head (sidebar toggle, Threads and Terminal tabs, count, Thread turns, ×) over both tabs' panels
        window/tab-body.ts           # What the window hands the Terminal tab's vanilla body, and what that body gives back
        window/threads-tab.ts        # The Threads tab's state: snapshot, filter, selection, the asked Thread, and the moves and focus handoffs
        window/threads-tab-view.tsx  # The Threads tab's view: the list, the rail and the thread pane from the tab's state
        window/thread-list-view.ts   # What the list and the rail show: waiting-first rows, counts, the kind items, and the Thread an open shows
        window/thread-list.tsx       # The list pane: the Waiting / All segment, the kind select, waiting-first rows
        window/thread-rail.tsx       # The rail: the Waiting / All segment as marks over counts, the kind select behind a mark, one source mark per row
        window/row-focus.ts          # Focuses a list's current row, and gives the focus of a row that left to its neighbour
        window/thread-meta.tsx       # The source line and the state word a row and the pane lead with
        window/thread-pane.tsx       # The thread pane: head, Mark read, and the scrolling transcript
        window/turns-menu.tsx        # The head's Thread turns button and its popover of the three levels
        window/glyph.tsx             # A Threads line glyph as JSX
        window/entry-markdown.ts     # An entry's text as Markdown nodes: https images only, no list formatting whitespace
        window/grow.ts               # The grow out of the chip, with a jelly on an automatic open, and the shrink back
        window/hop.ts                # The panel's hop inside its margin when a Thread reaction raises the window
        window/resize-handles.ts     # The panel's edge and corner hit areas, reporting a drag in screen px, and the size readout
        window/threads-layout.ts     # The layout the panel's width picks, the collapsed list, the medium overlay and the narrow screen
      ask/                           # The Ask card and its answer area
        answer-area.ts               # The answer area: numbered choices, the growing field, and the send button
        ask-card.ts                  # The oldest supplied Ask above the input, with its countdown, choices and draft
        ask-route.ts                 # Shows the Asks on the one side the target picks, clearing the previous side, and hears answers from every side
        settings-request-prompt.ts   # The Settings request card's lines, with every agent-written value escaped as plain text
      character-menu/               # The pill menu a right-click on her opens in the pet window, built without React
        items.ts                     # The item tree for the main or a bound pet window: Talk, Rest, Listen, Settings, Body, Voice, Pace, More
        layout.ts                    # The two columns beside her, the fold to one near a screen edge, and how far the widened window reaches
        keys.ts                      # The keyboard order and moves, back and close
        glyphs.ts                    # The menu's line glyphs
        character-menu.ts            # The menu factory: pills, in-place lists, the inline confirm, her name, focus and close rules
        character-menu.css           # Pill, plate, list and confirm styles
      use-snapshot/                  # React hooks for sources that return a fresh object each read
        use-snapshot.ts              # Binds such a source to a component
        use-notify.ts                # Re-renders a component on each notify of a source it reads itself
      settings-stage/                # The settings window's 400px stage on its left, beside the panel
        settings-stage.ts            # The stage's factory: mounts it first in the window's row and re-renders its foot for the window's own character
        stage-foot.tsx               # Her name over her transport and window state
        settings-stage.css           # The stage column on the stage ground
      quick-controls/                # Settings panel shell parts and sections
        quick-controls.ts            # Settings panel: creates every page's controller, renders the panel's one React root, and runs the open, close and teardown of its pages in order
        quick-controls.css           # Settings panel shell, tab rail, sections, groups, and rows
        controls.css                 # Segment, field, text-button, disclosure, slider, confirm, and affirming-pill styles, and the imports of the Switch's and Segment's CSS from `src/ui/controls/`
        settings-window.css          # The settings window's opaque body filled with the panel surface once the theme is set, and its row of the stage then the panel
        settings-panel.tsx           # The panel's React view: the preset header, the rail (search field, group headings and tabs on the shared Tabs, each with its tip) and every page's panel with its scope line, title and page, under one shared tooltip
        page-view.tsx                # A page as the panel renders it: the page controller's view type, the one `div.yui-tab-stack` around each view, and the page's own redraw, which the open hook bumps so only that page renders again
        panel-shell.ts               # Panel shell: the open and close lifecycle, and Escape closing the settings window
        constants.ts                 # Display constants shared by the panel, its sections, and the chips that reuse its glyphs
        glyphs.tsx                   # The glyphs the pages render as JSX: the warning glyph of Quick start's and the Plugins page's error lines, the rail's tab icons, the list rows' rename and remove glyphs, the add buttons' plus, and the preset header's photo, copy and manage glyphs
        switch-row.ts                # Switch-row element contract, the row table filling it, and each row's store follower
        row-actions.css              # The rename and remove ghost buttons, hints and keys the preset header and the asset lists share
        asset-list/                  # The state and rules the VRM and speaker radiogroups share
          use-asset-list.ts          # Roving focus, swap, rename, the armed remove with its confirm delay, and the open-gated store subscription
          rename-input.tsx           # The inline name field: Enter and blur commit, Esc cancels, a refused name stays open, an optional warning after the hint
          asset-list.css             # Radio row, tick, and state styles shared by the monitor, VRM, and speaker lists
        voice/                       # The Voice page, rendered with React
          voice-page.ts              # The page's controller: its view, the open hook that re-reads every source, and the close hook that stops the audition
          voice-page-view.tsx        # The TTS switch and the speaker list, the thinking filler, then the message-window row
          speaker/                   # The speaker list
            speaker-section.tsx      # The radiogroup, the import row, the naming row, and the paste-a-voice-id field
            speaker-row.tsx          # One speaker radio, with its rename, remove, refresh and preview buttons
            use-pending-import.ts    # The two-phase import: a staged copy named by a row, discarded on Esc or when the list goes
            use-reference-refresh.ts # The per-row reference-voice refresh, its done dwell and its re-entry guard
            audition.ts              # The preview: one clip at a time, held by the Voice facade so its close stops it
            use-audition.ts          # The playing row for the list, and the stops when a swap starts or that row leaves the list
            speaker-rules.ts         # The ids another provider's voice holds, and the removal of a bundled or imported option from the store
            manual-voice-id.tsx      # The paste-a-voice-id field and its refusals
            speaker-list.css         # Speaker list styles
          filler/                    # The thinking filler
            filler-section.tsx       # The enable switch, the language segment and the eight phrase-pool textareas with the More phrases fold
            filler-tool-lines.ts     # Textarea round-trip for the filler pool's tool tier
        body/                        # The Body page, rendered with React
          body-page.ts               # The page's controller: its view, and the open hook that re-reads every source
          body-page-view.tsx         # The VRM section, the relations rows and the view reset
          vrm/                       # The VRM radiogroup
            vrm-section.tsx          # The radiogroup, the import row, and the VRoid Hub link
            use-vrm-import.ts        # The one-shot import: the loading row while it runs and the inline error when it rejects
            vrm-row.tsx              # One VRM radio, with the rename and remove buttons of an imported one
            vrm-list.css             # VRM list styles
          relations/                 # Relations section
            relations-edit-section.tsx # One slider row per target that sets the relation by hand, shown while the Relations switch is on
            relation-row.tsx         # One row: the glyph, the name and sub line, and the slider that previews on drag and commits on release
            relations-port.ts        # What the section reads from the relations store and switch, each redrawing only while the panel is open
            relations-edit.css       # Relations rows, the centre-out slider fill, and the number
          viewpoint/                 # Camera view reset
            viewpoint-row.tsx        # Camera view reset button
        motion/                      # The Motion and desktop page, rendered with React
          motion-page.ts             # The page's controller: its view, the open hook that re-reads every source, and the close hook that ends the gain preview
          motion-page-view.tsx       # The mouth gain, the idle and express motions, then the motion switch rows
          motion-ports.ts            # What the page reads, each repainting at once and only while the panel is open
          gain/                      # Mouth gain
            gain-row.tsx             # The gain slider and readout; a release or blur ends the preview and logs the gain
            gain-preview.ts          # The mouth opening the preview shows, and its end
          idle-motion/               # Ambient idle pool
            idle-motion-section.tsx  # Idle variant switches, the baseline locked on
          express-motion/            # Express motion vocabulary
            express-motion-section.tsx # Express motion categories: the accordion, each group's tri-state master, and the motion switches
            express-motion-section.css # Express motion styles
        connection/                  # The Connection page, rendered with React
          connection-page.ts         # The page's controller: its view, the view it shows (Quick start hides the scope line), the entry, the focus requests, the commit and the push port the panel uses
          connection-page-view.tsx   # The Quick start | Detailed settings switch over both views, both mounted
          connection-page.css        # The views switch's segment and the view wrappers
          endpoints-section.css      # Endpoints section, the key fields, and the shared chat-status dot styles
          detail/                    # Detailed settings, rendered with React
            detail-settings.tsx      # The chat section, the reasoning-effort row, the STT and TTS sections, and the commit, entry and close the page calls
            endpoint-form.ts         # The endpoint drafts: typing holds a draft, a commit, blur or close writes it, a reset clears a service
            endpoint-row.tsx         # One endpoint field row: label, sub line, the field or a control in its place, the URL error
            select-row.tsx           # A select row: the label, then the control
            reset-row.tsx            # A service's reset button
            stt-section.tsx          # The STT section: the disabled type select, URL, model and language, its server line and reset
            tts-section.tsx          # The TTS section: the provider select, URL, model and key, its server line and reset
            effort-row.tsx           # The reasoning-effort segment, disabled on push with its reason
          chat/                      # The Chat section of the Connection page, its model list, and its status line
            chat-section.tsx         # The Chat section: the type and preset selects, the model field, the key, the model-list read and its status line
            chat-type.tsx            # The chat type row: long names in the popup, the short name on the closed trigger, the description line
            chat-type.css            # The description line of that row, and the key page link look
            chat-status.tsx          # One status line: the dot, the state text and the action button, and the push socket's view
            chat-status.css          # Chat status line and reconnect action styles
            model-field.tsx          # The chat model field on Base UI's Autocomplete, filtering the server's model ids
            model-field.css          # The model list's popup beneath the field
            model-read.ts            # One model-list read at a time: deduped, superseded, and reported as results
            model-status.ts          # Maps the model-list read's phase and the model text to the status line's view
            push-state-text.ts       # Where the push socket stands, in words, for the status line
          server-line/               # The STT and TTS server lines
            server-line.tsx          # One line: checks on entry, again when its watched fields or key change, and drops a superseded answer
            server-line-view.ts      # Maps one server check to the line's view
            host.ts                  # A URL's host
          quick-start/               # The Connection page's Quick start view, for the free Gemini path
            quick-start.tsx          # What is sent, the daily limit, the key page link, the key confirmation, and the connected state with the voice step and Help
            voice-step.tsx           # The optional Fish Audio key: the key page link, the key check, the default voice for the app language, and the Maybe later button
            key-link.tsx             # A key page link that the opener opens and plain Tab reaches
            paste-key-row.tsx        # A pasted key's row: the field and its reveal, the confirming pill, the checking line, the error with its key page link
            gemini-connect.ts        # The write once Gemini confirms a key: the key alone, or the whole connection with check-ins and the schedule off
            stored-key-check.ts      # The stored key's check, its verdict reused on the same key for a minute
            voice-turn-on.ts         # The write once Fish confirms a key: the Fish preset, the key, TTS on, the default voice active
            key-state.ts             # The connected key state: the paste row, the stored key's last check and a replacement, as pure transitions
            quick-start.css          # The key row's and the voice step's layout, the replacement note, and the view's state lines
        delegations/                 # The delegated list's sync, which lives with the panel and not with a page
          delegation-feed.ts         # The list's subscription and minute refresh, and the version a page reads to redraw
          delegation-sync.ts         # Minute refresh timer that follows the running delegated items
        preset/                      # Preset header above the rail, rendered with React
          preset-header.tsx          # The preset header: the character header that picks the preset to edit (`?edit=`), the manage button and its popover, the edited preset's note, the relation line and the photo dialog
          edited-preset.ts           # The preset the window edits and its registry state, held once it leaves the registry, which hands the window on
          character-header.tsx       # The settings window's header: every preset with its face, transport and window state; a click edits it
          character-meta.ts          # A character's window state and its "{transport} · {state}" line, shared with the settings stage
          preset-manage.tsx          # Manage popover: rows with inline rename, delete confirm, "Use in main" (it switches main's preset), and the new-preset field
          preset-scope.tsx           # The edited preset's name: each page's scope line, only the edited character or every character, and the rail's character heading
          use-prepended.ts           # Keeps a vanilla element, a face or a glyph, first inside a React-rendered host
          preset.css                 # Preset header, manage popover, scope line, relation line, and reasons card styles
          photo-dialog/              # The photo dialog
            photo-dialog.tsx         # The modal `<dialog>`: the photo under a circular mask, zoom, the fixed framings, Choose another, the previews at the sizes a face is drawn, and the per-preset guard on a picked photo's default framing
            crop-stage.ts            # The stage geometry: a photo's position and zoom under the mask, and its conversion to and from a crop
            photo-dialog.css         # The dialog's layout
          relations/                 # The relation line under the preset row, and the reasons card
            relations-section.tsx    # Composes the two, re-renders on the store's notifications, and moves the changed relations after the commit
            relation-glyph.ts        # The five-step glyph and its band motion, the direction mark, and the age text
            relation-line.tsx        # This preset's relation toward each rated target, sorted by strength, on one row: the closed presets and the chips past its width folded into a +N chip, refolded after each commit and on a width change
            reasons-card.tsx         # The band, the engine's note, and the last three reasons of a hovered or focused relation
            view.ts                  # What the two read: this preset's relations as stored now, a target's name, and the rated targets' order
        general/                     # The General page, rendered with React
          general-page.ts            # The page's controller: its view
          general-page-view.tsx      # The language, appearance and text size segments, the user name, Help and Developer Tools
          text-size-section.css      # The line at the speech size under the text size segment
          help/
            help-section.tsx         # One Ask button per bundled guide, then the caller's rows; Quick start's connected state shows it too
          user-name/
            user-name-row.tsx        # The device-wide user name field, its fallback placeholder, and the blur that settles on the stored name
        history/                     # The History page, rendered with React
          history-page.ts            # The page's controller: its view, the start-fresh reset, and the open hook that re-reads every source
          history-page-view.tsx      # The session list and its footnote, the start-fresh row, then the Session section
          history-ports.ts           # What the page reads from the transcript, the signal records, the session diagnostics and the push socket, each redrawing only while the panel is open
          session-list.tsx           # The session accordion: one group per session, the running one open by default
          turn-row.tsx               # One turn: who spoke, what was said, when, and the source lines of its signals
          history-time.ts            # The wall-clock time of a turn and the start of a session
          start-fresh.tsx            # The start-fresh row and its two-step confirm
          character-name.ts          # The edited character's name: its preset's, or its card's while the built-in preset is unnamed
          history-rows.ts            # Merges a session's chat entries with the signal records of the turns that ran in it
          history-section.css        # Session history accordion styles
          session/                   # The Session section: the context readout and the delegated work
            session-readout.tsx      # The context-occupancy readout and meter, and the delegated list with its lost line
            delegated-rows.tsx       # Mounts the delegation rows the pet window's chip also draws
            session-section.css      # Session context-occupancy readout and meter styles
        listening/                   # The Listening page, rendered with React
          listening-page.ts          # The page's controller: its view, and the STT draft it commits on close and the panel's teardown
          listening-page-view.tsx    # The voice switch, the STT key row (a KeyRow), the silence slider, the barge-in and bubble switches, and the reading dictionary
          silence/
            silence-slider.tsx       # The silence threshold slider: its range, readout and fill from the vad store, and the release log
          readings/
            readings-section.tsx     # The reading textarea, its edits, and the line naming skipped lines
            readings-section.css     # Reading dictionary textarea and skipped-line styles
        perms/                       # The Permissions page, rendered with React
          perms-page.ts              # The page's controller: its view, and when the monitor list loads
          perms-page-view.tsx        # The screenshot attach and screen request switches and the screen source stack
          monitors/                  # The screen source list
            monitor-load.ts          # The list's load: one request at a time, its state, and the retry after a failure
            monitor-list.tsx         # One radio per monitor, or the empty or error notice
            monitor-list.css         # Monitor row and notice styles
        persona/                     # The Persona page, rendered with React
          persona-page.ts            # The page's controller: its view, the card's file actions and drop, and the open hook that redraws it
          persona-page-view.tsx      # The Active hours editor above the card
          active-hours/              # The Active hours editor
            active-hours-section.tsx # Span rows (start, end, pace, remove) over the spans in use, and the add and reset actions
            span-row.tsx             # One span row: its two times, the next-day mark, its pace and remove
            active-hours-section.css # Span row styles
          card/                      # The preset's card
            card-section.tsx         # The card fields, send switch, reset and greeting list
            card-section.css         # Card field, state, and greeting row styles
            card-file-row.tsx        # The file action row, its picture gate, the status lines, the one-shot notice and the export panel
            card-entry.ts            # The preset this window edits, the default card an edit starts from, and the card it sends
            card-io.ts               # The file actions: import, PNG and preset file exports, and the one-shot import notice
            preset-export-panel.tsx  # The inline list of what a preset file carries, the rights check, and Export…
            preset-export-panel.css  # The export panel's status inks and actions
            card-drop.ts             # The drop cover: its busy and drop looks, the refusals before a file is read, and the one import a drop starts
            card-drop.css            # Drop cover styles
        plugins/                     # The Plugins page: installed plugins and the catalog, rendered with React
          plugins-page.ts            # The page's controller: its view, and the entry that loads the catalog
          plugins-page-view.tsx      # The Installed and Available sections over one store, and Escape closing a pending panel
          plugins-state.ts           # The page's state and actions outside React: consent, confirms, updates, installs, logs, and the snapshot subscription
          catalog-state.ts           # The catalog's load (an in-flight call joins it), the entries not installed, the updates offered, and Check for updates' timed count
          installed-section.tsx      # The Installed section: its head state, one group per plugin, the foot and a failed delete
          plugin-group.tsx           # One plugin's row and switch, its re-approval note, disclosures, remove confirm, action row and log
          plugin-consent.tsx         # The consent panel: step 1's facts, then the starting, started or failed step 2
          plugin-lines.tsx           # The server line, the hidden-name note and the tool list the group and the consent panel share
          catalog-section.tsx        # The Available section: the catalog entries not installed, and Add from folder
          plugin-sources.ts          # The per-source record (review note, warning, removal text) and the Failure shape
          plugin-parts.tsx           # The source badge and its icons, the version, the inline error line, the keyed block and the page's fade-in flag
          plugins-page.css           # Plugins page styles: badges, server lines, the consent panel, the log box, catalog rows and the keyed block's fade-in; a stopped server's shared status dot dims here
        proactive/                   # The Proactive page, rendered with React
          proactive-page.ts          # The page's controller: its view, and the open hook that re-reads what no store announces
          proactive-page-view.tsx    # The pace section, the source groups in order, then Advanced
          proactive-page.css         # The number column: every number row's field shares one width and one unit slot
          proactive-page.test.tsx    # The page's React tests through its facade
          number-row.tsx             # A number row: label, sub and hint beside a NumberField and its unit slot
          source-group.tsx           # SourceFold and SourceGroup: a switch row over a fold that dims and reads Off while the source is off
          pace/                      # How often she speaks up: the pace segment over her day
            pace-section.tsx         # The base pace segment over her day, its foot line, and the link to Persona › Active hours
            pace-section.css         # The link's inline styles
            day-strip.tsx            # Her day: the pace runs over 24 hours with the greetings and now, then the check-ins after quiet
            day-strip.css            # Her day's lanes on the 8px grid, each position a fraction of its lane
            day-geometry.ts          # Her day as geometry: the pace runs across 24 hours, and where the check-ins after quiet fall
            day-geometry.test.ts     # The day geometry's cases
          advanced/                  # Advanced, folded at the foot of the page
            advanced-section.tsx     # The wait and presence, then the hourly limits and their note
          screen/                    # Screen changes
            screen-group.tsx         # The four screen-watch knobs, their effective values in the fold summary, and the foot
          threads/                   # Thread reactions
            threads-group.tsx        # The waiting count and long wait segments, in a fold that dims while the source is off
          signals/                   # External signals
            signals-group.tsx        # Thread turns, the listener port and address, then the workflows, in one fold
          workflows/                 # Workflows in the External signals fold
            workflow-list.tsx        # The saved rows, the fire flash, the add form and the inline delete confirm
            workflow-list.css        # The saved webhook rows and the add form's styles
          cue-list/                  # The schedule and proactive cue lists
            cue-list.tsx             # The cue rows of one cue list, then its add row; a field commits on its native change
            cue-row.tsx              # One cue row: the collapsed line, the delete confirm, and the editor
            cue-list.test.tsx        # The cue rows, their fields, the delete confirm, and the edit state across new entries
            cue-list-group.tsx       # A cue list's source group: its master switch row over a fold of the entries
        search/                      # Settings search
          settings-search.ts         # Binds the field over the rail: per-page match counts, dimmed pages and matched rows
          settings-search.css        # Field, count badge and matched-row styles
        together/                    # The Together page, rendered with React
          together-page.ts           # The page's controller: its view, and the open hook that re-reads the bundled defaults
          together-page-view.tsx     # The switch rows, the chain cap, and the characters on the desktop
          chain-cap/                 # The cap on characters addressing each other
            chain-cap-row.tsx        # The chain cap row: a NumberField over the bundled default
          characters/                # The page's character list
            characters-section.tsx   # One row per preset with an "On the desktop" switch, main locked on, the open-preset cap
            characters-section.css   # Character row styles
        sections/                    # The page sections the shell mounts, the rows and lines the Connection page and other sections share, and the list helpers
          help/                      # The bundled guides
            help-section.ts          # The guide keys, and the delegated click the composer binds on the Connection page's Help buttons
          key-row/                   # One secret API key row
            key-row.tsx              # Masked input, reveal and clear, sub line, commit on blur, close and dispose; the chat, TTS and STT rows
            reveal-toggle.tsx        # The eye button that shows or masks a key field, which every key field shares
          push-reason/               # Controls the push transport cannot use
            push-reason.tsx          # The reason line under such a control, and the delegated click of its link to the chat protocol select
            push-reason.css          # Reason line styles
        switches/                    # The React switch rows the Voice, Together, Motion and Proactive pages share
          descriptor-row.tsx         # One switch row rendered from its descriptor, with the lock and its reason: the Together, Motion, Voice and Proactive rows
      controls/                      # Shared React controls; the slider, the checkbox, the number field, the segment, the select, the tabs and the tooltip build on Base UI
        tooltip/                     # The Tooltip
          index.ts                   # Re-exports the TooltipHost, the Tip and the host's handle type
          tooltip.tsx                # One tooltip under a TooltipHost: each Tip makes its child a trigger; hover opens after 150 ms, keyboard focus at once, and focus opens it only after a focus-moving key
          tooltip.css                # The tip's surface, its layer over the panel's popovers, and its fade
        tabs/                        # The Tabs
          index.ts                   # Re-exports the Tabs state hook, root, tab, panel and handle type
          tabs.tsx                   # Tabs on Base UI's Tabs: `yui-tab-<id>` tabs controlling `yui-panel-<id>` panels kept mounted, hidden with the selection, and a handle that selects or focuses a tab from code
        slider/                      # The Slider
          index.ts                   # Re-exports the Slider and its props type
          slider.tsx                 # A range slider the caller labels and owns the value of, reporting each change and each commit
          slider.css                 # Track, fill, knob, hover and focus styles
        number-field/                # The NumberField
          index.ts                   # Re-exports the NumberField and its props type
          number-field.tsx           # A controlled number field on Base UI's NumberField: the caller labels it and owns the value, committed on blur, Enter or a step
        disclosure/                  # The Disclosure
          index.ts                   # Re-exports the Disclosure and its props type
          disclosure.tsx             # A native details fold with a chevron summary, the caller's label and its rows
        checkbox/                    # The Checkbox
          index.ts                   # Re-exports the Checkbox and its props type
          checkbox.tsx               # A tri-state checkbox drawn as a switch, the caller labels and owns the state of
          checkbox.css               # The mixed state: half the track lit, the knob at the centre
        switch/                      # The Switch
          index.ts                   # Re-exports the Switch and its props type
          switch.tsx                 # A boolean switch the caller labels and owns the state of
          switch.css                 # Switch track, knob, focus and disabled styles
        select/                      # The Select
          index.ts                   # Re-exports the Select and its props type
          select.tsx                 # A select on Base UI's Select the caller labels and owns the value of, with a shorter closed name where given
          select.css                 # The trigger without OS chrome, and the popup and its items over the settings content
        segment/                     # The Segment
          index.ts                   # Re-exports the Segment, its options and props
          segment.tsx                # A radio segment the caller labels and owns the value of
          segment.css                # Segment cell, checked, focus and disabled styles
      ref-mount/                     # The host a React view gives a vanilla piece
        index.ts                     # Re-exports RefMount and its props type
        ref-mount.tsx                # Mounts the piece after the commit, again on new deps, and cleans it up
      keyed-rows/                    # Keyed list rows
        keyed-rows.ts                # Keeps a list's row elements by key across snapshots, hands a removed row's focus to its neighbour, and syncs a row in place
      theme/                         # The window theme
        apply-theme.ts               # Resolves system through OS appearance and follows the store and the OS
      i18n/                          # Locale catalogs
        en.ts                        # English strings, the source of truth for the key set
        ja.ts                        # Japanese strings
        ko.ts                        # Korean strings
      devtools/                      # Developer Tools window, one React root
        shell.ts                     # Facade: mounts the root, selects a section, disposes
        devtools-window.tsx          # Header, section tabs and their panels, redrawn in a new language
        context-inspector.tsx        # Client-context inspector view
        advanced-settings.tsx        # Advanced settings view
        motion-preview/              # Motion and emotion preview; its core is lazy-loaded
          motion-load.ts             # The Motion panel's load attempts: pending, loaded, failed, and dispose
          motion-panel.tsx           # The Motion panel: the viewport host, the rail, and the status bar
          motion-preview.ts          # Lazy core: loads the registries and the VRM into a renderer in the panel's host
          variants.ts                # Pooled-variant expansion into playable entries
          preview-row.tsx            # A motion or emotion row button
          registry-list.tsx          # Motion rows by kind and idle's variant line
          rail-row.tsx               # The rail's section header, a row, and its slider row
          playback-controls.tsx      # Loop, speed, fade, crossfade, and the play, stop, and idle buttons
          emotion-panel.tsx          # Emotion rows, sliders, and the neutral and hold buttons
          live-status.ts             # Per-frame status text, fps, and elapsed time; reports each clip change
          perch-hook.ts              # Dev-only perch globals for the console
          motion-preview.css         # Motion-preview styles
        devtools.css                 # Developer Tools shell styles
  src-tauri/
    tauri.conf.json                  # Transparent always-on-top pet window
    capabilities/                    # Per-window permissions; desktop.json holds the desktop-only plugin permissions
      app-commands.json              # Every app command outside the MCP host, for every window
      plugin-host-call.json          # main and pet-*: the MCP host snapshot, plugin tool calls and their cancel, and skill reads
      plugin-host-manage.json        # settings and settings-*: the MCP host snapshot, the catalog, install and update, remove, add from folder, enable, disable, retry, the log tail, and opening the log folder
    fixtures/mcp-test-plugin/        # Stdlib-only Python MCP server plugin the MCP host tests run
    src/                             # Rust shell
      main.rs                        # Binary entry that calls into lib.rs
      lib.rs                         # Module declarations and run(), which chains plugins, setup, commands, and the window-destroyed and exit hooks
      plugins.rs                     # Plugin registration
      setup.rs                       # Startup work: log sink, turn-record log, import sweep, MCP host, OS watcher, tray
      commands.rs                    # IPC command table
      process_state.rs               # Process facts the webview reads: app_started_at, the epoch ms setup records once
      app_log.rs                     # Log plugin sink, timezone, line format, and log directory
      drag.rs                        # OS-native window drag with multi-monitor and DPI correction
      window_frame.rs                # Lifts AppKit frame constraining and applies logical window frames
      threads_window.rs              # The Threads window's native window number, and threads_order_front: an order-front that takes no focus
      window_dock.rs                 # A pet window's native child link into its own settings window (macOS), unlinked on that window's close or miniaturize and the tray's hide
      passthrough.rs                 # Click-through toggle over the transparent overlay
      screenshot.rs                  # Screen-source enumeration, off-thread display capture, and the Screen Recording permission preflight
      image_encode.rs                # Long-edge resize and JPEG data-URL encode used by screenshot.rs
      mcp_host/                      # The MCP host: runs local plugins' MCP servers as YUI-hosted servers
        mod.rs                       # The host's behaviour, its setup, and the window and run event hooks
        commands.rs                  # The plugin_host_* commands, each forwarding to Host; the folder picker and opening the log folder work in the shell
        catalog.rs                   # The plugin catalog: this platform's entries, the release to install, and its checksum
        install.rs                   # Catalog install, update, and remove: download, sha256, unpack, switch, and the folders removed
        host.rs                      # Host: the listed plugins, the stored state, snapshot publishing, and add, enable, disable, retry, calls, skills
        lifecycle.rs                 # Server starts and stops: epoch-tagged tickets, start results, exits, and stops that cancel calls first
        manifest.rs                  # Reads a plugin folder: plugin.json, .mcp.json servers in file order, and skills/*/SKILL.md
        launch.rs                    # A server's command: placeholder expansion, no shell
        server.rs                    # One server: spawn, connect under the deadline, stderr log and tail, exit watch, and tree stop
        tree.rs                      # One server's process tree: a process group on Unix, a job object on Windows; start and kill
        orphans.rs                   # The process groups of running servers in groups.json, and the next start's kill of groups a killed app left behind
        calls.rs                     # In-flight tool calls per window and server: preset _meta, deadline, and cancel
        store.rs                     # state.json load and save through a temp file and rename
        snapshot.rs                  # Snapshot types, a plugin's entry, and the name conflict rule
        test_support.rs              # Test helpers: the fixture plugin, temp folders, polling
      agent_ingress/
        mod.rs                       # Route wiring for signals, avatar RPC, and Threads, with application callbacks
        server.rs                    # Bounded HTTP/1 transport: bind, accept, deadlines, and connection cap
        payload.rs                   # Request parsing, size caps, and event payload types
        guard.rs                     # Host and Origin guard: refuses browser requests whose hostname was rebound to loopback
        route.rs                     # Path parsing into a route family and a target window: bare paths to main, /presets/<id>/ to pet-<id>
        avatar_rpc.rs                # Avatar RPC bridge between HTTP requests and the webview
      turn_log.rs                    # Appends one opaque JSON line per turn record
      log_rotation.rs                # Calendar-date log rotation with a retention window
      import_fs.rs                   # Shared import filesystem helpers: sanitize, hash, dest stem candidates, bounded streamed copy, signature sniff
      vrm_import.rs                  # Native copy of a user-picked .vrm into app data
      voice_import.rs                # Native copy of a user-picked reference clip into app data
      card_import.rs                 # Card file import (JSON, a PNG's tEXt card JSON, or a preset file), the thumbnail copy, and the preset photo pick (a PNG or a JPEG fitted and re-encoded)
      preset_file/
        mod.rs                       # Preset file (.yui) read and write, the VRM inspection, and the PNG card export commands
        manifest.rs                  # The preset file's manifest and its validation
        vrm_license.rs               # The redistribution rule a VRM states in its GLB JSON chunk
        png_card.rs                  # Writes the card JSON into a PNG as one chara tEXt chunk
      tray.rs                        # System tray menu and its show and hide actions
      os_event_watcher/
        mod.rs                       # OS polling loop that emits os_event to the webview, and list_windows, which keeps the Threads window flagged
        witness.rs                   # Transition-only log of frontmost app and idle state
        drop_release.rs              # Drop-release probe that emits window_drop_release with the dragged window's label
        pure_helpers.rs              # Idle conversion, frontmost-window pick, and the listed windows' keep rule for the Threads window
        macos.rs                     # macOS idle, window enumeration, and camera polling
        windows.rs                   # Windows idle, foreground window, and window enumeration polling
  fixtures/                          # JSON case tables the TS and Rust sanitizer tests both read
  plugins/                           # Plugins, independent of the app runtime: Rust crates (own `plugins-rust` CI job)
    README.md                        # The official plugins for readers, with the browser demo
    catalog.json                     # The official and community plugins; the plugin release workflow opens a PR that writes the official entries
    browser/                         # ego lite browser MCP server: one `browser` tool, a task space per preset
      src/
        main.rs                      # Sweeps stale screenshot folders, then serves the MCP server on stdio
        server.rs                    # MCP server: tool list, argument checks, and the preset's task space
        tool.rs                      # The `browser` tool's name, description, input schema, and `_meta`
        result.rs                    # A run's result: status line, untrusted line, output cut at 64 KiB, screenshot notes and images
        relay.rs                     # Runs a script through the `ego-browser` CLI under a per-space lock, and reads its guide
        script.rs                    # The prelude wrapped around the caller's code: deadline, task space, `screenshot` helper
        shots.rs                     # Per-call screenshot folder: collect the last screenshots, remove, sweep stale folders
        locate.rs                    # Finds the installed `ego-browser` CLI
        image_encode.rs              # Screenshot resize and base64 JPEG encode
    herdr/                           # herdr MCP server: four pane tools and a watcher that signals agent done/blocked (unix)
      src/
        main.rs                      # Serves the MCP server on stdio, removes the socket directory at exit
        server.rs                    # MCP server: tool dispatch and the watcher start with the peer's notifier
        tools.rs                     # The four tools' definitions, argument checks, and CLI calls
        cli.rs                       # One herdr CLI call under a 15 s timeout
        locate.rs                    # Finds the installed `herdr` CLI and `ssh`
        watch/
          mod.rs                     # One watch task per server; the private socket directory
          machines.rs                # Which herdr servers to watch: local and enabled saved machines
          forward.rs                 # ssh -N -L forwards to remote herdr sockets
          subscribe.rs               # Per-server event loop: topology, status rebuild, reconcile
          signal.rs                  # A state change's signal group params
  coding-agents/                     # Coding-agent plugins Claude Code and Codex install from the `yui` marketplace
    README.md                        # The coding-agent plugins for readers, their install commands, and the coding-agent Threads
    yui-dev/                         # Skills for a coding agent that extends YUI: `skills/yui-plugin` (BUILD.md, CONTRIBUTE.md) and `skills/yui-wake-character`
    yui-notify/                      # Coding-agent Threads plugin installed from the `yui` marketplace: Claude Code and Codex hooks and `skills/setup`
  integrations/                      # Agent-specific adapters, independent of the YUI app runtime
    hermes/
      README.md                      # Hermes Agent adapter setup (Responses mode, dev proxy, auth)
      desire/                        # Agent desire middleware, state helpers, monitor, and prompts (Python/uv)
      platform/                      # Hermes gateway push-transport plugin: one WebSocket carrying turns in and finished replies out (Python/uv)
        yui/src/tools/               # The client-declared tools: registration from hello.tools and tools frames, the blocking handler, and the per-chat pending calls
    openclaw/
      README.md                      # OpenClaw integration: protocol, what works, security and cost
      skills/yui-openclaw-setup/     # Step-by-step gateway and YUI connection setup with a check per step, and a symptom table
  skills/                            # Skill folders for the character's backend agent, copied into the agent's skill folder or fetched by raw URL
    README.md                        # The skills for readers: what each one teaches and how an agent takes it
    thread-producer/                 # Backend-agnostic skill: a producer posts outside conversations (PRs, mail, chat) as view-only Threads, and the backend acts in the source when the user asks
    yui-daily-briefing/              # Backend-agnostic skill: scheduled producers write dated markdown briefings (scripts/briefing.py) that the backend agent speaks on first activity
  mocks/                             # Standalone HTML mocks, one folder per screen; they link src/ui stylesheets by relative path (README.md)
  docs/                              # Design source of truth
    agent-guide/architecture/        # Architecture map of the client
      map.js                         # Modules, their parts, exchanges, and flows of src/ and src-tauri/src
      index.html                     # Viewer that draws a map data file when opened from disk
```
