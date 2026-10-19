"""One RCON connection behind a lock, with a per-call timeout and reconnect backoff."""

import asyncio
from contextlib import suppress

from factorio.rcon import framing


class RconError(RuntimeError):
    """An RCON call did not produce a reply."""

    code = "rcon_error"

    def __init__(self, message: str = ""):
        super().__init__(message)
        self.message = message


class RconAuthError(RconError):
    code = "rcon_auth"


class RconTimeout(RconError):
    code = "timeout"


class RconUnavailable(RconError):
    code = "rcon_unavailable"


class Backoff:
    """Reconnect delays: 1, 2, 4, 8, 16, 30, 30, ... seconds."""

    def __init__(self, start: float = 1.0, cap: float = 30.0):
        self._start = start
        self._cap = cap
        self._delay = start

    def next_delay(self) -> float:
        delay = self._delay
        self._delay = min(delay * 2, self._cap)
        return delay

    def reset(self) -> None:
        self._delay = self._start


class RconClient:
    """One TCP connection shared by every caller through an asyncio lock."""

    def __init__(self, host: str, port: int, password: str, timeout: float = 5.0):
        self.host = host
        self.port = port
        self.timeout = timeout
        self.backoff = Backoff()
        self._password = password
        self._lock = asyncio.Lock()
        self._reader: asyncio.StreamReader | None = None
        self._writer: asyncio.StreamWriter | None = None
        self._next_id = 1

    async def command(self, text: str) -> str:
        async with self._lock:
            try:
                reply = await asyncio.wait_for(self._exchange(text), self.timeout)
            except TimeoutError as err:
                await self.close()
                raise RconTimeout(f"RCON did not answer within {self.timeout:g} s") from err
            self.backoff.reset()
            return reply

    async def close(self) -> None:
        writer, self._writer = self._writer, None
        self._reader = None
        if writer is not None:
            writer.close()
            with suppress(Exception):
                await writer.wait_closed()

    async def _exchange(self, text: str) -> str:
        await self._connect()
        packet_id = self._take_id()
        try:
            self._writer.write(framing.encode(packet_id, framing.EXEC, text.encode()))
            await self._writer.drain()
            packet = await framing.read_packet(self._reader)
        except (framing.FramingError, OSError) as err:
            await self.close()
            raise RconUnavailable(f"the RCON connection dropped: {err}") from err
        return packet.body.decode("utf-8", "replace")

    async def _connect(self) -> None:
        if self._writer is not None and not self._writer.is_closing():
            return
        try:
            self._reader, self._writer = await asyncio.open_connection(self.host, self.port)
        except OSError as err:
            raise RconUnavailable(f"cannot reach RCON at {self.host}:{self.port}: {err}") from err
        try:
            self._writer.write(framing.encode(self._take_id(), framing.AUTH, self._password.encode()))
            await self._writer.drain()
            packet = await framing.read_packet(self._reader)
        except (framing.FramingError, OSError) as err:
            await self.close()
            raise RconUnavailable(f"the RCON handshake failed: {err}") from err
        if packet.id == -1:
            await self.close()
            raise RconAuthError("RCON rejected the password from the game's config.ini")

    def _take_id(self) -> int:
        packet_id = self._next_id
        self._next_id = self._next_id % 0x7FFFFFFF + 1
        return packet_id
