"""Framing contract: length-prefixed Source RCON packets and exact reads."""

import asyncio

import pytest

from factorio.rcon import framing


def test_encode_decode_round_trip():
    packet = framing.decode(framing.encode(7, framing.EXEC, b"hello")[4:])
    assert (packet.id, packet.type, packet.body) == (7, framing.EXEC, b"hello")


def test_header_is_two_little_endian_int32s_after_the_length():
    raw = framing.encode(7, framing.AUTH, b"pw")
    assert raw[:4] == (10 + 2).to_bytes(4, "little", signed=True)
    assert raw[4:8] == (7).to_bytes(4, "little", signed=True)
    assert raw[8:12] == (framing.AUTH).to_bytes(4, "little", signed=True)
    assert raw[12:] == b"pw\x00\x00"


def test_reads_a_70000_byte_reply_exactly():
    body = b"0123456789" * 7000

    async def case():
        reader = asyncio.StreamReader()
        reader.feed_data(framing.encode(3, framing.RESPONSE, body))
        reader.feed_eof()
        return await framing.read_packet(reader)

    packet = asyncio.run(case())
    assert len(packet.body) == 70000
    assert packet.body == body


def test_a_closed_stream_raises_a_framing_error():
    async def case():
        reader = asyncio.StreamReader()
        reader.feed_eof()
        await framing.read_packet(reader)

    with pytest.raises(framing.FramingError, match="closed"):
        asyncio.run(case())


def test_a_truncated_body_raises_a_framing_error():
    async def case():
        reader = asyncio.StreamReader()
        reader.feed_data(framing.encode(3, framing.RESPONSE, b"abcdef")[:8])
        reader.feed_eof()
        await framing.read_packet(reader)

    with pytest.raises(framing.FramingError, match="closed"):
        asyncio.run(case())
