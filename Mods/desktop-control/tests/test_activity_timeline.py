"""Unit tests for the witness activity timeline — fixture JSONL logs, no live sampling."""

import json
from pathlib import Path

import pytest

from desktop_control import activity, server

DATE = "2026-08-12"


def record(time: str, kind: str, app: str | None = None, title: str | None = None) -> str:
    return json.dumps({"ts": f"{DATE}T{time}+09:00", "type": kind, "app": app, "window_title": title})


def app_segment(start: str, end: str, app: str, title: str | None, duration: float) -> dict:
    return {
        "start": f"{DATE}T{start}+09:00",
        "end": f"{DATE}T{end}+09:00",
        "type": "app",
        "app": app,
        "window_title": title,
        "duration_min": duration,
    }


def idle_segment(start: str, end: str, duration: float) -> dict:
    return {
        "start": f"{DATE}T{start}+09:00",
        "end": f"{DATE}T{end}+09:00",
        "type": "idle",
        "duration_min": duration,
    }


@pytest.fixture
def log_dir(tmp_path, monkeypatch) -> Path:
    directory = tmp_path / "witness"
    directory.mkdir()
    monkeypatch.setenv("WITNESS_LOG_DIR", str(directory))
    return directory


def write_log(directory: Path, lines: list[str], date: str = DATE) -> None:
    (directory / f"activity_{date}.jsonl").write_text("\n".join(lines) + "\n", encoding="utf-8")


class TestLogDir:
    def test_env_var_wins(self, monkeypatch, tmp_path):
        monkeypatch.setenv("WITNESS_LOG_DIR", str(tmp_path / "elsewhere"))
        assert activity.log_dir() == tmp_path / "elsewhere"

    def test_defaults_to_the_app_data_dir(self, monkeypatch):
        monkeypatch.delenv("WITNESS_LOG_DIR", raising=False)
        assert activity.log_dir() == Path.home() / "Library/Application Support/com.yui.desktop/witness"


class TestNormalDay:
    def test_each_app_change_opens_a_segment(self, log_dir):
        write_log(
            log_dir,
            [
                record("09:00:00", "app_change", "Safari", "Start Page"),
                record("09:30:00", "app_change", "Xcode", "YUI"),
                record("10:00:00", "app_change", "Safari", "Docs"),
            ],
        )
        assert activity.timeline(DATE) == {
            "date": DATE,
            "segments": [
                app_segment("09:00:00", "09:30:00", "Safari", "Start Page", 30.0),
                app_segment("09:30:00", "10:00:00", "Xcode", "YUI", 30.0),
                app_segment("10:00:00", "10:00:00", "Safari", "Docs", 0.0),
            ],
        }

    def test_out_of_order_lines_are_sorted(self, log_dir):
        write_log(
            log_dir,
            [
                record("09:30:00", "app_change", "Xcode", "YUI"),
                record("09:00:00", "app_change", "Safari", "Start Page"),
            ],
        )
        segments = activity.timeline(DATE)["segments"]
        assert [segment["app"] for segment in segments] == ["Safari", "Xcode"]


class TestSameAppMerge:
    def test_title_change_keeps_one_segment_with_the_latest_title(self, log_dir):
        write_log(
            log_dir,
            [
                record("09:00:00", "app_change", "Safari", "Tab A"),
                record("09:10:00", "app_change", "Safari", "Tab B"),
                record("09:30:00", "app_change", "Notes", "Shopping"),
            ],
        )
        assert activity.timeline(DATE)["segments"] == [
            app_segment("09:00:00", "09:30:00", "Safari", "Tab B", 30.0),
            app_segment("09:30:00", "09:30:00", "Notes", "Shopping", 0.0),
        ]

    def test_the_same_app_after_idle_stays_a_separate_segment(self, log_dir):
        write_log(
            log_dir,
            [
                record("09:00:00", "app_change", "Safari", "Tab A"),
                record("09:20:00", "idle_start", "Safari", "Tab A"),
                record("09:50:00", "idle_end", "Safari", "Tab A"),
                record("10:00:00", "app_change", "Notes", None),
            ],
        )
        assert activity.timeline(DATE)["segments"] == [
            app_segment("09:00:00", "09:20:00", "Safari", "Tab A", 20.0),
            idle_segment("09:20:00", "09:50:00", 30.0),
            app_segment("09:50:00", "10:00:00", "Safari", "Tab A", 10.0),
            app_segment("10:00:00", "10:00:00", "Notes", None, 0.0),
        ]


class TestIdlePairing:
    def test_idle_pair_becomes_an_idle_segment(self, log_dir):
        write_log(
            log_dir,
            [
                record("13:00:00", "app_change", "Safari", None),
                record("13:15:00", "idle_start", "Safari", None),
                record("14:45:00", "idle_end", "Safari", None),
            ],
        )
        assert activity.timeline(DATE)["segments"] == [
            app_segment("13:00:00", "13:15:00", "Safari", None, 15.0),
            idle_segment("13:15:00", "14:45:00", 90.0),
            app_segment("14:45:00", "14:45:00", "Safari", None, 0.0),
        ]

    def test_repeated_idle_start_does_not_split_the_idle_segment(self, log_dir):
        write_log(
            log_dir,
            [
                record("09:00:00", "app_change", "Safari", None),
                record("09:10:00", "idle_start", "Safari", None),
                record("09:20:00", "idle_start", "Safari", None),
                record("09:40:00", "idle_end", "Safari", None),
            ],
        )
        assert activity.timeline(DATE)["segments"] == [
            app_segment("09:00:00", "09:10:00", "Safari", None, 10.0),
            idle_segment("09:10:00", "09:40:00", 30.0),
            app_segment("09:40:00", "09:40:00", "Safari", None, 0.0),
        ]


class TestUnpairedIdleEdges:
    def test_a_day_that_starts_idle_counts_the_idle_from_midnight(self, log_dir):
        write_log(
            log_dir,
            [
                record("08:00:00", "idle_end", "Safari", "Start Page"),
                record("09:00:00", "app_change", "Notes", None),
            ],
        )
        assert activity.timeline(DATE)["segments"] == [
            idle_segment("00:00:00", "08:00:00", 480.0),
            app_segment("08:00:00", "09:00:00", "Safari", "Start Page", 60.0),
            app_segment("09:00:00", "09:00:00", "Notes", None, 0.0),
        ]

    def test_a_day_that_ends_on_idle_start_does_not_crash(self, log_dir):
        write_log(
            log_dir,
            [
                record("22:00:00", "app_change", "Safari", None),
                record("23:30:00", "idle_start", "Safari", None),
            ],
        )
        assert activity.timeline(DATE)["segments"] == [
            app_segment("22:00:00", "23:30:00", "Safari", None, 90.0),
            idle_segment("23:30:00", "23:30:00", 0.0),
        ]

    def test_idle_end_while_already_active_is_ignored(self, log_dir):
        write_log(
            log_dir,
            [
                record("09:00:00", "app_change", "Safari", None),
                record("09:30:00", "idle_end", "Safari", None),
                record("10:00:00", "app_change", "Notes", None),
            ],
        )
        assert activity.timeline(DATE)["segments"] == [
            app_segment("09:00:00", "10:00:00", "Safari", None, 60.0),
            app_segment("10:00:00", "10:00:00", "Notes", None, 0.0),
        ]


class TestMissingAndMalformed:
    def test_missing_day_file_is_an_empty_timeline(self, log_dir):
        assert activity.timeline(DATE) == {"date": DATE, "segments": []}

    def test_missing_log_dir_is_an_empty_timeline(self, monkeypatch, tmp_path):
        monkeypatch.setenv("WITNESS_LOG_DIR", str(tmp_path / "absent"))
        assert activity.timeline(DATE) == {"date": DATE, "segments": []}

    def test_empty_file_is_an_empty_timeline(self, log_dir):
        (log_dir / f"activity_{DATE}.jsonl").write_text("", encoding="utf-8")
        assert activity.timeline(DATE) == {"date": DATE, "segments": []}

    def test_corrupt_lines_are_skipped_not_fatal(self, log_dir):
        write_log(
            log_dir,
            [
                record("09:00:00", "app_change", "Safari", None),
                "{not json at all",
                json.dumps({"ts": "not-a-timestamp", "type": "app_change", "app": "Notes"}),
                json.dumps({"type": "app_change", "app": "Notes"}),
                json.dumps({"ts": f"{DATE}T09:15:00+09:00", "type": "screen_lock"}),
                "",
                record("09:30:00", "app_change", "Notes", None),
            ],
        )
        assert activity.timeline(DATE)["segments"] == [
            app_segment("09:00:00", "09:30:00", "Safari", None, 30.0),
            app_segment("09:30:00", "09:30:00", "Notes", None, 0.0),
        ]

    def test_a_malformed_date_is_rejected_instead_of_reaching_the_filesystem(self, log_dir):
        result = activity.timeline("../../../etc/passwd")
        assert "error" in result
        assert "segments" not in result


class TestServerTool:
    def test_tool_returns_the_timeline(self, log_dir):
        write_log(log_dir, [record("09:00:00", "app_change", "Safari", "Start Page")])
        assert server.get_activity_timeline(DATE) == {
            "date": DATE,
            "segments": [app_segment("09:00:00", "09:00:00", "Safari", "Start Page", 0.0)],
        }
