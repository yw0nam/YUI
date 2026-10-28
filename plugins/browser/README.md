# browser

An MCP server with one tool, `browser`, that runs JavaScript in an ego lite task space and returns its logs and screenshots. It speaks MCP over stdio and opens no port.

## Requirement

ego lite installed and run once, so its `ego-browser` CLI is in `~/.local/bin` or on `PATH`. The server looks for it on every call; without it a call answers `ego lite not found: install ego lite and run it once` as a tool error.

## The tool

- `code`: the JavaScript to run, the body of an async function. It gets `task`, the task space, and `screenshot(page)`, which attaches an image of the page's viewport.
- `guide: true`: returns the `ego-browser` CLI's full guide instead of running code.

A call runs in the task space `yui-<preset>`, where `<preset>` is the string in the request's `_meta["io.github.yw0nam.yui/preset"]`. A call without it, or with an empty one, runs in `yui`. Calls to one task space run one at a time.

The result is one text block (a status line on failure, a line marking the text as untrusted, the script's logs, notes on dropped or unreadable screenshots), then one `image/jpeg` block per screenshot. `isError` is true when the text starts with `error:` or `unknown:`, when ego lite is missing, and when the CLI fails to start or the relay fails otherwise; the text then is that error.

## Limits

- The script stops itself after 25 s; the CLI is killed at 28 s, and the result then starts with `unknown:`.
- The whole text block is capped at 64 KiB; the script's logs are cut to fit.
- The last 4 screenshots are kept, each scaled to a long edge of at most 1280 px.

The tool's `_meta["io.github.yw0nam.yui/wait_ms"]` is 32000, the wait that covers the kill and the screenshot collection after it.

## Test

```bash
cargo fmt --check
cargo clippy --all-targets --locked -- -D warnings
cargo test --locked
```

The tests run a fake `ego-browser` that needs `node` on `PATH`.
