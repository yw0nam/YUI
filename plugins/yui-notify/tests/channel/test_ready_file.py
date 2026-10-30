import os

import pytest


@pytest.mark.parametrize("failed", [False, True])
def test_ready_file_lifetime(tmp_path, failed):
    from yui_notify.channel.ready_file import live, ready_file

    env = {"XDG_STATE_HOME": str(tmp_path)}
    path = tmp_path / "yui-notify" / "channels" / "20"
    try:
        with ready_file(20, env):
            assert path.read_text() == str(os.getpid())
            assert live(20, env) is True
            if failed:
                raise RuntimeError("disconnected")
    except RuntimeError:
        pass
    assert path.exists() is False
    assert live(20, env) is False
