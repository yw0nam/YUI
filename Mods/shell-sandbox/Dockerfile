# shell-sandbox MCP — build context is this mod's own folder (Mods/shell-sandbox/).
#   docker compose build shell-sandbox   # or: docker compose up -d
FROM python:3.12-slim

WORKDIR /app
COPY pyproject.toml uv.lock ./
COPY shell_sandbox ./shell_sandbox
RUN pip install --no-cache-dir uv && uv sync --frozen --no-dev

# Commands run here; this is where the host volume gets mounted.
WORKDIR /work
EXPOSE 9001
ENTRYPOINT ["/app/.venv/bin/shell-sandbox-mcp", "--transport", "http", "--host", "0.0.0.0", "--port", "9001"]
