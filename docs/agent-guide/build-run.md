# YUI — Build, Run & Logs

## Build / Run

```bash
pnpm install
pnpm dev                    # Vite dev server (fixed port 1420) — browser only
pnpm tauri dev              # Tauri app (fixed port 1420, transparent pet window)
pnpm dev:auto               # Vite dev server, browser only — auto-picks a free port from 1420 up (or honors YUI_DEV_PORT)
pnpm tauri:dev              # Tauri app — auto-picks a free port from 1420 up (or honors YUI_DEV_PORT); enables concurrent worktrees
pnpm build                  # tsc + vite build
pnpm test                   # vitest run
pnpm test:watch             # vitest watch
pnpm lint                   # biome check (format + lint)
pnpm lint:fix               # biome check --write (apply safe fixes)
pnpm tauri build            # Native bundle
cd src-tauri && cargo check # Rust compile check
cd src-tauri && cargo test  # Rust unit tests
```

## Dev reload

The dev server always does a full page reload on save, by design. No file under `src/` registers an `import.meta.hot.accept()` boundary, so Vite walks the importer chain looking for one, finds none, and reloads the page. Nothing under `src/` registers an `import.meta.hot.dispose(...)` callback either: with no accept boundary the dispose map is never consulted, so module teardown would be unreachable code. The page reload releases everything instead.

This is deliberate. `src/main.ts` owns the WebGL context, the loaded VRM, Tauri multi-window state, the broker connection, and the OS event watcher. An accept boundary there would need teardown that's an exact inverse of that setup — get it wrong and it leaks silently on every save, which is worse than a full reload.

If an accept boundary is ever introduced, it belongs at a module that can rebuild itself from scratch:

- Expensive state (WebGL context, loaded VRM) is preserved across replacements via `import.meta.hot.data`, not recreated.
- `import.meta.hot.dispose(cb)` stores one callback per module path — repeat calls in the same module overwrite rather than accumulate, so a module with several things to release registers a single callback that drains a collection.
- `dispose` must be the exact inverse of setup — anything registered on objects that outlive the module (`window`, `document`, DOM outside the module) leaks on every update otherwise.
- Guard the blocks with `if (import.meta.hot)` so production builds tree-shake them.

## Logs

Frontend (`src/logger.ts` → `[YUI][namespace] …`) and Rust (`log` crate) lines are written to per-day files `YUI_YYYY-MM-DD.log`, rotated at midnight in the `YUI_LOG_TZ` timezone and retained 14 days (older dated files are pruned on rotation). Dev (`pnpm tauri dev`): `<repo>/logs/` (gitignored) — tail with `tail -f logs/*.log`. Release (macOS): `~/Library/Logs/com.yui.desktop/`. Levels: dev `debug`, release `warn`; override frontend via `VITE_YUI_LOG_LEVEL` (`debug|info|warn|error`).
