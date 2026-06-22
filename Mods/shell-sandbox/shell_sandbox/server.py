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
from fastmcp.utilities.types import Image
from loguru import logger

WORKDIR_ENV = "SHELL_SANDBOX_WORKDIR"
TIMEOUT_ENV = "SHELL_SANDBOX_TIMEOUT"
MAX_OUTPUT_ENV = "SHELL_SANDBOX_MAX_OUTPUT"
MAX_IMAGE_BYTES_ENV = "SHELL_SANDBOX_MAX_IMAGE_BYTES"
DEFAULT_WORKDIR = "/work"
DEFAULT_TIMEOUT = 300
DEFAULT_MAX_OUTPUT = 100_000
DEFAULT_MAX_IMAGE_BYTES = 10_000_000

# extension -> MCP image format string (jpg and jpeg both map to jpeg)
_IMAGE_FORMATS = {".png": "png", ".jpg": "jpeg", ".jpeg": "jpeg", ".gif": "gif", ".webp": "webp"}


def _tail(text: str, max_output: int) -> tuple[str, bool]:
    """Keep the tail (final build/test errors matter most), marking truncation."""
    if len(text) <= max_output:
        return text, False
    return f"…[truncated, showing last {max_output} chars]\n{text[-max_output:]}", True


def run_command(command: str, *, workdir: str, timeout: int, max_output: int) -> dict[str, Any]:
    """Run command via the shell in workdir; capture output, never raise on failure/timeout."""
    logger.info(f"➡️ run: {command!r} (cwd={workdir})")
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
        logger.warning(f"⏱️ run timed out after {timeout}s: {command!r}")
        out, _ = _tail(exc.stdout or "", max_output)
        err, _ = _tail(exc.stderr or "", max_output)
        return {"exit_code": None, "stdout": out, "stderr": err, "truncated": False, "timed_out": True}

    out, out_trunc = _tail(proc.stdout, max_output)
    err, err_trunc = _tail(proc.stderr, max_output)
    logger.info(f"⬅️ run: exit={proc.returncode}")
    return {
        "exit_code": proc.returncode,
        "stdout": out,
        "stderr": err,
        "truncated": out_trunc or err_trunc,
        "timed_out": False,
    }


def read_image_file(path: str, *, workdir: str, max_bytes: int) -> tuple[bytes, str]:
    """Read an image from workdir; return (bytes, format string).

    Relative paths resolve against workdir; absolute paths pass through (the
    container is the boundary, same as `run`). Raises ValueError for an
    unsupported extension or an oversize file, FileNotFoundError if missing.
    """
    full = path if os.path.isabs(path) else os.path.join(workdir, path)
    fmt = _IMAGE_FORMATS.get(os.path.splitext(full)[1].lower())
    if fmt is None:
        raise ValueError(f"unsupported image type: {os.path.basename(full)!r} (want png/jpg/jpeg/gif/webp)")
    size = os.path.getsize(full)  # FileNotFoundError if missing
    if size > max_bytes:
        raise ValueError(f"image is {size} bytes, over the {max_bytes}-byte limit")
    with open(full, "rb") as f:
        return f.read(), fmt


def _resolve(path: str, workdir: str) -> str:
    """Relative paths resolve against workdir; absolute pass through (container is the boundary)."""
    return path if os.path.isabs(path) else os.path.join(workdir, path)


def read_text_file(
    path: str, *, workdir: str, offset: int = 1, limit: int = 2000, max_output: int = DEFAULT_MAX_OUTPUT
) -> dict[str, Any]:
    """Read a UTF-8 text file as a line window; return content + metadata, or {"error": ...}."""
    full = _resolve(path, workdir)
    logger.info(f"🔍 read_file: {path!r} (offset={offset}, limit={limit})")
    try:
        with open(full, encoding="utf-8") as f:
            lines = f.readlines()
    except FileNotFoundError:
        return {"error": f"file not found: {path!r}"}
    except IsADirectoryError:
        return {"error": f"path is a directory, not a file: {path!r}"}
    except UnicodeDecodeError:
        return {"error": f"not UTF-8 text: {path!r} (use read_image for images, run for other binary)"}

    total = len(lines)
    start = max(offset, 1)
    window = lines[start - 1 : start - 1 + limit]
    content = "".join(window)
    char_trunc = len(content) > max_output
    if char_trunc:
        content = f"{content[:max_output]}\n…[truncated to {max_output} chars]"
    truncated = char_trunc or (start - 1 + limit) < total
    logger.info(f"⬅️ read_file: {len(window)} of {total} lines")
    return {
        "content": content,
        "start_line": start,
        "lines_returned": len(window),
        "total_lines": total,
        "truncated": truncated,
    }


def write_text_file(path: str, content: str, *, workdir: str) -> dict[str, Any]:
    """Create or overwrite a text file (parent dirs created); return {"path", "bytes_written"} or {"error"}."""
    full = _resolve(path, workdir)
    logger.info(f"➡️ write_file: {path!r} ({len(content)} chars)")
    try:
        os.makedirs(os.path.dirname(full) or ".", exist_ok=True)
        with open(full, "w", encoding="utf-8") as f:
            f.write(content)
    except IsADirectoryError:
        return {"error": f"path is a directory, not a file: {path!r}"}
    except OSError as exc:
        return {"error": f"could not write {path!r}: {exc}"}
    written = len(content.encode("utf-8"))
    logger.info(f"⬅️ write_file: {path!r} ({written} bytes)")
    return {"path": full, "bytes_written": written}


def edit_text_file(
    path: str, old: str, new: str, *, workdir: str, replace_all: bool = False
) -> dict[str, Any]:
    """Exact-replace old→new in a text file; require a unique match unless replace_all. {"error"} on miss/ambiguity."""
    full = _resolve(path, workdir)
    logger.info(f"➡️ edit_file: {path!r} (replace_all={replace_all})")
    try:
        with open(full, encoding="utf-8") as f:
            text = f.read()
    except FileNotFoundError:
        return {"error": f"file not found: {path!r}"}
    except IsADirectoryError:
        return {"error": f"path is a directory, not a file: {path!r}"}
    except UnicodeDecodeError:
        return {"error": f"not UTF-8 text: {path!r}"}

    count = text.count(old)
    if count == 0:
        return {"error": f"old string not found in {path!r}"}
    if count > 1 and not replace_all:
        return {
            "error": f"old string is not unique in {path!r} ({count} matches) — add context or pass replace_all=true"
        }

    text = text.replace(old, new) if replace_all else text.replace(old, new, 1)
    replacements = count if replace_all else 1
    with open(full, "w", encoding="utf-8") as f:
        f.write(text)
    logger.info(f"⬅️ edit_file: {path!r} ({replacements} replaced)")
    return {"path": full, "replacements": replacements}


mcp = FastMCP(
    name="Shell Sandbox",
    instructions=(
        "Run shell commands inside an isolated container against a mounted workspace. "
        "Use `run` for anything: grep, build, install deps, run tests. "
        "Commands run in the workspace dir and may read and write it freely. "
        "`read_file`/`write_file`/`edit_file` are reliable structured alternatives to shelling out, "
        "and `read_image` views an image file (`run` returns text only)."
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


@mcp.tool
def read_image(path: str) -> Image:
    """Read an image file from the workspace and return it as a viewable image.

    Args:
        path: Path to an image (png/jpg/jpeg/gif/webp), relative to the workspace or absolute.

    Use this instead of `run` when you need to actually see an image — `run` returns text only.
    """
    logger.info(f"🔍 read_image: {path!r}")
    data, fmt = read_image_file(
        path,
        workdir=os.getenv(WORKDIR_ENV, DEFAULT_WORKDIR),
        max_bytes=_int_env(MAX_IMAGE_BYTES_ENV, DEFAULT_MAX_IMAGE_BYTES),
    )
    logger.info(f"⬅️ read_image: {path!r} ({len(data)} bytes, {fmt})")
    return Image(data=data, format=fmt)


@mcp.tool
def read_file(path: str, offset: int = 1, limit: int = 2000) -> dict[str, Any]:
    """Read a text file from the workspace as a line window.

    Args:
        path: File path, relative to the workspace or absolute.
        offset: 1-based line to start from (default 1).
        limit: Max lines to return (default 2000).

    Returns content plus start_line, lines_returned, total_lines, truncated; or {"error": ...}.
    """
    return read_text_file(
        path,
        workdir=os.getenv(WORKDIR_ENV, DEFAULT_WORKDIR),
        offset=offset,
        limit=limit,
        max_output=_int_env(MAX_OUTPUT_ENV, DEFAULT_MAX_OUTPUT),
    )


@mcp.tool
def write_file(path: str, content: str) -> dict[str, Any]:
    """Create or overwrite a text file in the workspace (parent dirs are created).

    Args:
        path: File path, relative to the workspace or absolute.
        content: Full file content to write.

    Returns {"path", "bytes_written"}, or {"error": ...}.
    """
    return write_text_file(path, content, workdir=os.getenv(WORKDIR_ENV, DEFAULT_WORKDIR))


@mcp.tool
def edit_file(path: str, old: str, new: str, replace_all: bool = False) -> dict[str, Any]:
    """Exact-replace a string in a text file. Fails if `old` is absent, or not unique unless replace_all.

    Args:
        path: File path, relative to the workspace or absolute.
        old: Exact string to replace (include enough context to be unique).
        new: Replacement string.
        replace_all: Replace every occurrence instead of requiring a unique match.

    Returns {"path", "replacements"}, or {"error": ...}.
    """
    return edit_text_file(
        path, old, new, workdir=os.getenv(WORKDIR_ENV, DEFAULT_WORKDIR), replace_all=replace_all
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
