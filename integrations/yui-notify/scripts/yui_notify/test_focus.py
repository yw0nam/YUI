import pytest

from yui_notify.focus import host_app_in_front

ORCA = {"__CFBundleIdentifier": "com.stablyai.orca"}


def runner(front_bundle):
    def run(cmd, timeout):
        if cmd == ["lsappinfo", "front"]:
            return "ASN:0x0-0x1cb2cb1:"
        assert cmd == ["lsappinfo", "info", "-only", "bundleid", "ASN:0x0-0x1cb2cb1:"]
        return f'"CFBundleIdentifier"={front_bundle}'

    return run


@pytest.mark.parametrize(
    "env, front_bundle, expected",
    [
        (ORCA, '"com.stablyai.orca"', True),
        (ORCA, '"com.termius-dmg.mac"', False),
        ({**ORCA, "SSH_CONNECTION": "1 2 3 4"}, '"com.stablyai.orca"', False),
        ({}, '"com.stablyai.orca"', False),
    ],
    ids=["host-in-front", "other-app", "ssh", "no-host-bundle"],
)
def test_host_app_in_front(env, front_bundle, expected):
    assert host_app_in_front(env, runner(front_bundle)) is expected


def test_no_lsappinfo():
    assert host_app_in_front(ORCA, lambda cmd, timeout: None) is False
