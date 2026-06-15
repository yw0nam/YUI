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

## Logs

Frontend (`src/logger.ts` → `[YUI][namespace] …`) and Rust (`log` crate) lines are written to per-day files `YUI_YYYY-MM-DD.log`, rotated at midnight in the `YUI_LOG_TZ` timezone and retained 14 days (older dated files are pruned on rotation). Dev (`pnpm tauri dev`): `<repo>/logs/` (gitignored) — tail with `tail -f logs/*.log`. Release (macOS): `~/Library/Logs/com.yui.desktop/`. Levels: dev `debug`, release `warn`; override frontend via `VITE_YUI_LOG_LEVEL` (`debug|info|warn|error`).
