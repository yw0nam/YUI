# YUI Logging Convention

Applies to all TypeScript in `src/` and all Rust in `src-tauri/src/`.

## Principles

- Every log line goes through the project logger. TypeScript: `createLogger(namespace)` from `src/logger.ts`. Rust: `log` crate macros (`log::info!`, etc.). Raw `console.*`, `println!`, and `eprintln!` are forbidden.
- The message is a stable **event name**: `snake_case`, no spaces, present-tense identifier (e.g. `backend_call`, `vrm_loaded`, `state_change`).
- Context is a single structured object of named fields — not interpolated prose. Errors are carried as `error: String(err)` (TypeScript).
- Messages and field values use English. Free-text sentences do not appear in the message position; fields carry the detail.
- Failure variants use a dotted sub-event name (e.g. `tier1.render_error`, `backend_call.unexpected_error`).

## Namespaces

`kebab-case`, flat, one logger per module. The namespace matches the module's file name.

| File | Namespace |
|---|---|
| `motion-controller.ts` | `"motion-controller"` |
| `tts-pipeline.ts` | `"tts-pipeline"` |
| `dispatcher/backend/backend-caller.ts` | `"backend-caller"` |

## Levels

| Level | When to use | Examples |
|---|---|---|
| `error` | An operation failed in a way that is user-visible or affects state/data | `start_motion`, `backend_call.unexpected_error` |
| `warn` | Recovered or degraded: a fallback was taken, malformed input dropped, an optional path skipped | `mouth_expression_missing`, `rpc_threw` (one per broker outage) |
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

`dispatcher/dispatcher.ts` (namespace `dispatcher`) also logs `turn_hook_failed` at `warn`, with
the field `error`, when an `onTurnClosed` subscriber throws: the turn summary was already logged
and the pump goes on.

## Relation events

`io/chat/tools/relation.ts` (namespace `relation`), `io/bridge/inbox/relations-rpc.ts` (namespace `relations-rpc`), and the Character tab's Relations section (namespace `quick-ui` in the pet window, `settings-ui` in the settings window) log at `info`.

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

`ui/unified/unified-view.ts` (namespace `unified-view`), `ui/unified/sequence.ts` (namespace `sequence`), `io/window/openers/unified-window.ts` (namespace `unified-window`), and the Talk tab's switch row (namespace `quick-ui` in the pet window, `settings-ui` in the settings window) log at `info` unless a row says otherwise.

| Namespace | Event | Fields | When |
|---|---|---|---|
| `unified-view` | `route` | `targets`, `mention` | The window sent a message. `targets` is how many presets it goes to, `mention` is `character`, `everyone` or `none`. |
| `sequence` | `sequence_timeout` | `preset` | A preset gave no done signal for the current send in 60 seconds, so the sequence moved on. |
| `unified-window` | `unified_window_create_error` | `error` | The window could not be created (`error` level). |
| `unified-window` | `unified_window_open_failed` | `error` | Showing or creating the window threw (`warn` level). |
| `unified-window` | `unified_window_close_failed` | `error` | Closing the window threw (`warn` level). |
| `quick-ui`, `settings-ui` | `unified_chat_toggle` | `enabled` | The user flipped the Unified chat switch. |

## TypeScript Usage

```ts
import { createLogger } from "../logger";
const log = createLogger("motion-controller");

log.info("state_change", { from, to });
log.error("start_motion", { id, error: String(err) });
log.warn("mouth_expression_missing", { key });
```

The second argument is a plain object of named fields. Do not interpolate values into the message string.

## Rust Usage

The `log` crate is format-string based (no kv feature enabled). The message leads with the `snake_case` event name; context follows as `field=value` pairs in the format string.

```rust
log::warn!("start_dragging_failed error={e}");
log::error!("screen_capture_failed monitor={index} error={e}");
```

Level semantics are identical to TypeScript.

## `console.*` Gate

Raw `console.*` is forbidden in `src/`. The rule is enforced by a Biome `noConsole` lint rule, with exemptions for `src/logger.ts`, `scripts/**`, and `src/**/*.live.test.ts`. The `lint` CI job (`pnpm lint`) fails any other violation.
