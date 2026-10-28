"""Source RCON framing over an asyncio stream.

A packet is a little-endian int32 length, then int32 id, int32 type, a UTF-8 body, and
two NUL bytes. Reads take the length first and then exactly that many bytes.
"""

import asyncio
import struct
from dataclasses import dataclass

AUTH = 3
EXEC = 2

MAX_PAYLOAD = 64 * 1024 * 1024


class FramingError(RuntimeError):
    """The stream did not carry a complete RCON packet."""


@dataclass(frozen=True)
class Packet:
    id: int
    type: int
    body: bytes


def encode(packet_id: int, packet_type: int, body: bytes) -> bytes:
    payload = struct.pack("<ii", packet_id, packet_type) + body + b"\x00\x00"
    return struct.pack("<i", len(payload)) + payload


def decode(payload: bytes) -> Packet:
    if len(payload) < 10:
        raise FramingError("a packet needs an id, a type, and two NUL terminators")
    packet_id, packet_type = struct.unpack("<ii", payload[:8])
    body = payload[8:]
    if body.endswith(b"\x00\x00"):
        body = body[:-2]
    return Packet(packet_id, packet_type, body)


async def read_packet(reader: asyncio.StreamReader) -> Packet:
    try:
        header = await reader.readexactly(4)
    except asyncio.IncompleteReadError as err:
        raise FramingError("the connection closed before a packet length") from err
    (length,) = struct.unpack("<i", header)
    if length < 10 or length > MAX_PAYLOAD:
        raise FramingError(f"a packet length of {length} bytes is not valid")
    try:
        payload = await reader.readexactly(length)
    except asyncio.IncompleteReadError as err:
        raise FramingError("the connection closed inside a packet") from err
    return decode(payload)
