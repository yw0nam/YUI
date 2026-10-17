# YUI — Writing Tests

Read before writing or changing a test. These rules cover what review judges; lint and CI check the rest.

## What a test is for

A test earns its place by what its failure means: a behaviour a user sees, a contract in `docs/reference/` or `src/contract/`, a config schema in `configs/`, a wire frame, or an exported function's documented result is broken. A test whose failure means none of these is noise and is not written.

Not tested: a constant's value, a library's or the platform's behaviour, a call on an internal helper, a call on a collaborator that no caller can observe, and a fact a sibling block already asserts. A collaborator call is a result when the collaborator is the module's door to the outside: a port passed in through `deps` whose call reaches the OS, the network, the DOM, audio, or storage.

The same setup with another input is a row in the sibling's `it.each` table, not a new block. A file's block count is not a measure of coverage.

The rules below apply to Rust (`#[test]` under `src-tauri/`) and Python (`pytest` under `Mods/` and `integrations/`) the same way; the Vitest names map to their counterparts.

## Placement and names

1. A test sits beside the code it pins, and its file name starts with that source file's name: `x.test.ts`, or `x.<behaviour>.test.ts` when the tests of `x.ts` are split by behaviour. A test that pins a feature folder through its public entry takes the folder's feature name (`qc-vrm-section.test.ts`).
2. A test file is named after the code it pins. A fix, an issue, or a PR never names it.
3. Before adding a test, read the existing tests of the same unit. The same setup with another input is a new row in that file's `it.each` table.

## Assertions

4. Call the public entry: the exported function, the `create*` factory, the DOM event. A test of the helper behind it stays green when the entry stops calling the helper.
5. Expected values are literals. A value computed by the code under test, or read from a production constant, moves with that code.
6. Assert the exact value. `toBeDefined()`, `toBeTruthy()` and a bare `toThrow()` also pass for a wrong value, so `toThrow` names the message or the error class.

## Red before green

7. For new behaviour, the `test:` commit fails when run on its own, before the `feat:` or `fix:` commit. A bug fix that ships a test shows that test failing without the fix; `CONTRIBUTING.md` § Tests accompany behavior says which fixes ship one.
8. A test added to behaviour that already works is shown failing: change the production line its path takes in a throwaway worktree, watch the test fail, restore the line. The PR body names that line.

## Existing tests

9. An existing test is never deleted, skipped, or loosened to turn a run green. When behaviour changes on purpose, the PR summary lists each changed assertion and its reason. A test that meets § What a test is for may always be written. A block that does not meet it is deleted in a PR that touches its file, and the PR summary lists each deleted block with the rule it fails.

## Mocks and outside services

10. A YUI module a test replaces is passed in through a `deps` argument where the code takes one. `vi.mock` covers modules a test cannot pass in: `@tauri-apps/*`, `openai`, browser audio, WebGL.
11. A `vi.mock` factory of a YUI module is typed against the real module: `vi.mocked(...)` on the imported binding, `vi.fn<typeof import("...").name>(impl)` for a mock built in `vi.hoisted`, or `importOriginal<typeof import("...")>()` for a partial mock.
12. A test that reaches a real service is a `*.live.test.ts` file gated by `YUI_LIVE=1` and the service's key. CI skips it.
13. A mock's default behaviour is given in `vi.fn(impl)` or set in `beforeEach`. The config's `mockReset` runs before each test and erases an implementation or return value set on a mock at module level, including inside `vi.hoisted` and `vi.mock` factories.
