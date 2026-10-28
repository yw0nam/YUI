"""The server lifespan: run the poller and doorbell for the transport's lifetime."""

import asyncio
from contextlib import asynccontextmanager

from factorio.doorbell import Doorbell
from factorio.events.poll import Poller


def build(poller: Poller, doorbell: Doorbell):
    @asynccontextmanager
    async def lifespan(_server):
        tasks = [asyncio.create_task(poller.run()), asyncio.create_task(doorbell.run())]
        try:
            yield
        finally:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            await doorbell.aclose()

    return lifespan
