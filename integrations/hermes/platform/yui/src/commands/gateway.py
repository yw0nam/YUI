"""Backend command dispatch, completion, and confirmation lifetime."""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Callable
from dataclasses import dataclass
from uuid import uuid4

from gateway.platforms.base import SendResult
from gateway.platforms.event import MessageEvent, MessageType, ProcessingOutcome

from tools import slash_confirm

from ..asks.asks import Asks
from ..asks.slash_confirm import slash_confirm_ask
from ..turns import state
from .listing import backend_commands
from .runs import Run, Runs

logger = logging.getLogger(__name__)
NOT_RUN = "Command not run."


@dataclass
class Confirmation:
    ask_id: str
    session_key: str
    confirm_id: str
    run: Run | None
    timer: asyncio.TimerHandle | None = None
    task: asyncio.Task | None = None


class Commands:
    def __init__(
        self, *, send_frame: Callable, accepts: Callable, asks: Asks, ask_fits: Callable, start_task: Callable
    ) -> None:
        self._send_frame = send_frame
        self._accepts = accepts
        self._asks = asks
        self._ask_fits = ask_fits
        self._start_task = start_task
        self.runs = Runs()
        self.listed: dict[str, set[str]] = {}
        self.confirmations: dict[str, Confirmation] = {}

    def ready(self, chat_id: str) -> dict:
        self.drop(chat_id)
        if not self._accepts(chat_id, "command_reply"):
            return {}
        commands = backend_commands()
        self.listed[chat_id] = {cmd["name"] for cmd in commands}
        return {"commands": commands}

    def collect(self, chat_id: str, reply_to: str | None, text: str) -> bool:
        return self.runs.collect(chat_id, reply_to, text)

    async def handle(self, chat_id: str, frame: dict, source, dispatch: Callable) -> None:
        id, name, args = (frame.get(key) for key in ("id", "name", "args"))
        valid = (
            isinstance(id, str)
            and len(id) <= 128
            and isinstance(name, str)
            and name in self.listed.get(chat_id, ())
            and isinstance(args, str)
        )
        if not valid or not self.runs.open(chat_id, id, name):
            logger.warning("yui: refused Backend command chat=%s name=%r", chat_id, name)
            await self._send_frame(
                chat_id,
                {
                    "type": "command_reply",
                    "id": id if isinstance(id, str) else "",
                    "text": "Command refused.",
                },
            )
            return
        event = MessageEvent(
            text=f"/{name} {args}".strip(),
            message_type=MessageType.TEXT,
            allow_gateway_control=True,
            message_id=id,
            source=source,
        )
        event._yui_command_id = id
        try:
            await dispatch(event)
        except Exception:
            logger.exception("yui: Backend command dispatch failed chat=%s", chat_id)
            await self.complete(event, ProcessingOutcome.FAILURE)
            return
        if event._gateway_accepted is not True:
            await self.finish(chat_id, id)

    async def finish(self, chat_id: str, id: str) -> None:
        text = self.runs.finish(chat_id, id)
        if text is not None:
            await self._send_frame(chat_id, {"type": "command_reply", "id": id, "text": text})

    async def complete(self, event: MessageEvent, outcome: ProcessingOutcome) -> None:
        chat_id = str(event.source.chat_id)
        id = event._yui_command_id
        if outcome is ProcessingOutcome.FAILURE:
            self.runs.collect(chat_id, id, "Command failed.")
        await self.finish(chat_id, id)

    async def confirm(
        self, chat_id: str, title: str, message: str, session_key: str, confirm_id: str
    ) -> SendResult:
        entry = slash_confirm.get_pending(session_key)
        if entry and entry["command"] == "new":
            self._start_task(slash_confirm.resolve(session_key, confirm_id, "once"))
            state.set_muted(chat_id, False)
            return SendResult(success=True, message_id=confirm_id)
        if not self._accepts(chat_id, "ask"):
            return SendResult(success=False, error="client does not accept ask")
        ask_id = uuid4().hex
        confirmation = Confirmation(ask_id, session_key, confirm_id, self.runs.hold(chat_id))

        def answer(choice: str) -> None:
            if confirmation.timer is not None:
                confirmation.timer.cancel()
            confirmation.task = self._start_task(self.resolve(chat_id, confirmation, choice))

        body, resolve = slash_confirm_ask(title, message, answer)
        ask = self._asks.open(
            chat_id, ask_id, body, time.time() * 1000 + slash_confirm.DEFAULT_TIMEOUT_SECONDS * 1000, resolve
        )
        if not self._ask_fits(chat_id, ask_id, ask):
            if confirmation.run is not None:
                confirmation.run.held = False
            return SendResult(success=False, error="ask too large")
        self.confirmations[chat_id] = confirmation
        confirmation.timer = asyncio.get_running_loop().call_later(
            slash_confirm.DEFAULT_TIMEOUT_SECONDS, self.schedule_expiry, chat_id
        )
        await self._send_frame(chat_id, ask.frame)
        return SendResult(success=True, message_id=ask_id)

    def schedule_expiry(self, chat_id: str) -> None:
        self._start_task(self.expire(chat_id))

    async def resolve(self, chat_id: str, confirmation: Confirmation, choice: str) -> None:
        text = await slash_confirm.resolve(confirmation.session_key, confirmation.confirm_id, choice)
        if self.confirmations.get(chat_id) is not confirmation:
            return
        self.confirmations.pop(chat_id)
        run = confirmation.run
        if run is not None:
            if text is not None:
                self.runs.collect(chat_id, run.id, text)
            run.held = False
            await self.finish(chat_id, run.id)

    async def expire(self, chat_id: str) -> None:
        confirmation = self.confirmations.pop(chat_id, None)
        if confirmation is None:
            return
        self.clear(chat_id, confirmation)
        if self._accepts(chat_id, "ask_end"):
            await self._send_frame(chat_id, {"type": "ask_end", "ask_id": confirmation.ask_id})
        if confirmation.run is not None:
            run = confirmation.run
            self.runs.collect(chat_id, run.id, NOT_RUN)
            run.held = False
            await self.finish(chat_id, run.id)

    def clear(self, chat_id: str, confirmation: Confirmation) -> None:
        if confirmation.timer is not None:
            confirmation.timer.cancel()
        if confirmation.task is not None:
            confirmation.task.cancel()
        self._asks.drop(chat_id, confirmation.ask_id)
        slash_confirm.clear(confirmation.session_key)

    def drop(self, chat_id: str) -> None:
        confirmation = self.confirmations.pop(chat_id, None)
        if confirmation is not None:
            self.clear(chat_id, confirmation)
        self.runs.drop(chat_id)
        self.listed.pop(chat_id, None)
