"""Open exec-approval Asks; every call runs on the adapter's event loop."""

from dataclasses import dataclass
from uuid import uuid4

from gateway.platforms.base import ExecApprovalPrompt


@dataclass
class Ask:
    frame: dict
    session_key: str
    request_id: str | None
    choices: frozenset[str]
    expires_at: float


class Asks:
    def __init__(self) -> None:
        self._chats: dict[str, dict[str, Ask]] = {}

    def open(self, chat_id: str, prompt: ExecApprovalPrompt, expires_at: float) -> Ask:
        ask_id = uuid4().hex
        frame = {
            "type": "ask",
            "ask": {
                "ask_id": ask_id,
                "prompt": prompt.text,
                "choices": [
                    {
                        "id": choice,
                        "label": label,
                        **({"tone": style} if style in ("primary", "danger") else {}),
                    }
                    for label, choice, style in prompt.actions
                ],
                "text": False,
            },
            "expires_at": expires_at,
        }
        ask = Ask(frame, prompt.session_key, prompt.request_id, frozenset(prompt.choices), expires_at)
        self._chats.setdefault(chat_id, {})[ask_id] = ask
        return ask

    def get(self, chat_id: str, ask_id: str) -> Ask | None:
        return self._chats.get(chat_id, {}).get(ask_id)

    def take(self, chat_id: str, ask_id: str, choice: object) -> Ask | None:
        ask = self.get(chat_id, ask_id)
        if ask is None or not isinstance(choice, str) or choice not in ask.choices:
            return None
        self.drop(chat_id, ask_id)
        return ask

    def pending(self, chat_id: str, now_ms: float) -> list[Ask]:
        for ask_id, ask in list(self._chats.get(chat_id, {}).items()):
            if ask.expires_at <= now_ms:
                self.drop(chat_id, ask_id)
        return list(self._chats.get(chat_id, {}).values())

    def drop(self, chat_id: str, ask_id: str) -> bool:
        chat = self._chats.get(chat_id, {})
        removed = chat.pop(ask_id, None) is not None
        if not chat:
            self._chats.pop(chat_id, None)
        return removed
