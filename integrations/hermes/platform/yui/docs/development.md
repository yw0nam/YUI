# Development

```bash
uv sync
uv run pytest -q
uv run ruff check . && uv run ruff format --check .
```

The tests stub the gateway modules (`tests/gateway_stub.py`), so they run without a gateway
process. [`skills/yui-platform-smoke-test/SKILL.md`](../skills/yui-platform-smoke-test/SKILL.md) runs
the checkout's plugin on a live gateway under a throwaway profile, with two clients.
