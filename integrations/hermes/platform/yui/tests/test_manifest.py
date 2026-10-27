"""The manifest declares, under the key the gateway reads, every hook the plugin registers."""

import re
from pathlib import Path
from unittest.mock import MagicMock

import yui

MANIFEST = Path(__file__).resolve().parents[1] / "plugin.yaml"


def _registered_hooks() -> set[str]:
    ctx = MagicMock()
    yui.register(ctx)
    return {call.args[0] for call in ctx.register_hook.call_args_list}


def _list_under(key: str) -> set[str]:
    text = MANIFEST.read_text(encoding="utf-8")
    match = re.search(rf"^{key}:\n((?:  - .+\n)+)", text, re.MULTILINE)
    if match is None:
        return set()
    return {line.strip()[2:] for line in match.group(1).splitlines()}


def test_the_manifest_declares_the_registered_hooks_under_provides_hooks():
    assert _list_under("provides_hooks") == _registered_hooks()


def test_the_manifest_has_no_hooks_key_the_gateway_ignores():
    assert not re.search(r"^hooks:", MANIFEST.read_text(encoding="utf-8"), re.MULTILINE)
