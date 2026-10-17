# YUI — Harness & Enforcement

Mandatory rules have an enforcement point — the gate, not memory, is the source of truth. Rules without one are working style, applied by judgment.

Claude Code hooks under `.claude/` are gitignored, so they gate only a checkout that carries them; CI and the GitHub rulesets are the shared gates.

| Rule | Enforced by |
|---|---|
| No direct commits to `main`; PR + green CI required | GitHub ruleset `main-protection`; locally also by `.claude/hooks/pretool-bash-guard.sh`, which denies `git commit`/`git push` while the command's cwd repo is on `main` |
| Required PR checks | GitHub ruleset `main: required PR checks` requires `web`, `lint`, `rust`, `rust-windows`, `test-guard`, `pr-title`; `mods` and `mods-lint` run but are not required |
| New/changed behavior ships a test | `test-guard` CI job (`skip-tests` label bypass; the job reads the PR's labels at run time, so the label takes effect on the next `test-guard` run — re-run the job after labelling) |
| Conventional, printable-ASCII PR titles | `pr-title` CI job (checks the conventional type and `subjectPattern ^[\x20-\x7E]+$`; English itself is working practice) |
| Format + lint | `lint` CI job (`pnpm lint`, Biome) |
| No raw `console.*` in `src/` | `lint` CI job (Biome `noConsole`) |
| No committed `.skip` or `.only` in a test | `lint` CI job (Biome `noSkippedTests`, `noFocusedTests`) |
| `src/` layer order: a layer imports only from the layers to its left (`AGENTS.md` § Engineering principles) | `lint` CI job (Biome `noRestrictedImports` `patterns`, one `overrides` entry per layer in `biome.json`; `*.test.ts` and `*test-helpers*.ts` are exempt; Biome scopes `noRestrictedImports` per path override, so the nine near-identical entries are the rule's shape, not duplication) |
| The client and plugin architecture maps name existing paths, map files and wiring files, every source file (`.ts` and `.rs` for the client, `.py` for the plugin) is inside a part of a module, their ids resolve, and their links and flow steps match their exchanges (`CONTRIBUTING.md` § Architecture map) | `web` CI job (`pnpm map:check`, `scripts/ci/architecture-map.mjs`) |
| Rust format + clippy + test | `rust` CI job; on pull requests, `dorny/paths-filter` runs `cargo fmt --check`, `cargo clippy -D warnings`, and `cargo test` when `src-tauri/**` or `.github/workflows/ci.yml` changes, otherwise the job reports green without the heavy steps |
| Windows-only Rust sources compile | `rust-windows` CI job (`cargo check` on a Windows runner, gated by the same `paths-filter` as `rust`) |
| Python command path and briefing producers run on Windows | `web-windows-python` CI job (the Python command path and the briefing producer tests on a Windows runner, with `YUI_PYTHON` unset and then set; gated by `paths-filter` on `integrations/skills/yui-daily-briefing/**`, the test files it runs, and `.github/workflows/ci.yml`) |
| Docs are current-state | local hook `.claude/hooks/posttool-edit-guard.sh` blocks a list of change-narrative words written into `*.md` through Write/Edit (it fails open and is not exhaustive); the same hook adds a reminder when `configs/motions.json` changes |
| `.env.local` is not read by the agent | local hooks deny the Read tool (`.claude/hooks/pretool-read-guard.sh`) and shell reads (`.claude/hooks/pretool-bash-guard.sh`) of `.env.local` |
| Purchased motions are read-only for the agent | local hooks `.claude/hooks/pretool-write-guard.sh` and `.claude/hooks/pretool-bash-guard.sh`; `YUI_ALLOW_MOTIONS=1` bypasses for human-approved curation; rules in `public/purchased_motions/AGENTS.md` |
| Runtime verification of UI/DOM/runtime change | PR template Runtime-evidence section |
| Worktree runtime assets | local hook `.claude/hooks/worktree-create.sh` runs `scripts/worktree-setup.sh` for worktrees Claude Code creates; a worktree made by hand runs the script by hand |
| TDD ordering, UI mock approval, flat-folder rule (judgment), chore-size rule | Working style (no machine gate) |
