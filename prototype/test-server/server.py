# Throwaway MCP stdio server for the YUI MCP-host prototype (issue #1648).
#
# Tools: echo_meta (returns the `_meta` the tools/call carried), snapshot (text + small PNG),
# slow (sleeps 20 s and logs peer cancellation). Every JSON-RPC line in and out is logged to
# stderr with a wall-clock and monotonic timestamp, so host-side measurements can cite the
# exact wire shapes (including everything rmcp adds to `_meta`).
#
# Run: uv run server.py   (from this directory; the host spawns it that way)

import base64
import json
import os
import struct
import subprocess
import sys
import time
import zlib
from io import TextIOWrapper

import anyio
import anyio.lowlevel
from anyio.streams.memory import MemoryObjectReceiveStream, MemoryObjectSendStream

from mcp.server.fastmcp import FastMCP, Context
from mcp.shared.message import SessionMessage
from mcp.types import ImageContent, JSONRPCMessage, TextContent

T0 = time.monotonic()
# 20 s per the prototype spec; a measurement run that needs the client's 32 s wait to pass
# first sets YUI_PROTO_SLOW_SECS higher than the tool's wait.
SLOW_SECS = float(os.environ.get("YUI_PROTO_SLOW_SECS", "20"))


def log(msg: str) -> None:
    wall = time.strftime("%H:%M:%S")
    sys.stderr.write(f"[proto-test {wall} +{time.monotonic() - T0:8.3f}s] {msg}\n")
    sys.stderr.flush()


def meta_text(meta) -> str:
    if meta is None:
        return "null"
    return json.dumps(dict(meta), ensure_ascii=False, sort_keys=True)


mcp = FastMCP("yui-proto-test-server")


@mcp.tool(description="Returns the full _meta object this tools/call received, serialized as JSON text.")
async def echo_meta(ctx: Context) -> str:
    text = meta_text(ctx.request_context.meta)
    log(f"echo_meta: _meta = {text}")
    return text


def _png() -> bytes:
    """A 64x64 solid red PNG, generated here so the file carries no asset."""
    w = h = 64
    red = bytes((231, 76, 60))
    raw = b"".join(b"\x00" + red * w for _ in range(h))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )


PNG_B64 = base64.b64encode(_png()).decode()


@mcp.tool(description="Returns one text block and one small PNG image block.")
async def snapshot(ctx: Context) -> list:
    log(f"snapshot: _meta = {meta_text(ctx.request_context.meta)}")
    return [
        TextContent(type="text", text="snapshot ok: 64x64 png"),
        ImageContent(type="image", data=PNG_B64, mimeType="image/png"),
    ]


@mcp.tool(description=f"Sleeps {SLOW_SECS:.0f} seconds (YUI_PROTO_SLOW_SECS), then returns done. Logs peer cancellation to stderr. Spawns a grandchild `sleep 300` for the process-tree kill measurement.")
async def slow(ctx: Context) -> str:
    log(f"slow: start (sleeping {SLOW_SECS:.0f}s); _meta = {meta_text(ctx.request_context.meta)}")
    grandchild = subprocess.Popen(["sleep", "300"])
    log(f"slow: grandchild spawned pid={grandchild.pid} (sleep 300)")
    t0 = time.monotonic()
    try:
        await anyio.sleep(SLOW_SECS)
        log(f"slow: finished after {time.monotonic() - t0:.2f}s")
        return "slow done"
    except BaseException as exc:  # anyio cancellation on notifications/cancelled
        log(f"slow: interrupted after {time.monotonic() - t0:.2f}s: {type(exc).__name__}")
        raise


async def main() -> None:
    # Same shape as mcp.server.stdio.stdio_server, with every line tee'd to stderr.
    read_stream_writer, read_stream = anyio.create_memory_object_stream(0)
    write_stream, write_stream_reader = anyio.create_memory_object_stream(0)
    stdin = anyio.wrap_file(TextIOWrapper(sys.stdin.buffer, encoding="utf-8", errors="replace"))
    stdout = anyio.wrap_file(TextIOWrapper(sys.stdout.buffer, encoding="utf-8"))

    async def stdin_reader() -> None:
        try:
            async with read_stream_writer:
                async for line in stdin:
                    line = line.strip()
                    if not line:
                        continue
                    log(f"RECV {line}")
                    try:
                        message = JSONRPCMessage.model_validate_json(line)
                    except Exception as exc:
                        log(f"RECV parse error: {exc}")
                        await read_stream_writer.send(exc)
                        continue
                    await read_stream_writer.send(SessionMessage(message))
        except anyio.ClosedResourceError:
            await anyio.lowlevel.checkpoint()

    async def stdout_writer() -> None:
        try:
            async with write_stream_reader:
                async for session_message in write_stream_reader:
                    payload = session_message.message.model_dump_json(
                        by_alias=True, exclude_none=True
                    )
                    log(f"SEND {payload}")
                    await stdout.write(payload + "\n")
                    await stdout.flush()
        except anyio.ClosedResourceError:
            await anyio.lowlevel.checkpoint()

    async with anyio.create_task_group() as tg:
        tg.start_soon(stdin_reader)
        tg.start_soon(stdout_writer)
        await mcp._mcp_server.run(
            read_stream,
            write_stream,
            mcp._mcp_server.create_initialization_options(),
        )


if __name__ == "__main__":
    log("server starting (stdio)")
    anyio.run(main)
    log("server exiting (stdin closed)")
