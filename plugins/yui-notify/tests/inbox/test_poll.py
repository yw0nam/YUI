import os
import subprocess
from urllib.parse import parse_qs, urlparse

from yui_notify.inbox.poll import poll


def test_a_closed_ask_ends_the_poll_without_posting(server, monkeypatch):
    endpoint, received = server
    received.status[1] = 410
    posted = []
    monkeypatch.setattr("yui_notify.inbox.poll.post", lambda *args: posted.append(args))
    assert poll(endpoint + "/threads/t", "next:1", os.getpid(), {}) == 0
    assert posted == []
    assert len(received.polls) == 1
    assert urlparse(received.polls[0]).path == "/threads/t/answer"
    assert parse_qs(urlparse(received.polls[0]).query) == {"ask_id": ["next:1"], "wait": ["25"]}


def test_a_dead_session_ends_the_poll_before_any_request(server):
    endpoint, received = server
    done = subprocess.Popen(["true"])
    done.wait()
    assert poll(endpoint + "/threads/t", "next:1", done.pid, {}) == 0
    assert received.polls == []
