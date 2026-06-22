"""shell-sandbox MCP — command-execution core, image reads, and file tools."""

import sys

import pytest

from shell_sandbox.server import (
    edit_text_file,
    read_image_file,
    read_text_file,
    run_command,
    write_text_file,
)


def test_runs_command_and_captures_stdout(tmp_path):
    out = run_command("echo hello", workdir=str(tmp_path), timeout=10, max_output=1000)
    assert out["exit_code"] == 0
    assert out["stdout"].strip() == "hello"
    assert out["truncated"] is False


def test_nonzero_exit_code_is_reported(tmp_path):
    out = run_command("exit 3", workdir=str(tmp_path), timeout=10, max_output=1000)
    assert out["exit_code"] == 3


def test_runs_in_the_workdir(tmp_path):
    out = run_command("pwd", workdir=str(tmp_path), timeout=10, max_output=1000)
    # macOS /tmp symlinks to /private/tmp; compare basenames to stay portable
    assert out["stdout"].strip().endswith(tmp_path.name)


def test_writes_land_in_the_workdir(tmp_path):
    run_command("echo data > made.txt", workdir=str(tmp_path), timeout=10, max_output=1000)
    assert (tmp_path / "made.txt").read_text().strip() == "data"


def test_output_is_truncated_to_the_tail(tmp_path):
    out = run_command(
        f"{sys.executable} -c \"print('x'*5000)\"",
        workdir=str(tmp_path),
        timeout=10,
        max_output=100,
    )
    assert out["truncated"] is True
    assert len(out["stdout"]) <= 100 + 40  # body + truncation marker


def test_timeout_returns_error_without_raising(tmp_path):
    out = run_command(
        f'{sys.executable} -c "import time; time.sleep(5)"',
        workdir=str(tmp_path),
        timeout=1,
        max_output=1000,
    )
    assert out["timed_out"] is True
    assert out["exit_code"] is None


def test_read_image_returns_bytes_and_format(tmp_path):
    (tmp_path / "a.png").write_bytes(b"\x89PNG\r\n\x1a\nFAKE")
    data, fmt = read_image_file("a.png", workdir=str(tmp_path), max_bytes=1_000_000)
    assert data == b"\x89PNG\r\n\x1a\nFAKE"
    assert fmt == "png"


def test_read_image_jpg_maps_to_jpeg(tmp_path):
    (tmp_path / "b.jpg").write_bytes(b"\xff\xd8\xff")
    _, fmt = read_image_file("b.jpg", workdir=str(tmp_path), max_bytes=1_000_000)
    assert fmt == "jpeg"


def test_read_image_missing_file_raises(tmp_path):
    with pytest.raises(FileNotFoundError):
        read_image_file("nope.png", workdir=str(tmp_path), max_bytes=1_000_000)


def test_read_image_unsupported_extension_raises(tmp_path):
    (tmp_path / "c.txt").write_text("x")
    with pytest.raises(ValueError):
        read_image_file("c.txt", workdir=str(tmp_path), max_bytes=1_000_000)


def test_read_image_oversize_raises(tmp_path):
    (tmp_path / "big.png").write_bytes(b"x" * 100)
    with pytest.raises(ValueError):
        read_image_file("big.png", workdir=str(tmp_path), max_bytes=10)


def test_read_text_file_returns_content(tmp_path):
    (tmp_path / "f.txt").write_text("line1\nline2\nline3\n")
    out = read_text_file("f.txt", workdir=str(tmp_path))
    assert out["content"] == "line1\nline2\nline3\n"
    assert out["total_lines"] == 3
    assert out["truncated"] is False


def test_read_text_file_offset_limit_window(tmp_path):
    (tmp_path / "f.txt").write_text("a\nb\nc\nd\ne\n")
    out = read_text_file("f.txt", workdir=str(tmp_path), offset=2, limit=2)
    assert out["content"] == "b\nc\n"
    assert out["start_line"] == 2
    assert out["lines_returned"] == 2
    assert out["truncated"] is True


def test_read_text_file_missing_returns_error(tmp_path):
    assert "error" in read_text_file("nope.txt", workdir=str(tmp_path))


def test_read_text_file_directory_returns_error(tmp_path):
    assert "error" in read_text_file(".", workdir=str(tmp_path))


def test_write_text_file_creates_and_reports_bytes(tmp_path):
    out = write_text_file("new.txt", "hello", workdir=str(tmp_path))
    assert (tmp_path / "new.txt").read_text() == "hello"
    assert out["bytes_written"] == 5


def test_write_text_file_creates_parent_dirs(tmp_path):
    write_text_file("sub/dir/f.txt", "x", workdir=str(tmp_path))
    assert (tmp_path / "sub" / "dir" / "f.txt").read_text() == "x"


def test_write_text_file_overwrites(tmp_path):
    (tmp_path / "f.txt").write_text("old")
    write_text_file("f.txt", "new", workdir=str(tmp_path))
    assert (tmp_path / "f.txt").read_text() == "new"


def test_edit_text_file_replaces_unique(tmp_path):
    (tmp_path / "f.txt").write_text("foo bar baz")
    out = edit_text_file("f.txt", "bar", "QUX", workdir=str(tmp_path))
    assert (tmp_path / "f.txt").read_text() == "foo QUX baz"
    assert out["replacements"] == 1


def test_edit_text_file_missing_old_returns_error(tmp_path):
    (tmp_path / "f.txt").write_text("foo")
    assert "error" in edit_text_file("f.txt", "nope", "x", workdir=str(tmp_path))


def test_edit_text_file_ambiguous_without_replace_all_returns_error(tmp_path):
    (tmp_path / "f.txt").write_text("a a a")
    out = edit_text_file("f.txt", "a", "b", workdir=str(tmp_path))
    assert "error" in out
    assert (tmp_path / "f.txt").read_text() == "a a a"  # unchanged


def test_edit_text_file_replace_all(tmp_path):
    (tmp_path / "f.txt").write_text("a a a")
    out = edit_text_file("f.txt", "a", "b", workdir=str(tmp_path), replace_all=True)
    assert (tmp_path / "f.txt").read_text() == "b b b"
    assert out["replacements"] == 3


def test_edit_text_file_missing_file_returns_error(tmp_path):
    assert "error" in edit_text_file("nope.txt", "a", "b", workdir=str(tmp_path))
