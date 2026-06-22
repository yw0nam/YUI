"""shell-sandbox MCP Server — an unrestricted shell over a mounted volume.

Runs *inside* a container; the container IS the boundary. Commands execute in
SHELL_SANDBOX_WORKDIR (the bind-mounted host directory). There is no command
allowlist — rm/pnpm/pip/build all run. The operator accepts that by choosing
what to mount: the mounted directory is writable host state, everything else on
the host is unreachable from here.
"""

import argparse
import os
import subprocess
from typing import Any

from fastmcp import FastMCP
from loguru import logger

WORKDIR_ENV = "SHELL_SANDBOX_WORKDIR"
TIMEOUT_ENV = "SHELL_SANDBOX_TIMEOUT"
MAX_OUTPUT_ENV = "SHELL_SANDBOX_MAX_OUTPUT"
DEFAULT_WORKDIR = "/work"
DEFAULT_TIMEOUT = 300
DEFAULT_MAX_OUTPUT = 100_000


def _tail(text: str, max_output: int) -> tuple[str, bool]:
    """Keep the tail (final build/test errors matter most), marking truncation."""
    if len(text) <= max_output:
        return text, False
    return f"…[truncated, showing last {max_output} chars]\n{text[-max_output:]}", True


def run_command(command: str, *, workdir: str, timeout: int, max_output: int) -> dict[str, Any]:
    """Run command via the shell in workdir; capture output, never raise on failure/timeout."""
    logger.info(f"run: {command!r} (cwd={workdir})")
    try:
        proc = subprocess.run(
            command,
            shell=True,
            cwd=workdir,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired as exc:
        logger.warning(f"timeout after {timeout}s: {command!r}")
        out, _ = _tail(exc.stdout or "", max_output)
        err, _ = _tail(exc.stderr or "", max_output)
        return {"exit_code": None, "stdout": out, "stderr": err, "truncated": False, "timed_out": True}

    out, out_trunc = _tail(proc.stdout, max_output)
    err, err_trunc = _tail(proc.stderr, max_output)
    return {
        "exit_code": proc.returncode,
        "stdout": out,
        "stderr": err,
        "truncated": out_trunc or err_trunc,
        "timed_out": False,
    }


mcp = FastMCP(
    name="Shell Sandbox",
    instructions=(
        "Run shell commands inside an isolated container against a mounted workspace. "
        "Use `run` for anything: read files, grep, edit, build, install deps, run tests. "
        "Commands run in the workspace dir and may read and write it freely."
    ),
)


def _int_env(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        logger.warning(f"{name}={raw!r} is not an int; using {default}")
        return default


@mcp.tool
def run(command: str) -> dict[str, Any]:
    """Run a shell command in the mounted workspace and return its output.

    Args:
        command: A shell command line (pipes, redirection, &&, etc. allowed).

    Returns exit_code (None if timed out), stdout, stderr, truncated, timed_out.
    """
    return run_command(
        command,
        workdir=os.getenv(WORKDIR_ENV, DEFAULT_WORKDIR),
        timeout=_int_env(TIMEOUT_ENV, DEFAULT_TIMEOUT),
        max_output=_int_env(MAX_OUTPUT_ENV, DEFAULT_MAX_OUTPUT),
    )


def main() -> None:
    """Run the shell-sandbox MCP Server."""
    parser = argparse.ArgumentParser(description="shell-sandbox MCP Server")
    parser.add_argument(
        "--transport", choices=["stdio", "http", "sse"], default="stdio", help="transport (default: stdio)"
    )
    parser.add_argument("--host", default="127.0.0.1", help="HTTP bind host")
    parser.add_argument("--port", type=int, default=9001, help="HTTP bind port")
    args = parser.parse_args()

    kwargs: dict[str, Any] = {"transport": args.transport}
    if args.transport != "stdio":
        kwargs["host"] = args.host
        kwargs["port"] = args.port

    mcp.run(**kwargs)


if __name__ == "__main__":
    main()
