"""shell-sandbox MCP — the command-execution core (run_command) and image reads."""

import sys

import pytest

from shell_sandbox.server import read_image_file, run_command


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
