"""Factorio MCP Server — poll the game mod over RCON and ring the YUI doorbell.

A tool source for the remote backend agent. It runs host-native beside the Factorio
game and reads RCON credentials from the game's own config.ini; it never edits that
file. The game decides what happens. This Mod reports events and sends the agent's
words and pings back into the game.
"""

import argparse
from typing import Any

from fastmcp import FastMCP
from loguru import logger

from factorio import lifespan
from factorio.config import Config, ConfigError, load_config
from factorio.doorbell import Doorbell
from factorio.events.cache import Session
from factorio.events.poll import Poller
from factorio.outcome_log import OutcomeLog
from factorio.rcon.client import RconClient
from factorio.recovery import MapRecovery
from factorio.rpc import RpcClient
from factorio.tools import body, read, talk
from factorio.tools.deps import ToolDeps

INSTRUCTIONS = (
    "The Factorio game on this machine, through the coop-agent game mod. Read status and "
    "cached events, then snapshot, find, inspect, and recipe for game state. Say and ping "
    "put words and map markers into the game. Jobs, idle mode, and stop drive the body. "
    "Events arrive from the game on their own; the Mod posts a live signal when a "
    "wake-kind event happens."
)


def build_mcp(
    *,
    rpc: RpcClient,
    session: Session,
    log: OutcomeLog,
    poller: Poller,
    doorbell: Doorbell,
) -> FastMCP:
    mcp = FastMCP(name="Factorio", instructions=INSTRUCTIONS, lifespan=lifespan.build(poller, doorbell))
    deps = ToolDeps(rpc=rpc, session=session, log=log)
    read.register(mcp, deps)
    talk.register(mcp, deps)
    body.register(mcp, deps)
    return mcp


def _runtime(config: Config) -> tuple[RpcClient, Session, OutcomeLog, Poller, Doorbell]:
    log = OutcomeLog(config.outcome_log)
    rcon = RconClient(config.rcon_host, config.rcon_port, config.rcon_password)
    session = Session()
    doorbell = Doorbell(
        config.signals_url,
        config.wake_kinds,
        session,
        log,
        coalesce_ms=config.coalesce_ms,
    )
    recovery = MapRecovery(session, doorbell, log)
    rpc = RpcClient(rcon, session, recovery.run)
    poller = Poller(rpc, session, doorbell, recovery, log)
    return rpc, session, log, poller, doorbell


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

    rpc, session, log, poller, doorbell = _runtime(config)
    mcp = build_mcp(rpc=rpc, session=session, log=log, poller=poller, doorbell=doorbell)

    logger.bind(
        rcon=f"{config.rcon_host}:{config.rcon_port}",
        signals_url=config.signals_url,
        outcome_log=config.outcome_log,
    ).info("setup")

    kwargs: dict[str, Any] = {"transport": args.transport}
    if args.transport != "stdio":
        kwargs["host"] = args.host
        kwargs["port"] = args.port
        kwargs["host_origin_protection"] = True

    mcp.run(**kwargs)


if __name__ == "__main__":
    main()
