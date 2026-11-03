"""Open Backend commands; every call runs on the adapter's event loop."""

from dataclasses import dataclass, field


@dataclass
class Run:
    id: str
    name: str
    texts: list[str] = field(default_factory=list)
    held: bool = False


class Runs:
    def __init__(self) -> None:
        self._chats: dict[str, Run] = {}

    def open(self, chat_id: str, id: str, name: str) -> bool:
        if chat_id in self._chats:
            return False
        self._chats[chat_id] = Run(id, name)
        return True

    def collect(self, chat_id: str, reply_to: str | None, text: str) -> bool:
        run = self._chats.get(chat_id)
        if run is None or run.id != reply_to:
            return False
        run.texts.append(text)
        return True

    def hold(self, chat_id: str) -> Run | None:
        run = self._chats.get(chat_id)
        if run is not None:
            run.held = True
        return run

    def finish(self, chat_id: str, id: str) -> str | None:
        run = self._chats.get(chat_id)
        if run is None or run.id != id or run.held:
            return None
        self.drop(chat_id)
        return "\n\n".join(run.texts)

    def drop(self, chat_id: str) -> None:
        self._chats.pop(chat_id, None)
