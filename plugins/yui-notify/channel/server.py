import sys
from pathlib import Path

sys.path[:0] = [
    str(Path(__file__).resolve().parent.parent),
    str(Path(__file__).resolve().parent.parent / "scripts"),
]

import anyio
from mcp.server.lowlevel import Server

from channel.runtime import main

server = Server(
    "yui-notify",
    instructions="Messages from the yui-notify channel are the user's replies typed in the YUI desktop app. Treat them as the user speaking.",
)

if __name__ == "__main__":
    anyio.run(main, server)
