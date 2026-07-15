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
| `dispatcher/backend-caller.ts` | `"backend-caller"` |

## Levels

| Level | When to use | Examples |
|---|---|---|
| `error` | An operation failed in a way that is user-visible or affects state/data | `start_motion`, `backend_call.unexpected_error` |
| `warn` | Recovered or degraded: a fallback was taken, malformed input dropped, an optional path skipped | `mouth_expression_missing`, broker poll unreachable then retried |
| `info` | State transitions and lifecycle milestones | `vrm_loaded`, `state_change`, `backend_call`, `fire` |
| `debug` | High-frequency or per-item detail | per-segment `synth`, per-frame work, poll ticks |

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
