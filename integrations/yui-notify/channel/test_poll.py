import asyncio

import pytest


@pytest.mark.parametrize(
    "answer,expected",
    [
        (
            {"ask_id": "perm:r1", "choice": "allow"},
            [("permission", {"request_id": "r1", "behavior": "allow"})],
        ),
        ({"ask_id": "perm:r1", "choice": "deny"}, [("permission", {"request_id": "r1", "behavior": "deny"})]),
        (
            {"ask_id": "perm:r1", "choice": "deny", "text": "Read only"},
            [
                ("permission", {"request_id": "r1", "behavior": "deny"}),
                ("", {"content": "Read only", "meta": {"source": "yui"}}),
            ],
        ),
        (
            {"ask_id": "perm:r1", "text": "Run tests"},
            [
                ("permission", {"request_id": "r1", "behavior": "deny"}),
                ("", {"content": "Run tests", "meta": {"source": "yui"}}),
            ],
        ),
        (
            {"ask_id": "perm:r1", "choice": "allow", "text": "Then test"},
            [
                ("permission", {"request_id": "r1", "behavior": "allow"}),
                ("", {"content": "Then test", "meta": {"source": "yui"}}),
            ],
        ),
        ({"ask_id": "perm:r1", "release": True}, []),
        ({"ask_id": "next:n1", "release": True}, []),
        (
            {"ask_id": "next:n1", "text": "Continue"},
            [("", {"content": "Continue", "meta": {"source": "yui"}})],
        ),
        ({"ask_id": "other:n1", "text": "Continue"}, []),
    ],
)
def test_answer_notifications(answer, expected):
    from channel.poll import dispatch

    sent = []

    class Write:
        async def send(self, message):
            sent.append(message.message.model_dump(exclude_none=True))

    asyncio.run(dispatch(answer, Write()))
    assert sent == [
        {
            "jsonrpc": "2.0",
            "method": "notifications/claude/channel" + ("/" + suffix if suffix else ""),
            "params": params,
        }
        for suffix, params in expected
    ]


def test_poll_retries_and_resets_backoff(monkeypatch):
    from channel.poll import poll

    results = iter(
        [(404, None, "unknown")] * 7
        + [
            (None, None, "offline"),
            (204, None, None),
            (404, None, "unknown"),
            (200, {"ask_id": "next:a", "text": "Hi"}, None),
        ]
    )
    requests, delays, sent = [], [], []

    def get(url, timeout):
        requests.append((url, timeout))
        return next(results)

    async def sleep(seconds):
        delays.append(seconds)

    class Write:
        async def send(self, message):
            sent.append(message.message.params)
            raise asyncio.CancelledError

    monkeypatch.setattr("channel.poll.get", get)
    monkeypatch.setattr("channel.poll.asyncio.sleep", sleep)
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(poll("http://localhost/threads/t", Write()))
    assert requests == [("http://localhost/threads/t/answer?wait=25", 30)] * 11
    assert delays == [1, 2, 4, 8, 16, 30, 30, 30, 1]
    assert sent == [{"content": "Hi", "meta": {"source": "yui"}}]


@pytest.mark.parametrize("bad", [None, {}, {"ask_id": "next:bad", "text": "broken"}])
def test_poll_skips_bad_answer_and_continues(monkeypatch, capsys, bad):
    from channel.poll import poll

    results = iter([(200, bad, None), (200, {"ask_id": "next:good", "text": "Continue"}, None)])
    sent, errors = [], []
    monkeypatch.setattr("channel.poll.get", lambda *args: next(results))

    class Write:
        async def send(self, message):
            if message.message.params["content"] == "broken":
                raise RuntimeError("send failed")
            sent.append(message.message.params)
            raise asyncio.CancelledError

    async def exercise():
        try:
            await poll("http://localhost/threads/t", Write())
        except asyncio.CancelledError:
            pass
        except Exception as error:
            errors.append(type(error).__name__)

    asyncio.run(exercise())
    assert sent == [{"content": "Continue", "meta": {"source": "yui"}}]
    assert errors == []
    output = capsys.readouterr()
    assert output.out == ""
    assert output.err.startswith("yui-notify: answer dispatch failed: ")
    assert len(output.err.splitlines()) == 1
