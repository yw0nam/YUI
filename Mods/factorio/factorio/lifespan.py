"""The server lifespan: run the poller and doorbell for the transport's lifetime."""

import asyncio
from contextlib import asynccontextmanager


def build(poller, doorbell):
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
