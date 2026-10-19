"""Factorio MCP Server — poll the game mod over RCON and ring the YUI doorbell.

A tool source for the remote backend agent. It runs host-native beside the Factorio
game and reads RCON credentials from the game's own config.ini; it never edits that
file. The game decides what happens. This Mod reports events and sends the agent's
words and pings back into the game.
"""

import argparse
import asyncio
from contextlib import asynccontextmanager
from typing import Any

from fastmcp import FastMCP
from loguru import logger

from factorio.config import Config, ConfigError, load_config
from factorio.doorbell import Doorbell
from factorio.events.cache import EventCache, Session
from factorio.events.poll import Poller
from factorio.outcome_log import OutcomeLog
from factorio.rcon.client import RconClient
from factorio.rpc import RpcClient
from factorio.tools import read, talk

INSTRUCTIONS = (
    "The Factorio game on this machine, through the coop-agent game mod. Read status and "
    "cached events, then snapshot, find, inspect, and recipe for game state. Say and ping "
    "put words and map markers into the game. Events arrive from the game on their own; the "
    "Mod posts a live signal when a wake-kind event happens."
)


def _background(poller: Poller, doorbell: Doorbell):
    """The server lifespan: poll and ring the doorbell while the transport runs."""

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


def build_mcp(
    *,
    rpc: RpcClient,
    session: Session,
    cache: EventCache,
    log: OutcomeLog,
    poller: Poller | None = None,
    doorbell: Doorbell | None = None,
) -> FastMCP:
    lifespan = _background(poller, doorbell) if poller is not None and doorbell is not None else None
    mcp = FastMCP(name="Factorio", instructions=INSTRUCTIONS, lifespan=lifespan)
    read.configure(rpc=rpc, session=session, cache=cache, log=log)
    talk.configure(rpc=rpc, log=log)
    for tool in (*read.TOOLS, *talk.TOOLS):
        mcp.tool(tool)
    return mcp


def _runtime(config: Config) -> tuple[RpcClient, Session, EventCache, Doorbell, Poller, OutcomeLog]:
    log = OutcomeLog(config.outcome_log)
    rcon = RconClient(config.rcon_host, config.rcon_port, config.rcon_password)
    session = Session()
    cache = EventCache()
    doorbell = Doorbell(
        config.signals_url,
        config.wake_kinds,
        cache,
        session,
        log,
        coalesce_ms=config.coalesce_ms,
    )
    rpc = RpcClient(rcon)
    poller = Poller(rpc, session, cache, doorbell, log)
    rpc.on_session_reset = poller.recover_session
    return rpc, session, cache, doorbell, poller, log


def main() -> None:
    parser = argparse.ArgumentParser(description="Factorio MCP Server")
    parser.add_argument(
        "--transport",
        choices=["stdio", "http"],
        default="stdio",
        help="transport (default: stdio)",
    )
    parser.add_argument("--host", default="127.0.0.1", help="HTTP bind host")
    parser.add_argument("--port", type=int, default=9003, help="HTTP bind port")
    args = parser.parse_args()

    try:
        config = load_config()
    except ConfigError as err:
        raise SystemExit(f"factorio: {err.code} — {err.message}") from err

    rpc, session, cache, doorbell, poller, log = _runtime(config)
    mcp = build_mcp(rpc=rpc, session=session, cache=cache, log=log, poller=poller, doorbell=doorbell)

    logger.info(
        f"[setup] rcon {config.rcon_host}:{config.rcon_port}, signals {config.signals_url}, "
        f"outcome log {config.outcome_log}"
    )

    kwargs: dict[str, Any] = {"transport": args.transport}
    if args.transport != "stdio":
        kwargs["host"] = args.host
        kwargs["port"] = args.port
        kwargs["host_origin_protection"] = True

    mcp.run(**kwargs)


if __name__ == "__main__":
    main()
