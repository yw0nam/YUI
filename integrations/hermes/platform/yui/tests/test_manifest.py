"""The manifest declares, under the key the gateway reads, every hook the plugin registers."""

import re
from pathlib import Path

MANIFEST = Path(__file__).resolve().parents[1] / "plugin.yaml"
REGISTERED_HOOKS = {
    "subagent_start",
    "subagent_stop",
    "on_stream_delta",
    "pre_tool_call",
    "post_tool_call",
}


def _list_under(key: str) -> set[str]:
    text = MANIFEST.read_text(encoding="utf-8")
    match = re.search(rf"^{key}:\n((?:  - .+\n)+)", text, re.MULTILINE)
    if match is None:
        return set()
    return {line.strip()[2:] for line in match.group(1).splitlines()}


def test_the_manifest_declares_the_registered_hooks_under_provides_hooks():
    assert _list_under("provides_hooks") == REGISTERED_HOOKS


def test_the_manifest_has_no_hooks_key_the_gateway_ignores():
    assert not re.search(r"^hooks:", MANIFEST.read_text(encoding="utf-8"), re.MULTILINE)
