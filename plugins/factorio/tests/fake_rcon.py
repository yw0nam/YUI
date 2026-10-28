"""Loopback fake RCON server used by the client and RPC tests."""

import asyncio

from factorio.rcon import framing

CLOSE = object()


class FakeRconServer:
    """One reply per command, from `handler(command, count)`.

    A handler returning `CLOSE` drops the connection without a reply.
    """

    def __init__(self, password="secret", handler=None):
        self.password = password
        self.handler = handler or (lambda command, count: "")
        self.commands: list[str] = []
        self.connections = 0
        self._server: asyncio.AbstractServer | None = None
        self._writers: set[asyncio.StreamWriter] = set()

    async def start(self):
        self._server = await asyncio.start_server(self._serve, "127.0.0.1", 0)
        return self

    @property
    def port(self) -> int:
        return self._server.sockets[0].getsockname()[1]

    async def close(self):
        for writer in list(self._writers):
            writer.close()
        self._server.close()
        await self._server.wait_closed()

    async def _serve(self, reader, writer):
        self.connections += 1
        self._writers.add(writer)
        try:
            auth = await framing.read_packet(reader)
            if auth.body.decode() != self.password:
                writer.write(framing.encode(-1, 0, b""))
                await writer.drain()
                return
            writer.write(framing.encode(auth.id, 0, b""))
            await writer.drain()
            while True:
                packet = await framing.read_packet(reader)
                if packet.type != framing.EXEC:
                    continue
                command = packet.body.decode()
                count = len(self.commands)
                self.commands.append(command)
                reply = self.handler(command, count)
                if asyncio.iscoroutine(reply):
                    reply = await reply
                if reply is CLOSE:
                    return
                writer.write(framing.encode(packet.id, 0, reply.encode()))
                await writer.drain()
        except (asyncio.IncompleteReadError, ConnectionError, framing.FramingError):
            pass
        finally:
            writer.close()
            self._writers.discard(writer)
