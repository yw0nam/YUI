# YUI — Harness & Enforcement

Mandatory rules have an enforcement point — the gate, not memory, is the source of truth. Rules without one are working style, applied by judgment.

| Rule | Enforced by |
|---|---|
| No direct commits to `main`; PR + green CI required | GitHub branch ruleset · `PreToolUse(Bash)` hook (agent must request the user to run any `main` commit/push) |
| New/changed behavior ships a test | `test-guard` CI job (`skip-tests` label bypass) |
| Conventional, English PR titles | `pr-title` CI job |
| Format + lint | `lint` CI job (`pnpm lint`, Biome) |
| No raw `console.*` in `src/` | `lint` CI job (Biome `noConsole`) |
| Rust format + clippy + test | `rust` CI job; on pull requests, `dorny/paths-filter` runs `cargo fmt --check`, `cargo clippy -D warnings`, and `cargo test` when `src-tauri/**` or `.github/workflows/ci.yml` changes, otherwise the job reports green without the heavy steps |
| Runtime verification of UI/DOM/runtime change | PR template Runtime-evidence section |
| Purchased motion files are protected from mutation | `PreToolUse(Write\|Edit\|NotebookEdit)` runs `pretool-write-guard.sh`, which denies writes under `purchased_motions/`; `PreToolUse(Bash)` runs `pretool-bash-guard.sh`, which denies shell move/copy/delete/overwrite, `git add`, and redirects touching the same directory; `YUI_ALLOW_MOTIONS=1` bypasses both guards |
| Docs are current-state only | `PostToolUse(Write\|Edit\|NotebookEdit)` hook (change-narrative vocabulary block) |
| `.env.local` secret stays out of the transcript | `PreToolUse(Bash\|Read)` hook |
| Worktree runtime assets linked | `WorktreeCreate` hook + `scripts/worktree-setup.sh` |
| TDD ordering, UI mock approval, delegation | Working style (no machine gate) |

Hook scripts live in [`.claude/hooks/`](../../.claude/hooks/) and are wired in [`.claude/settings.json`](../../.claude/settings.json); all fail open. The `configs/motions.json` ↔ `docs/reference/motions.md` pair surfaces a non-blocking sync nudge.
