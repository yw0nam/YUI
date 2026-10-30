# YUI Logging Convention

This page is the logging convention for the client, covering all TypeScript in `src/` and all Rust in `src-tauri/src/`, with a table of namespaces, events, fields and levels for each area. Read it when you add a log line, or when you need to know which module wrote one and at which level.

::: warning
The message is an event name such as `backend_call`. Fields carry the detail.
:::

## Principles

- Every log line goes through the project logger: `createLogger(namespace)` from `src/logger.ts` in TypeScript, the `log` crate macros (`log::info!`, etc.) in Rust. Raw `console.*`, `println!`, and `eprintln!` are forbidden.
- The message is a stable event name: `snake_case`, no spaces, present-tense identifier (e.g. `backend_call`, `vrm_loaded`, `state_change`). `pnpm logger:check` (CI) refuses any other shape.
- Context is a single structured object of named fields, not interpolated prose, and errors are carried as `error: String(err)` (TypeScript).
- Messages and field values use English; a free-text sentence never takes the message position, because the fields carry the detail.
- Failure variants use a dotted sub-event name (e.g. `tier1.render_error`, `backend_call.unexpected_error`).

## Namespaces

Namespaces are `kebab-case` and flat, with one logger per module, and each namespace matches its module's file name.

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

`dispatcher/dispatcher.ts` (namespace `dispatcher`) logs a `drop` line for every trigger it
holds back or supersedes before its backend call, and for every backend call that failed.
Fields: `event_name`, `reason`, `seq_id`. The level comes from the reason:

| `reason` | Level | When |
|---|---|---|
| `guardrail_drop` | `info` | The debounce/cooldown/rate-limit gate refused the fire. |
| `not_configured` | `warn` | The backend call failed: no endpoint is configured. |
| `parse_error` | `warn` | The backend call failed: the reply could not be parsed. |
| `network_drop` | `warn` | The backend call failed on the network. |
| `network_stall` | `warn` | The backend call stalled past its deadline. |
| `http_4xx_drop` | `error` | The backend answered the call with an HTTP 4xx. |
| `superseded_by_user` | `info` | The user typed or spoke, so the turn was aborted or dropped. |
| `stale_pending` | `info` | A second deferred turn arrived, so the older one is dropped. |
| `degraded_drop` | `warn` | A non-user turn reached the gate during the degraded state. |
| `global_gap` | `info` | The global proactive gap held the fire back. |
| `addressed_cap` | `info` | The third addressed turn in a row without a user turn; the cap is `rate_limit.addressed_chain_max`. |

`recentDrops(n)` returns the last n records.

### Hook failure

`dispatcher/dispatcher.ts` (namespace `dispatcher`) also logs `turn_hook_failed` at `warn`, with
the field `error`, when an `onTurnClosed` subscriber throws: the turn summary was already logged
and the pump goes on.

## Relation events

`io/chat/tools/relation.ts` (namespace `relation`), `io/bridge/inbox/relations-rpc.ts` (namespace `relations-rpc`), the Body page's Relations section and the Together page's Relations switch (namespace `quick-controls`, in the settings window) log at `info`.

| Event | Fields | When |
|---|---|---|
| `relation_rated` | `target`, `delta`, `band`, `clamped` | A `rate_relation` call reached the store. `target` is `user` or a preset id, `delta` the change applied after the daily cap and the range, `band` the band after it. |
| `relations_replaced` | `targets` | An ingress `PUT /relations` replaced the window's store; `targets` lists its keys. |
| `relation_set` | `target`, `value`, `band` | The user released a Relations slider at a value other than the stored one. `value` is the slider's value, `band` the band the store holds after the set. |
| `relations_toggle` | `enabled` | The user flipped the Relations switch. |

## Addressed events

`io/chat/tools/address-character.ts` (namespace `address-character`),
`dispatcher/sources/addressed/addressed-producer.ts` (namespace `addressed-producer`), and
`dispatcher/sources/addressed/addressed-source.ts` (namespace `addressed-source`) log at
`info`.

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
| `routed-user-source` | `fire` | `mention` | The routed source submitted a user turn for a message the unified chat window sent to this preset. `mention` is `character`, `everyone` or `none`. |

## Unified chat window

These modules log at `info` unless a row says otherwise:

- `ui/unified/unified-view.ts` (namespace `unified-view`)
- `app/turn/voice/unified-voice.ts` (namespace `unified-voice`)
- `app/unified/wire-unified-close.ts` (namespace `wire-unified-close`)
- `ui/unified/sequence.ts` (namespace `sequence`)
- `io/window/openers/unified-window.ts` (namespace `unified-window`)
- The Together page's switch row and Characters list (namespace `quick-controls`, in the settings window)
- The quick card's Unified chat tile (namespace `quick-card`, in the quick-card window)

### Sending, speech and stop

| Namespace | Event | Fields | When |
|---|---|---|---|
| `unified-view` | `route` | `targets`, `mention`, `via` | The window sent a message. `targets` is how many presets it goes to, `mention` is `character`, `everyone` or `none`, `via` is `text` or `voice`. |
| `unified-view` | `stop` | none | The user pressed stop: the window dropped its sends and lines and asked every pet window to stop. |
| `unified-voice` | `barge_in_all` | none | The user started speaking, with barge-in on, while the unified chat window shows: main told that window speech started. |
| `unified-voice` | `segment_to_unified` | none | Main sent a recognized segment to the unified chat window. |
| `sequence` | `sequence_timeout` | `preset` | A preset gave no done signal for the current send in 60 seconds, so the sequence moved on. |

### Window lifecycle

| Namespace | Event | Fields | When |
|---|---|---|---|
| `unified-window` | `unified_window_create_error` | `error` | The window could not be created (`error` level). |
| `unified-window` | `unified_window_open_failed` | `error` | Showing or creating the window threw (`warn` level). |
| `unified-window` | `unified_window_close_failed` | `error` | Destroying the window threw (`warn` level). |

### Switches and characters

| Namespace | Event | Fields | When |
|---|---|---|---|
| `quick-controls`, `quick-card` | `unified_chat_toggle` | `enabled` | The user flipped the Unified chat switch or tile. |
| `wire-unified-close` | `unified_chat_toggle` | `enabled`, `via` | The unified chat window closed itself (its ×) and turned the switch off; `enabled` is `false`, `via` is `close`. |
| `quick-controls` | `character_desktop_toggle` | `preset`, `on` | A flip of a character's On the desktop switch took effect; `on` is the new state. A turn-on the open-preset cap refused logs nothing. |

### Photos

| Namespace | Event | Fields | When |
|---|---|---|---|
| `quick-controls` | `photo_crop_saved` | `preset` | The photo dialog's Use photo stored the preset's crop. |
| `quick-controls` | `photo_default_framed` | `preset` | A picked photo's default framing was stored once its size was measured. |

## Companion column windows

`io/window/geometry/companion-column.ts` (namespace `companion-column`) logs at `warn`. `window` is `message` or `unified`.

| Namespace | Event | Fields | When |
|---|---|---|---|
| `companion-column` | `focus_failed` | `window`, `error` | Taking OS focus threw. |
| `companion-column` | `drag_failed` | `window`, `error` | Starting the OS drag threw. |
| `companion-column` | `resize_failed` | `window`, `error` | Setting the window's height to its column threw. |

## Quick-card window

`io/window/openers/quick-card-window.ts` (namespace `quick-card-window`, in the pet window) creates the window through `io/window/openers/ready-window.ts` (namespace `ready-window`). The modules below run in the quick-card window. All modules in this section, `quick-card-window` and `ready-window` included, log at `info` unless a row says otherwise.

- `windows/quick-card-main.ts` (namespace `quick-card-main`) boots it.
- `app/quick-card-window/wire-quick-card-window.ts` (namespace `wire-quick-card-window`) wires its settings side.
- `ui/quick-card/` (namespace `quick-card`) is the card.
- `app/quick-card-window/quick-card-ports.ts` (namespace `quick-card-ports`) writes its stores.
- `app/quick-card-window/quick-card-dock.ts` (namespace `quick-card-dock`) puts the card on `io/window/dock/window-dock.ts` (namespace `window-dock`, shared with the Threads window, its rows naming the window by `label`), which places and moves the window.
- `app/quick-card-window/quick-card-close.ts` (namespace `quick-card-close`) closes it.

The card's Voice, Keep bubble and Unified chat tiles log the toggle events of their settings rows under `quick-card`.

### Window creation and boot

| Namespace | Event | Fields | When |
|---|---|---|---|
| `ready-window` | `window_destroy_timeout` | `label` | A leftover card or Threads window did not report destroyed within 500ms; the new one is created anyway (`warn` level). |
| `quick-card-window` | `quick_card_window_create_error` | `error` | The card window could not be created (`error` level). |
| `ready-window` | `window_open_failed` | `label`, `error` | Creating or reusing the card or Threads window threw (`error` level). |
| `quick-card-main` | `boot_failed` | `error` | The window's boot threw (`error` level). |
| `wire-quick-card-window` | `config_load_failed` | `error` | The bundled config did not load; the card runs on the stored settings (`warn` level). |
| `wire-quick-card-window` | `avatar_config_read_failed` | `fallback`, `error` | The config's VRM list could not be read; the VRM selection keeps its built-in default (`warn` level). |

### Card tiles and stores

| Namespace | Event | Fields | When |
|---|---|---|---|
| `quick-card` | `select_failed` | `error` | Applying a Body or Reference voice choice threw (`warn` level). |
| `quick-card-ports` | `session_reset` | none | Reset conversation started a new session. |

### Docking

| Namespace | Event | Fields | When |
|---|---|---|---|
| `window-dock` | `dock_detached` | `label` | The first move of a docked window after a head pointerdown detached it. |
| `window-dock` | `dock_drag_failed` | `label`, `error` | Unlinking the window or the `drag_window` command for a head drag failed (`warn` level). |
| `window-dock` | `dock_step_failed` | `label`, `error` | A placement, follow or drop step threw (`warn` level). |
| `quick-card-dock` | `quick_card_boot_hide_failed` | `error` | Unlinking or hiding the window at boot threw; the ready report still goes out (`warn` level). |

### Closing

| Namespace | Event | Fields | When |
|---|---|---|---|
| `quick-card-close` | `quick_card_focus_lost` | none | A poll tick found no YUI window holding focus, so the card closed. |
| `quick-card-close` | `quick_card_focus_listen_failed` | `error` | Listening to the window's focus failed, so the focus poll never starts (`warn` level). |
| `quick-card-close` | `quick_card_hide_failed` | `error` | Hiding the card window threw (`warn` level). |
| `quick-card-close` | `quick_card_focus_poll_failed` | `error` | A focus poll tick threw (`debug` level). |

## Threads window

`io/window/openers/threads-window.ts` (namespace `threads-window`, in main's pet window) creates the Threads window through `ready-window`. `io/threads/threads-client.ts` (namespace `threads-client`) runs in both windows. The rest runs in the Threads window: `windows/threads-main.ts` boots it, `app/threads-window/wire-threads-window.ts` wires it, `app/threads-window/threads-presence.ts` opens and closes it, and `app/threads-window/threads-dock.ts` docks it on `io/window/dock/window-dock.ts` (namespace `window-dock`, rows under the quick card's Docking).

| Namespace | Event | Fields | When |
|---|---|---|---|
| `threads-window` | `threads_window_create_error` | `error` | The Threads window could not be created (`error` level). |
| `threads-window` | `threads_window_open_failed` | `error` | Reading the chip's screen position threw; the chip shows again (`error` level). |
| `threads-client` | `snapshot.invoke_failed` | `error` | `threads_snapshot` rejected (`warn` level). |
| `threads-client` | `snapshot.listen_failed` | `error` | Listening to `threads-snapshot` failed; the snapshot is still read once (`warn` level). |
| `threads-main` | `boot_failed` | `error` | The window's boot threw (`error` level). |
| `wire-threads-window` | `threads_boot_hide_failed` | `error` | Unlinking or hiding the window at boot threw; the ready report still goes out (`warn` level). |
| `threads-presence` | `threads_open_failed` | `error` | Placing, showing or growing the window threw; it hides and main's chip shows again (`error` level). |
| `threads-presence` | `threads_hide_failed` | `error` | Hiding the window threw (`warn` level). |

## TypeScript Usage

```ts
import { createLogger } from "../logger";
const log = createLogger("motion-controller");

log.info("state_change", { from, to });
log.error("start_motion", { id, error: String(err) });
log.warn("mouth_expression_missing", { key });
```

The second argument is a plain object of named fields, so do not interpolate values into the message string.

## Rust Usage

The `log` crate is format-string based (no kv feature enabled), so the message leads with the `snake_case` event name and context follows as `field=value` pairs in the format string.

```rust
log::warn!("start_dragging_failed error={e}");
log::error!("screen_capture_failed monitor={index} error={e}");
```

Level semantics are identical to TypeScript.

::: tip
The Rust logger has no kv feature. Pass context as `field=value` pairs inside the format string.
:::

## `console.*` Gate

Raw `console.*` is forbidden in `src/`, and a Biome `noConsole` lint rule enforces it, with exemptions for `src/logger.ts`, `scripts/**`, and `src/**/*.live.test.ts`. The `lint` CI job (`pnpm lint`) fails any other violation.
