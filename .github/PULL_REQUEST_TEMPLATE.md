<!-- Title in English, conventional-commit format (becomes the squash-merge subject). e.g. "feat: VRM load + hot-swap" -->

## Summary
<!-- What and why -->

## Related issues
<!-- Closes #__ -->

## Related decisions / docs
<!-- Touched docs: contract.md / prd.md / event-dispatcher.md -->

## Runtime evidence (required for UI / DOM / runtime behavior)
<!-- Unit tests are not runtime verification. For any visible or behavioral
     change, attach a screenshot (Playwright MCP / app window) or paste the
     app-run log proving the behavior. State "N/A — no runtime behavior change"
     only when the diff is non-runtime (docs, config, tooling). -->

## Verification
- [ ] `pnpm build` passes (includes tsc typecheck)
- [ ] `pnpm test` passes
- [ ] `pnpm lint` passes (biome format + lint)
- [ ] `cargo test` / `cargo clippy` pass (Rust changes)
- [ ] Runtime evidence attached above, or N/A justified

## Checklist (YUI principles)
- [ ] Schema changes update `docs/contract.md` alongside the code
- [ ] No unverified assumptions (docs first; web/context7 cross-check)
- [ ] No brain in the client — judgment/persona/mode live in the backend (firing ≠ judgment)
- [ ] No inline control tags — emotion/motion only via `generate_express` tool-call arguments
- [ ] No hardcoding — endpoints/models/paths live in `configs/`
- [ ] New/changed behavior ships a test in this PR (or `skip-tests` label justified)
