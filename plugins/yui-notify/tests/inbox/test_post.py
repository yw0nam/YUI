import json

from yui_notify.inbox.post import post

PREFIX = "Reply from the user in YUI's Threads window:\n"


def user(text):
    return {"type": "user", "message": {"role": "user", "content": PREFIX + text}}


def test_post_authenticates_as_the_session_child_when_a_token_is_set(inbox):
    env = {"CLAUDE_CODE_MESSAGING_SOCKET": inbox.path, "CLAUDE_CODE_MESSAGING_TOKEN": "tok"}
    assert post("hi", env) is None
    assert [json.loads(line) for line in inbox.wait(2)] == [{"type": "auth", "token": "tok"}, user("hi")]


def test_post_sends_only_the_user_line_without_a_token(inbox):
    assert post("hi", {"CLAUDE_CODE_MESSAGING_SOCKET": inbox.path}) is None
    assert [json.loads(line) for line in inbox.wait(1)] == [user("hi")]


def test_post_without_a_socket_returns_an_error():
    assert isinstance(post("hi", {}), str)
