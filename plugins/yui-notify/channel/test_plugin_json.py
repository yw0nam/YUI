import json
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parent.parent


def test_manifest_leaves_the_mcp_server_to_claude_code():
    """Codex reads a plugin's .mcp.json command literally, so the manifest declares no server"""
    manifest = json.loads((PLUGIN_ROOT / ".claude-plugin" / "plugin.json").read_text())
    assert manifest["mcpServers"] == {}
    claude = json.loads((PLUGIN_ROOT / ".mcp.json").read_text())
    assert list(claude["mcpServers"]) == ["yui-notify"]
