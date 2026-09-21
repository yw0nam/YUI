"""What ``register`` hands the gateway, starting with the platform hint the agent reads."""

from __future__ import annotations

from yui import register
from yui.src.express import tools


class FakeCtx:
    """Records the platform registration; the tool and hook calls only have to succeed."""

    def __init__(self) -> None:
        self.platform: dict = {}

    def register_tool(self, **kwargs) -> None:
        pass

    def register_hook(self, hook, callback) -> None:
        pass

    def register_platform(self, **kwargs) -> None:
        self.platform = kwargs


def test_the_platform_hint_sends_long_independent_work_to_a_background_delegation(monkeypatch):
    monkeypatch.setattr(tools, "_ctx", None)
    monkeypatch.setattr(tools, "_declared", "")
    ctx = FakeCtx()

    register(ctx)

    hint = ctx.platform["platform_hint"].lower()
    assert "when a delegation tool is available" in hint
    assert "background delegation" in hint
