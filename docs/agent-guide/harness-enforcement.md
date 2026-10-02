# YUI — Harness & Enforcement

Mandatory rules have an enforcement point — the gate, not memory, is the source of truth. Rules without one are working style, applied by judgment.

| Rule | Enforced by |
|---|---|
| No direct commits to `main`; PR + green CI required | GitHub branch ruleset |
| New/changed behavior ships a test | `test-guard` CI job (`skip-tests` label bypass; the job reads the PR's labels at run time, so the label takes effect on the next `test-guard` run — re-run the job after labelling) |
| Conventional, English PR titles | `pr-title` CI job |
| Format + lint | `lint` CI job (`pnpm lint`, Biome) |
| No raw `console.*` in `src/` | `lint` CI job (Biome `noConsole`) |
| `src/` layer order: a layer imports only from the layers to its left (`AGENTS.md` § Engineering principles) | `lint` CI job (Biome `noRestrictedImports` `patterns`, one `overrides` entry per layer in `biome.json`; `*.test.ts` and `*test-helpers*.ts` are exempt) |
| Rust format + clippy + test | `rust` CI job; on pull requests, `dorny/paths-filter` runs `cargo fmt --check`, `cargo clippy -D warnings`, and `cargo test` when `src-tauri/**` or `.github/workflows/ci.yml` changes, otherwise the job reports green without the heavy steps |
| Windows-only Rust sources compile | `rust-windows` CI job (`cargo check` on a Windows runner, gated by the same `paths-filter` as `rust`) |
| Runtime verification of UI/DOM/runtime change | PR template Runtime-evidence section |
| TDD ordering, UI mock approval, current-state docs, worktree runtime assets (`scripts/worktree-setup.sh`) | Working style (no machine gate) |
