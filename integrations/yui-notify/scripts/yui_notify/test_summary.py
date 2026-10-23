import pytest

from yui_notify.summary import excerpt


@pytest.mark.parametrize(
    "message, expected",
    [
        ("x" * 700, "x" * 700),
        ("a" * 200 + "b" + "c" * 500, "a" * 200 + "\n…\n" + "c" * 500),
        ("", ""),
    ],
    ids=["as-is", "excerpt", "empty"],
)
def test_excerpt(message, expected):
    assert excerpt(message) == expected
