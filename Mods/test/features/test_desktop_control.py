"""Unit tests for desktop_control MCP tools — OS calls are mocked at the ops layer."""

import asyncio
import subprocess
import sys
import types
from unittest.mock import patch

import pytest

from mcp_server.desktop_control import ops, server


@pytest.fixture
def allow_safari_notes(monkeypatch):
    monkeypatch.setenv("DESKTOP_CONTROL_ALLOWED_APPS", "Safari, Notes")


class TestListRunningApps:
    def test_returns_ops_result(self):
        with patch.object(
            server.ops, "list_running_apps", return_value=["Finder", "Safari"]
        ) as m:
            result = server.list_running_apps()
        assert result == ["Finder", "Safari"]
        m.assert_called_once_with()


class TestOpenApp:
    def test_rejects_app_not_in_allowlist(self, allow_safari_notes):
        with patch.object(server.ops, "open_app") as m:
            result = server.open_app("Terminal")
        assert "error" in result
        m.assert_not_called()

    def test_opens_allowed_app(self, allow_safari_notes):
        with patch.object(server.ops, "open_app") as m:
            result = server.open_app("Safari")
        assert result == {"ok": True, "name": "Safari"}
        m.assert_called_once_with("Safari")


class TestCloseApp:
    def test_rejects_app_not_in_allowlist(self, allow_safari_notes):
        with patch.object(server.ops, "quit_app") as m:
            result = server.close_app("Terminal")
        assert "error" in result
        m.assert_not_called()

    def test_closes_allowed_app(self, allow_safari_notes):
        with patch.object(server.ops, "quit_app") as m:
            result = server.close_app("Notes")
        assert result == {"ok": True, "name": "Notes"}
        m.assert_called_once_with("Notes")


class TestScreenshot:
    def test_returns_one_image_per_display(self):
        with patch.object(
            server.ops, "capture_screens", return_value=[b"\x89PNG", b"\x89PNG"]
        ):
            imgs = server.screenshot()
        assert len(imgs) == 2
        assert all(i.to_image_content().mimeType == "image/png" for i in imgs)


class TestScreenshotMaxEdge:
    def test_passes_configured_max_edge(self, monkeypatch):
        monkeypatch.setenv("DESKTOP_CONTROL_SCREENSHOT_MAX_EDGE", "640")
        with patch.object(server.ops, "capture_screens", return_value=[b"x"]) as m:
            server.screenshot()
        m.assert_called_once_with(640)

    def test_defaults_to_1280_when_unset(self, monkeypatch):
        monkeypatch.delenv("DESKTOP_CONTROL_SCREENSHOT_MAX_EDGE", raising=False)
        with patch.object(server.ops, "capture_screens", return_value=[b"x"]) as m:
            server.screenshot()
        m.assert_called_once_with(1280)

    def test_zero_disables_resize(self, monkeypatch):
        monkeypatch.setenv("DESKTOP_CONTROL_SCREENSHOT_MAX_EDGE", "0")
        with patch.object(server.ops, "capture_screens", return_value=[b"x"]) as m:
            server.screenshot()
        m.assert_called_once_with(None)


class TestCaptureScreens:
    def test_collects_each_display_until_invalid(self):
        # displays 1..3 valid, 4 returns None -> stop
        with patch.object(
            ops, "_capture_display", side_effect=lambda idx, me: b"png" if idx <= 3 else None
        ) as m:
            shots = ops.capture_screens(640)
        assert shots == [b"png", b"png", b"png"]
        assert all(call.args[1] == 640 for call in m.call_args_list)


class TestCaptureDisplay:
    def test_returns_none_on_invalid_display(self):
        with patch.object(ops.subprocess, "run") as run:
            run.return_value.returncode = 1
            assert ops._capture_display(99, None) is None

    def test_resizes_when_max_edge_given(self):
        with patch.object(ops.subprocess, "run") as run, patch.object(ops, "_run") as sips:
            run.return_value.returncode = 0
            ops._capture_display(1, 1280)
        assert any(
            call.args[0][0] == "sips" and "1280" in call.args[0]
            for call in sips.call_args_list
        )

    def test_no_resize_when_max_edge_none(self):
        with patch.object(ops.subprocess, "run") as run, patch.object(ops, "_run") as sips:
            run.return_value.returncode = 0
            ops._capture_display(1, None)
        sips.assert_not_called()


class TestAutomationGranted:
    def test_true_when_query_succeeds(self):
        with patch.object(ops, "_run", return_value="Finder, Safari"):
            assert ops.automation_granted() is True

    def test_false_on_not_permitted(self):
        err = subprocess.CalledProcessError(1, ["osascript"], stderr="execution error: -1743")
        with patch.object(ops, "_run", side_effect=err):
            assert ops.automation_granted() is False

    def test_reraises_other_errors(self):
        err = subprocess.CalledProcessError(1, ["osascript"], stderr="some other failure")
        with patch.object(ops, "_run", side_effect=err):
            with pytest.raises(subprocess.CalledProcessError):
                ops.automation_granted()


class TestScreenCaptureGranted:
    def _fake_quartz(self, granted):
        mod = types.ModuleType("Quartz")
        mod.CGPreflightScreenCaptureAccess = lambda: granted
        return mod

    def test_reads_quartz_preflight(self, monkeypatch):
        monkeypatch.setitem(sys.modules, "Quartz", self._fake_quartz(True))
        assert ops.screen_capture_granted() is True
        monkeypatch.setitem(sys.modules, "Quartz", self._fake_quartz(False))
        assert ops.screen_capture_granted() is False


class TestPreflight:
    def test_no_problems_when_both_granted(self):
        with patch.object(server.ops, "screen_capture_granted", return_value=True), patch.object(
            server.ops, "automation_granted", return_value=True
        ):
            assert server.preflight() == []

    def test_reports_screen_recording_gap(self):
        with patch.object(server.ops, "screen_capture_granted", return_value=False), patch.object(
            server.ops, "automation_granted", return_value=True
        ):
            problems = server.preflight()
        assert len(problems) == 1 and "Screen Recording" in problems[0]

    def test_reports_automation_gap(self):
        with patch.object(server.ops, "screen_capture_granted", return_value=True), patch.object(
            server.ops, "automation_granted", return_value=False
        ):
            problems = server.preflight()
        assert len(problems) == 1 and "Automation" in problems[0]


class TestToolRegistration:
    def test_registers_four_tools(self):
        tools = asyncio.run(server.mcp.list_tools())
        names = {t.name for t in tools}
        assert {"screenshot", "list_running_apps", "open_app", "close_app"} <= names
