"""The token usage of a turn's last LLM call: the post_api_request hook and what it remembers."""

from __future__ import annotations

import pytest
from gateway_stub import STUB_ENV
from yui.src.activity import usage

CHAT = "yui-3f9a2c1d"

# The summary Hermes hands the hook: input_tokens leaves out the cached tokens prompt_tokens counts.
HERMES_USAGE = {
    "input_tokens": 100,
    "output_tokens": 20,
    "cache_read_tokens": 1400,
    "cache_write_tokens": 0,
    "reasoning_tokens": 5,
    "request_count": 1,
    "prompt_tokens": 1500,
    "total_tokens": 1520,
}
MAPPED = {"input_tokens": 1500, "output_tokens": 20, "total_tokens": 1520}


@pytest.fixture(autouse=True)
def clean():
    STUB_ENV["HERMES_SESSION_CHAT_ID"] = CHAT
    yield
    usage.take(CHAT)
    STUB_ENV.pop("HERMES_SESSION_CHAT_ID", None)


def test_a_call_maps_the_prompt_output_and_total_tokens_to_the_three_fields():
    usage.on_post_api_request(platform="yui", usage=HERMES_USAGE)
    assert usage.take(CHAT) == MAPPED


def test_taking_the_usage_clears_it():
    usage.on_post_api_request(platform="yui", usage=HERMES_USAGE)
    usage.take(CHAT)
    assert usage.take(CHAT) is None


def test_the_latest_call_replaces_the_one_before():
    usage.on_post_api_request(platform="yui", usage=HERMES_USAGE)
    usage.on_post_api_request(
        platform="yui", usage={**HERMES_USAGE, "prompt_tokens": 1600, "total_tokens": 1620}
    )
    assert usage.take(CHAT) == {"input_tokens": 1600, "output_tokens": 20, "total_tokens": 1620}


@pytest.mark.parametrize("missing", ["prompt_tokens", "output_tokens", "total_tokens"])
def test_a_call_whose_usage_lacks_a_figure_leaves_no_usage(missing):
    usage.on_post_api_request(platform="yui", usage=HERMES_USAGE)
    usage.on_post_api_request(platform="yui", usage={**HERMES_USAGE, missing: None})
    assert usage.take(CHAT) is None


def test_a_call_with_no_usage_leaves_no_usage():
    usage.on_post_api_request(platform="yui", usage=HERMES_USAGE)
    usage.on_post_api_request(platform="yui", usage=None)
    assert usage.take(CHAT) is None


@pytest.mark.parametrize("platform", ["subagent", "telegram", None])
def test_a_call_of_another_platform_is_not_ours(platform):
    usage.on_post_api_request(platform=platform, usage=HERMES_USAGE)
    assert usage.take(CHAT) is None
