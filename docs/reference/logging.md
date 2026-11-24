# YUI Logging Convention

The logging convention covers all TypeScript in `src/` and all Rust in `src-tauri/src/`. Each area has its own table of namespaces, events, fields, and levels.

Read it when you add a log line, or when you need to know which module wrote one and at which level.

::: warning
The message is an event name such as `backend_call`. Fields carry the detail.
:::

## Principles

- Every log line goes through the project logger: `createLogger(namespace)` from `src/logger.ts` in TypeScript, the `log` crate macros (`log::info!`, etc.) in Rust. Raw `console.*`, `println!`, and `eprintln!` are forbidden.
- The message is a stable event name: `snake_case`, no spaces, present-tense identifier (e.g. `backend_call`, `vrm_loaded`, `state_change`). `pnpm logger:check` (CI) refuses any other shape.
- Context is a single structured object of named fields, not interpolated prose. Errors are carried as `error: String(err)` (TypeScript).
- Messages and field values use English. A free-text sentence never takes the message position, because the fields carry the detail.
- Failure variants use a dotted sub-event name (e.g. `tier1.render_error`, `backend_call.unexpected_error`).

## Namespaces

Namespaces are `kebab-case` and flat, with one logger per module. Each namespace matches its module's file name.

A namespace may differ from its file name only in the file that `KNOWN` in `scripts/ci/logger-namespace.mjs` pairs it with.

| File | Namespace |
|---|---|
| `motion-controller.ts` | `"motion-controller"` |
| `tts-pipeline.ts` | `"tts-pipeline"` |
| `dispatcher/backend/backend-caller.ts` | `"backend-caller"` |

## Levels

| Level | When to use | Examples |
|---|---|---|
| `error` | An operation failed in a way that is user-visible or affects state/data | `start_motion`, `backend_call.unexpected_error` |
| `warn` | Recovered or degraded: a fallback was taken, malformed input dropped, an optional path skipped | `mouth_expression_missing` |
| `info` | State transitions and lifecycle milestones | `vrm_loaded`, `state_change`, `backend_call`, `fire`, `turn` |
| `debug` | High-frequency or per-item detail | per-segment `synth`, per-frame work, poll ticks |

## Turn gate events

`dispatcher/core/turn-gate.ts` logs at `info`.

| Event | Fields | When |
|---|---|---|
| `turn_hold` | none | Another window holds the turn lock, so this window waits. |
| `turn_granted` | `waited_ms` | The waiting window received the lock after that many milliseconds. |

## Drop events

`dispatcher/dispatcher.ts` (namespace `dispatcher`) logs a `drop` line for every trigger it holds back or supersedes before its backend call. It also logs one for every backend call that failed. Fields: `event_name`, `reason`, `seq_id`.

The level comes from the reason:

| `reason` | Level | When |
|---|---|---|
| `guardrail_drop` | `info` | The debounce/rate-limit gate refused the fire. |
| `not_configured` | `warn` | The backend call failed: no endpoint is configured. |
| `parse_error` | `warn` | The backend call failed: the reply could not be parsed. |
| `network_drop` | `warn` | The backend call failed on the network. |
| `network_stall` | `warn` | The backend call stalled past its deadline. |
| `http_4xx_drop` | `error` | The backend answered the call with an HTTP 4xx. |
| `superseded_by_user` | `info` | The user typed or spoke, so the turn was aborted or dropped. |
| `stale_pending` | `info` | A second deferred turn arrived, so the older one is dropped. |
| `degraded_drop` | `warn` | A non-user turn reached the gate during the degraded state. |
| `global_gap` | `info` | The proactive gap held the fire back. |
| `addressed_cap` | `info` | The third addressed turn in a row without a user turn; the cap is `rate_limit.addressed_chain_max`. |
| `dnd` | `info` | Do-not-disturb held the trigger: a self-fired one, one still queued when it turned on, or a fire waiting for the turn lock. |

`recentDrops(n)` returns the last n records.

### Hook failure

`dispatcher/dispatcher.ts` (namespace `dispatcher`) also logs `turn_hook_failed` at `warn`, with the field `error`. It does so when an `onTurnClosed` subscriber throws. The turn summary is logged before the hook runs, and the pump goes on.

## Relation events

`io/chat/tools/relation.ts` (namespace `relation`), `io/bridge/inbox/relations-rpc.ts` (namespace `relations-rpc`), the Body page's Relations section and the Together page's Relations switch (namespace `quick-controls`, in the settings window) log at `info`.

| Event | Fields | When |
|---|---|---|
| `relation_rated` | `target`, `delta`, `band`, `clamped` | A `rate_relation` call reached the store. See the field notes below. |
| `relations_replaced` | `targets` | An ingress `PUT /relations` replaced the window's store; `targets` lists its keys. |
| `relation_set` | `target`, `value`, `band` | The user released a Relations slider at a value other than the stored one. See the field notes below. |
| `relations_toggle` | `enabled` | The user flipped the Relations switch. |

Field notes for `relation_rated`:

- `target` is `user` or a preset id.
- `delta` is the change applied after the daily cap and the range.
- `band` is the band after it.

Field notes for `relation_set`:

- `value` is the slider's value.
- `band` is the band the store holds after the set.

## Addressed events

`io/chat/tools/address-character.ts` (namespace `address-character`), `dispatcher/sources/addressed/addressed-producer.ts` (namespace `addressed-producer`), and `dispatcher/sources/addressed/addressed-source.ts` (namespace `addressed-source`) log at `info`.

| Namespace | Event | Fields | When |
|---|---|---|---|
| `address-character` | `character_addressed` | `to` | An `address_character` call recorded the reply's recipient. `to` is the named preset id. |
| `addressed-producer` | `fire` | `to` | The producer emitted the character-addressed event for a closed, spoken reply. |
| `addressed-producer` | `no_text` | `to` | The closed addressed turn left no transcript entry to carry. |
| `addressed-source` | `fire` | `from` | The addressed source pushed an `addressed.character` candidate for this preset. |
| `addressed-source` | `push_rejected` | `from` | The bus refused the addressed candidate. |

## Routed user turns

`dispatcher/sources/routed/routed-user-source.ts` (namespace `routed-user-source`) logs at `info`. The done signal logs nothing.

| Namespace | Event | Fields | When |
|---|---|---|---|
| `routed-user-source` | `fire` | `mention` | The routed source submitted a user turn for a message the unified chat window sent to this preset. |

`mention` is `character`, `everyone` or `none`.

## Unified chat window

These modules log at `info` unless a row says otherwise:

- `ui/unified/unified-view.ts` (namespace `unified-view`)
- `app/turn/voice/unified-voice.ts` (namespace `unified-voice`)
- `app/unified/wire-unified-close.ts` (namespace `wire-unified-close`)
- `ui/unified/sequence.ts` (namespace `sequence`)
- `io/window/openers/unified-window.ts` (namespace `unified-window`)
- The Together page's switch row and Characters list (namespace `quick-controls`, in the settings window)
- The Character menu's Unified chat item (namespace `character-menu-ports`, in the pet window)

### Sending, speech and stop

| Namespace | Event | Fields | When |
|---|---|---|---|
| `unified-view` | `route` | `targets`, `mention`, `via` | The window sent a message. See the field notes below. |
| `unified-view` | `stop` | none | The user pressed stop: the window dropped its sends and lines and asked every pet window to stop. |
| `unified-voice` | `barge_in_all` | none | The user started speaking, with barge-in on, while the unified chat window shows: main told that window speech started. |
| `unified-voice` | `segment_to_unified` | none | Main sent a recognized segment to the unified chat window. |
| `sequence` | `sequence_timeout` | `preset` | A preset gave no done signal for the current send in 60 seconds, so the sequence moved on. |

Field notes for `route`:

- `targets` is how many presets the message goes to.
- `mention` is `character`, `everyone` or `none`.
- `via` is `text` or `voice`.

### Window lifecycle

| Namespace | Event | Fields | When |
|---|---|---|---|
| `unified-window` | `unified_window_create_error` | `error` | The window could not be created (`error` level). |
| `unified-window` | `unified_window_open_failed` | `error` | Showing or creating the window threw (`warn` level). |
| `unified-window` | `unified_window_close_failed` | `error` | Destroying the window threw (`warn` level). |

### Switches and characters

| Namespace | Event | Fields | When |
|---|---|---|---|
| `quick-controls`, `character-menu-ports` | `unified_chat_toggle` | `enabled` | The user flipped the Unified chat switch or menu item. |
| `character-menu-ports`, `bootstrap` | `dnd_toggle` | `enabled`, `via` | The user flipped the Do not disturb switch on the Character menu's Rest item (`via` is `character_menu`) or the tray's Do Not Disturb item (`via` is `tray`). |
| `character-menu-ports` | `bubble_persist_toggle` | `enabled` | The user flipped the Keep bubble item. |
| `wire-unified-close` | `unified_chat_toggle` | `enabled`, `via` | The unified chat window closed itself (its ×) and turned the switch off; `enabled` is `false`, `via` is `close`. |
| `quick-controls` | `character_desktop_toggle` | `preset`, `on` | A flip of a character's On the desktop switch took effect; `on` is the new state. |

A `character_desktop_toggle` turn-on that the open-preset cap refused logs nothing.

### Photos

| Namespace | Event | Fields | When |
|---|---|---|---|
| `quick-controls` | `photo_crop_saved` | `preset` | The photo dialog's Use photo stored the preset's crop. |
| `quick-controls` | `photo_default_framed` | `preset` | A picked photo's default framing is stored once its size is measured. |

## Companion column windows

`io/window/geometry/companion-column.ts` (namespace `companion-column`) logs at `warn`. `window` is `message` or `unified`.

| Namespace | Event | Fields | When |
|---|---|---|---|
| `companion-column` | `focus_failed` | `window`, `error` | Taking OS focus threw. |
| `companion-column` | `drag_failed` | `window`, `error` | Starting the OS drag threw. |
| `companion-column` | `resize_failed` | `window`, `error` | Setting the window's height to its column threw. |

## Character menu

`app/character-menu/character-menu-ports.ts` (namespace `character-menu-ports`) writes the stores the menu's items act on, and `app/character-menu/character-menu-frame.ts` (namespace `character-menu-frame`) widens and restores the pet window around it. `app/character-menu/wire-character-menu.ts` (namespace `wire-character-menu`) opens the menu on a right-click, and `ui/character-menu/character-menu.ts` (namespace `character-menu`) closes it. All four run in the pet window and log at `info` unless a row says otherwise.

### Menu actions

| Namespace | Event | Fields | When |
|---|---|---|---|
| `character-menu-ports` | `select_failed` | `error` | Applying a Body or Voice choice threw (`warn` level). |
| `character-menu-ports` | `session_reset` | none | Reset chat started a new session. |

The Rest, Keep bubble and Unified chat items log `dnd_toggle`, `bubble_persist_toggle` and `unified_chat_toggle` under `character-menu-ports`; "Switches and characters" lists them.

### Widening

| Namespace | Event | Fields | When |
|---|---|---|---|
| `character-menu-frame` | `widen_skipped` | `error` | The widen threw (outside the app there is no frame to set), so the menu opens in the window as it is. |
| `character-menu-frame` | `focus_failed` | `error` | Taking OS focus threw (`warn` level). |
| `character-menu-frame` | `abort_travel_failed` | `error` | Waiting for a cancelled travel to unpark threw (`warn` level). |
| `wire-character-menu` | `open_failed` | `error` | Opening the menu threw; she is released, the window is restored and the menu stays closed (`warn` level). |
| `character-menu` | `restore_failed` | `error` | Restoring the window on close threw; the menu still closes and a closing pick still runs (`warn` level). |

## Threads window

`io/window/openers/threads-window.ts` (namespace `threads-window`, in main's pet window) creates the Threads window through `ready-window`. `io/threads/threads-client.ts` runs in both windows and reads its snapshots through `io/snapshot-feed/`, which logs as namespace `snapshot-feed`.

The rest runs in the Threads window. `windows/threads-main.ts` boots it, `app/threads-window/wire-threads-window.ts` wires it, `app/threads-window/threads-presence.ts` opens and closes it, and `app/threads-window/threads-placement.ts` places and drags it and saves its frame.

| Namespace | Event | Fields | When |
|---|---|---|---|
| `threads-window` | `threads_window_create_error` | `error` | The Threads window could not be created (`error` level). |
| `threads-window` | `threads_window_open_failed` | `error` | Reading the chip's screen position threw; the chip leaves its open state unless the window is open (`error` level). |
| `ready-window` | `window_destroy_timeout` | `label` | A leftover Threads window did not report destroyed within 500ms; the new one is created anyway (`warn` level). |
| `ready-window` | `window_open_failed` | `label`, `error` | Creating or reusing the Threads window threw (`error` level). |
| `snapshot-feed` | `snapshot.invoke_failed` | `command`, `error` | `threads_snapshot` rejected (`warn` level). |
| `snapshot-feed` | `snapshot.listen_failed` | `event`, `error` | Listening to `threads-snapshot` failed; the snapshot is still read once (`warn` level). |
| `threads-main` | `boot_failed` | `error` | The window's boot threw (`error` level). |
| `wire-threads-window` | `threads_boot_hide_failed` | `error` | Hiding the window at boot threw; the ready report still goes out (`warn` level). |
| `wire-threads-window` | `thread_seen_failed` | `error` | `thread_seen` rejected, e.g. the ask closed before the pick reached the store; the chip keeps counting that Thread (`warn` level). |
| `wire-threads-window` | `thread_read_failed` | `error` | `thread_read` rejected, e.g. the Thread expired before the click reached the store; the Thread keeps waiting (`warn` level). |
| `threads-presence` | `threads_open_failed` | `error` | Placing, showing or growing the window threw; it hides and main's chip leaves its open state (`error` level). |
| `threads-presence` | `threads_focus_failed` | `error` | Bringing the shown window forward on a second open threw (`warn` level). |
| `threads-presence` | `threads_hide_failed` | `error` | Hiding the window threw (`warn` level). |
| `threads-presence` | `threads_raise_failed` | `error` | Ordering the shown window front without focus threw (`warn` level). |
| `serial-queue` | `serial_queue_step_failed` | `error` | A window open or close step rejected; the next step still runs (`warn` level). |
| `threads-placement` | `threads_drag_failed` | `error` | The `drag_window` command for a head drag failed (`warn` level). |
| `threads-placement` | `threads_move_listen_failed` | `error` | Listening to the window's moves failed; a move is not saved (`warn` level). |
| `threads-placement` | `threads_move_save_failed` | `error` | Reading the window's position after a move threw; the move is not saved (`warn` level). |
| `threads-resize` | `threads_resize_failed` | `error` | Reading the window's frame or applying a resize step threw; the resize saves only what was applied (`warn` level). |

## Thread reaction events

`ambient/threads-reaction/thread-reaction.ts` (namespace `thread-reaction`, in main's pet window) logs each step of a Thread reaction at `debug` and its failures at `warn`. Every step line carries `cause` — `tap`, `count` or `wait` — and `window`, which is `closed`, `covered` or `open`; a wait also carries `threadId`.

| Namespace | Event | Fields | When |
|---|---|---|---|
| `thread-reaction` | `reaction_start` | `cause`, `threadId?`, `window` | A reaction starts (`debug` level). |
| `thread-reaction` | `reaction_line` | `cause`, `threadId?`, `window` | A filler line starts (`debug` level). |
| `thread-reaction` | `reaction_present` | `cause`, `threadId?`, `window` | The window is asked to open or rise without focus (`debug` level). |
| `thread-reaction` | `reaction_sit` | `cause`, `threadId?`, `window` | The sit command is sent (`debug` level). |
| `thread-reaction` | `reaction_expression` | `cause`, `threadId?`, `window` | The `curious` expression is set (`debug` level). |
| `thread-reaction` | `reaction_sit.failed` | `cause`, `threadId?`, `window`, `result` | The sit command did not return ok, and the reaction is dropped (`warn` level). |
| `thread-reaction` | `reaction_tap.unlisted` | `cause` | The Threads window never got listed under a tap; the tap is dropped after ten tries (`debug` level). |
| `thread-reaction` | `reaction_failed` | `cause`, `threadId?`, `error` | A reaction threw (`warn` level). |

## Come-along

`ambient/come-along/come-along.ts` (namespace `come-along`) and `app/stage/wire-come-along.ts` (namespace `wire-come-along`) log in each pet window. `io/window/pet/window-dock.ts` (namespace `window-dock`) listens for the close. `app/settings-window/wire-stage-rect.ts` (namespace `wire-stage-rect`) logs in each settings window. `src-tauri/src/window_dock.rs` logs the native link, with no namespace.

| Namespace | Event | Fields | When |
|---|---|---|---|
| `come-along` | `come_along_docked` | `native` | She docked on the stage; `native` is whether the shell linked her as a child window (`info` level). |
| `come-along` | `come_along_stayed` | none | A drag or an agent command ran when the settings window showed, so she stays for that session (`info` level). |
| `come-along` | `come_along_taken` | none | A drag or an agent move took her off the stage or her walk (`info` level). |
| `come-along` | `come_along_home` | none | She arrived home after the window minimised or closed (`info` level). |
| `come-along` | `come_along_home_gone` | `spot` | No monitor holds her spot any more, so she walks to the nearest floor (`info` level). |
| `come-along` | `dock_attach_failed` | `error` | `window_dock_attach` rejected; she follows the slot herself and stays above other windows (`warn` level). |
| `come-along` | `dock_detach_failed` | `error` | `window_dock_detach` rejected (`warn` level). |
| `come-along` | `come_along_move_failed` | `error` | A walk step's move threw (`warn` level). |
| `come-along` | `come_along_place_failed` | `error` | Placing her on a new slot threw (`warn` level). |
| `come-along` | `come_along_store_failed` | `error` | Session storage refused her home or opt-out, so a reload forgets it (`warn` level). |
| `wire-come-along` | `come_along_failed` | `error` | A start or a walk home threw; she stays where she is and the next slot starts afresh (`warn` level). |
| `window-dock` | `settings_stage_closed_listen_failed` | `error` | Listening for the settings window's close failed (`warn` level). |
| `wire-stage-rect` | `stage_rect_read_failed` | `error` | Reading the window's position, scale or minimised state threw; no slot is sent (`warn` level). |
| `wire-stage-rect` | `stage_rect_listen_failed` | `error` | Listening to the window's moves or resizes failed (`warn` level). |
| Rust `window_dock.rs` | `window_dock_detach_failed` | `window`, `error` | Unlinking a pet window on its settings window's close failed (`warn` level). |
| Rust `window_dock.rs` | `settings_stage_closed_emit_failed` | `window`, `error` | Sending the close to the pet windows failed (`warn` level). |
| Rust `window_dock.rs` | `window_dock_hide_unlink_failed` | `window`, `error` | Unlinking a docked window before the tray hides it failed (`warn` level). |
| Rust `window_dock.rs` | `window_dock_show_relink_failed` | `window`, `error` | Linking a docked window again after the tray shows it failed (`warn` level). |

## Do-not-disturb tray

`app/dnd/wire-tray-dnd.ts` logs through the `bootstrap` namespace, in main's pet window. `src-tauri/src/tray.rs` logs the tray check's clicks. Rust events carry no namespace.

| Namespace | Event | Fields | When |
|---|---|---|---|
| `bootstrap` | `tray_dnd_set_failed` | `on`, `error` | `set_tray_dnd` rejected, so the tray check may not match the store (`warn` level). |
| `bootstrap` | `tray_dnd_listen_failed` | `error` | Listening to `tray-dnd` failed, so a tray click does not reach the store (`warn` level). |
| Rust `tray.rs` | `tray_dnd_state_missing` | none | The tray's check item is not in managed state, so the click does nothing (`warn` level). |
| Rust `tray.rs` | `tray_dnd_read_failed` | `error` | Reading the check's state after a click failed, so the click does nothing (`warn` level). |
| Rust `tray.rs` | `tray_dnd_emit_failed` | `enabled`, `error` | Sending `tray-dnd` to the main window failed, so the check goes back (`warn` level). |
| Rust `tray.rs` | `tray_dnd_revert_failed` | `error` | Putting the check back threw after a missing main window or a failed emit (`warn` level). |

## TypeScript usage

```ts
import { createLogger } from "../logger";
const log = createLogger("motion-controller");

log.info("state_change", { from, to });
log.error("start_motion", { id, error: String(err) });
log.warn("mouth_expression_missing", { key });
```

The second argument is a plain object of named fields, so do not interpolate values into the message string.

## Rust usage

The `log` crate is format-string based (no kv feature enabled), so the message leads with the `snake_case` event name. Context follows as `field=value` pairs in the format string.

```rust
log::warn!("start_dragging_failed error={e}");
log::error!("screen_capture_failed monitor={index} error={e}");
```

Level semantics are identical to TypeScript.

::: tip
The Rust logger has no kv feature. Pass context as `field=value` pairs inside the format string.
:::

## `console.*` gate

Raw `console.*` is forbidden in `src/`. A Biome `noConsole` lint rule enforces it, with exemptions for `src/logger.ts`, `scripts/**`, and `src/**/*.live.test.ts`.

The `lint` CI job (`pnpm lint`) fails any other violation.
