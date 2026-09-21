"""The per-chat delegation list the client mirrors."""

from __future__ import annotations

import pytest
from gateway_stub import STUB_ENV
from yui.src.activity import delegations


@pytest.fixture(autouse=True)
def clean():
    delegations.forget("yui")
    STUB_ENV["HERMES_SESSION_CHAT_ID"] = "yui"
    yield
    delegations.forget("yui")
    STUB_ENV.pop("HERMES_SESSION_CHAT_ID", None)


def test_a_started_delegation_is_running_and_carries_its_goal_title():
    delegations.on_subagent_start(
        child_subagent_id="sa-1", child_session_id="s-1", child_goal="Sort the list"
    )
    (item,) = delegations.items("yui")
    assert item["id"] == "sa-1"
    assert item["title"] == "Sort the list"
    assert item["state"] == "running"
    assert isinstance(item["started_at"], int)
    assert "ended_at" not in item


def test_the_title_is_the_first_line_cut_to_the_limit():
    delegations.on_subagent_start(
        child_subagent_id="sa-1", child_session_id="s-1", child_goal="x" * 200 + "\nsecond line"
    )
    assert delegations.items("yui")[0]["title"] == "x" * delegations.TITLE_MAX_LEN


def test_the_session_id_names_a_delegation_with_no_subagent_id():
    delegations.on_subagent_start(child_session_id="s-1", child_goal="Work")
    assert delegations.items("yui")[0]["id"] == "s-1"


def test_stopping_marks_the_delegation_done_and_stamps_the_end():
    delegations.on_subagent_start(child_subagent_id="sa-1", child_session_id="s-1", child_goal="Work")
    delegations.on_subagent_stop(child_session_id="s-1", child_status="ok")
    (item,) = delegations.items("yui")
    assert item["state"] == "done"
    assert item["ended_at"] >= item["started_at"]


def test_a_failed_delegation_is_done_too():
    delegations.on_subagent_start(child_subagent_id="sa-1", child_session_id="s-1", child_goal="Work")
    delegations.on_subagent_stop(child_session_id="s-1", child_status="error")
    assert delegations.items("yui")[0]["state"] == "done"


def test_a_running_item_carries_neither_status_nor_summary():
    delegations.on_subagent_start(child_subagent_id="sa-1", child_session_id="s-1", child_goal="Work")
    (item,) = delegations.items("yui")
    assert "status" not in item
    assert "summary" not in item


def test_a_completed_child_reads_ok_and_carries_its_summary():
    delegations.on_subagent_start(child_subagent_id="sa-1", child_session_id="s-1", child_goal="Work")
    delegations.on_subagent_stop(child_session_id="s-1", child_status="completed", child_summary="All green.")
    (item,) = delegations.items("yui")
    assert item["status"] == "ok"
    assert item["summary"] == "All green."


@pytest.mark.parametrize("child_status", ["failed", "error", "timeout", "interrupted"])
def test_a_failed_interrupted_or_timed_out_child_reads_error(child_status):
    delegations.on_subagent_start(child_subagent_id="sa-1", child_session_id="s-1", child_goal="Work")
    delegations.on_subagent_stop(child_session_id="s-1", child_status=child_status)
    assert delegations.items("yui")[0]["status"] == "error"


def test_a_missing_or_foreign_status_reads_unknown():
    delegations.on_subagent_start(child_subagent_id="sa-1", child_session_id="s-1", child_goal="Work")
    delegations.on_subagent_stop(child_session_id="s-1")
    delegations.on_subagent_start(child_subagent_id="sa-2", child_session_id="s-2", child_goal="Work")
    delegations.on_subagent_stop(child_session_id="s-2", child_status="something-else")
    assert [item["status"] for item in delegations.items("yui")] == ["unknown", "unknown"]


def test_the_summary_is_cut_to_the_limit():
    delegations.on_subagent_start(child_subagent_id="sa-1", child_session_id="s-1", child_goal="Work")
    delegations.on_subagent_stop(child_session_id="s-1", child_status="completed", child_summary="x" * 3000)
    summary = delegations.items("yui")[0]["summary"]
    assert len(summary) == delegations.SUMMARY_MAX_LEN


def test_a_stop_with_no_summary_sends_none():
    delegations.on_subagent_start(child_subagent_id="sa-1", child_session_id="s-1", child_goal="Work")
    delegations.on_subagent_stop(child_session_id="s-1", child_status="completed")
    assert "summary" not in delegations.items("yui")[0]


def test_a_summary_that_is_not_text_is_dropped():
    delegations.on_subagent_start(child_subagent_id="sa-1", child_session_id="s-1", child_goal="Work")
    delegations.on_subagent_stop(
        child_session_id="s-1", child_status="completed", child_summary={"blocks": []}
    )
    assert "summary" not in delegations.items("yui")[0]


def test_a_stop_for_an_unknown_delegation_changes_nothing():
    delegations.on_subagent_stop(child_session_id="never-started")
    assert delegations.items("yui") == []


def test_the_list_is_capped_and_drops_the_oldest_finished_one():
    for n in range(delegations.MAX_ITEMS):
        delegations.on_subagent_start(
            child_subagent_id=f"sa-{n}", child_session_id=f"s-{n}", child_goal=f"g{n}"
        )
    delegations.on_subagent_stop(child_session_id="s-7")
    delegations.on_subagent_start(child_subagent_id="sa-new", child_session_id="s-new", child_goal="new")
    ids = [item["id"] for item in delegations.items("yui")]
    assert len(ids) == delegations.MAX_ITEMS == 50
    assert "sa-7" not in ids
    assert "sa-new" in ids
    assert "sa-0" in ids


def test_with_nothing_finished_the_cap_drops_the_oldest_running_one():
    for n in range(delegations.MAX_ITEMS + 1):
        delegations.on_subagent_start(
            child_subagent_id=f"sa-{n}", child_session_id=f"s-{n}", child_goal=f"g{n}"
        )
    ids = [item["id"] for item in delegations.items("yui")]
    assert len(ids) == delegations.MAX_ITEMS
    assert "sa-0" not in ids


def test_every_change_tells_the_notifier_which_chat_moved():
    seen: list[str] = []
    delegations.set_notifier(seen.append)
    try:
        delegations.on_subagent_start(child_subagent_id="sa-1", child_session_id="s-1", child_goal="Work")
        delegations.on_subagent_stop(child_session_id="s-1")
    finally:
        delegations.set_notifier(None)
    assert seen == ["yui", "yui"]


def test_a_delegation_with_no_chat_in_context_is_ignored():
    STUB_ENV.pop("HERMES_SESSION_CHAT_ID", None)
    delegations.on_subagent_start(child_subagent_id="sa-1", child_session_id="s-1", child_goal="Work")
    assert delegations.items("yui") == []


def test_a_stop_naming_only_the_subagent_closes_the_item():
    delegations.on_subagent_start(child_subagent_id="sa-1", child_session_id=None, child_goal="Work")
    delegations.on_subagent_stop(child_subagent_id="sa-1")
    assert delegations.items("yui")[0]["state"] == "done"
