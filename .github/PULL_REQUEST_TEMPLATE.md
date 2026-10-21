<!-- Title in English, conventional-commit format (becomes the squash-merge subject). e.g. "feat: VRM load + hot-swap" -->

## Summary
<!-- What and why. Lead with the smallest picture that shows the change: a call tree, a file tree, or a diff sketch. For every new constant, threshold, or special-cased status, add a line: why this value / branch and not the alternative. -->

## Related issues
<!-- `Closes #N` or `Part of #N`, on its own line -->

## Related decisions / docs
<!-- Touched docs: docs/reference/client-context.md -->

## Runtime evidence (required for UI / DOM / runtime behavior)
<!-- Unit tests are not runtime verification. For any visible or behavioral
     change, attach a screenshot (headless browser / app window) or paste the
     app-run log proving the behavior, before and after. State "N/A — no runtime
     behavior change" only when the diff is non-runtime (docs, config, tooling). -->

## Merge danger
<!-- Door: one-way (hard to undo: a tagged-release config key, stored setting, contract field, or transport behaviour changes; data is deleted) or two-way (a revert undoes it).
     Blast radius: what a defect breaks, in one line (one window, every backend, the push transport only). -->

## Verification
- [ ] `pnpm build` passes (includes tsc typecheck)
- [ ] `pnpm test` passes
- [ ] `pnpm lint` passes (biome format + lint)
- [ ] `cargo test` / `cargo clippy` pass (Rust changes)
- [ ] Runtime evidence attached above, or N/A justified

## Checklist (YUI principles)
- [ ] Schema changes update `docs/reference/client-context.md` alongside the code
- [ ] `docs/agent-guide/architecture/map.js` carries every module, part, and exchange this PR adds, removes, or changes (or none changed)
- [ ] No unverified assumptions (docs first; web/context7 cross-check)
- [ ] No brain in the client — judgment/persona/mode live in the backend (firing ≠ judgment)
- [ ] No inline control tags — emotion/motion only via `generate_express` tool-call arguments
- [ ] No hardcoding — endpoints/models/paths live in `configs/`
- [ ] New/changed behavior ships a test in this PR (or `skip-tests` label justified)
