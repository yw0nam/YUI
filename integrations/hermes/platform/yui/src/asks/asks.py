"""Open Asks; every call runs on the adapter's event loop."""

from collections.abc import Callable
from dataclasses import dataclass


@dataclass
class Ask:
    frame: dict
    choices: frozenset[str]
    text: bool
    resolve: Callable[[str | None, str | None], None]
    expires_at: float | None


class Asks:
    def __init__(self) -> None:
        self._chats: dict[str, dict[str, Ask]] = {}

    def open(self, chat_id: str, ask_id: str, body: dict, expires_at: float | None, resolve: Callable) -> Ask:
        frame = {"type": "ask", "ask": {"ask_id": ask_id, **body}}
        if expires_at is not None:
            frame["expires_at"] = expires_at
        ask = Ask(
            frame, frozenset(c["id"] for c in body.get("choices", [])), body["text"], resolve, expires_at
        )
        self._chats.setdefault(chat_id, {})[ask_id] = ask
        return ask

    def get(self, chat_id: str, ask_id: str) -> Ask | None:
        return self._chats.get(chat_id, {}).get(ask_id)

    def take(self, chat_id: str, ask_id: str, choice: object, text: object) -> Ask | None:
        ask = self.get(chat_id, ask_id)
        if ask is None:
            return None
        if choice is not None and (not isinstance(choice, str) or choice not in ask.choices):
            return None
        if text is not None and (not isinstance(text, str) or not text.strip() or not ask.text):
            return None
        if choice is None and text is None:
            return None
        self.drop(chat_id, ask_id)
        return ask

    def pending(self, chat_id: str, now_ms: float) -> list[Ask]:
        for ask_id, ask in list(self._chats.get(chat_id, {}).items()):
            if ask.expires_at is not None and ask.expires_at <= now_ms:
                self.drop(chat_id, ask_id)
        return list(self._chats.get(chat_id, {}).values())

    def chat_of(self, ask_id: str) -> str | None:
        return next((chat_id for chat_id, asks in self._chats.items() if ask_id in asks), None)

    def drop(self, chat_id: str, ask_id: str) -> bool:
        chat = self._chats.get(chat_id, {})
        removed = chat.pop(ask_id, None) is not None
        if not chat:
            self._chats.pop(chat_id, None)
        return removed
