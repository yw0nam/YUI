"""RCON client: one connection, a lock per call, a per-call timeout, and reconnect backoff."""

import asyncio

import pytest
from fake_rcon import CLOSE, FakeRconServer

from factorio.rcon.client import Backoff, RconAuthError, RconClient, RconTimeout, RconUnavailable


def test_auth_failure_raises_a_named_error():
    async def case():
        server = await FakeRconServer(password="right").start()
        try:
            client = RconClient("127.0.0.1", server.port, "wrong", timeout=1.0)
            with pytest.raises(RconAuthError):
                await client.command("events_since")
        finally:
            await server.close()

    asyncio.run(case())


def test_a_tool_call_waits_for_the_running_poll():
    async def case():
        async def handler(command, count):
            await asyncio.sleep(0.1)
            return "ok"

        server = await FakeRconServer(handler=handler).start()
        try:
            client = RconClient("127.0.0.1", server.port, "secret", timeout=1.0)
            poll = asyncio.create_task(client.command("events_since"))
            await asyncio.sleep(0.01)
            tool = asyncio.create_task(client.command("say"))
            assert await asyncio.gather(poll, tool) == ["ok", "ok"]
            return server.commands
        finally:
            await server.close()

    assert asyncio.run(case()) == ["events_since", "say"]


def test_a_call_that_exceeds_the_timeout_raises_before_the_reply():
    order = []

    async def case():
        async def handler(command, count):
            order.append("handler_started")
            await asyncio.sleep(5)
            order.append("handler_finished")
            return "late"

        server = await FakeRconServer(handler=handler).start()
        try:
            client = RconClient("127.0.0.1", server.port, "secret", timeout=0.05)
            with pytest.raises(RconTimeout):
                await client.command("events_since")
        finally:
            await server.close()

    asyncio.run(case())
    assert order == ["handler_started"]


def test_a_lost_connection_raises_unavailable_and_the_next_call_reconnects():
    async def case():
        server = await FakeRconServer(handler=lambda command, count: CLOSE).start()
        try:
            client = RconClient("127.0.0.1", server.port, "secret", timeout=1.0)
            with pytest.raises(RconUnavailable):
                await client.command("first")
            server.handler = lambda command, count: "ok"
            return await client.command("second")
        finally:
            await server.close()

    assert asyncio.run(case()) == "ok"


def test_reconnect_backoff_doubles_to_thirty_seconds():
    backoff = Backoff()
    assert [backoff.next_delay() for _ in range(7)] == [1.0, 2.0, 4.0, 8.0, 16.0, 30.0, 30.0]


def test_a_successful_call_resets_the_backoff():
    async def case():
        server = await FakeRconServer(handler=lambda command, count: "ok").start()
        try:
            client = RconClient("127.0.0.1", server.port, "secret", timeout=1.0)
            client.backoff.next_delay()
            client.backoff.next_delay()
            await client.command("events_since")
            return client.backoff.next_delay()
        finally:
            await server.close()

    assert asyncio.run(case()) == 1.0
