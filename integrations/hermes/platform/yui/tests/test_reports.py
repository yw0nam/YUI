"""The away queue: reports that arrive while no client socket is ready."""

from __future__ import annotations

import pytest
from yui.src.activity import reports


@pytest.fixture(autouse=True)
def clean():
    reports.take("yui")
    reports.take_renders("yui")
    yield
    reports.take("yui")
    reports.take_renders("yui")


def test_one_report_comes_back_alone():
    reports.queue("yui", "first")
    assert reports.take("yui") == (["first"], 0)


def test_taking_empties_the_queue():
    reports.queue("yui", "first")
    reports.take("yui")
    assert reports.take("yui") == ([], 0)


def test_queues_are_per_chat():
    reports.queue("yui", "mine")
    reports.queue("other", "theirs")
    assert reports.take("yui") == (["mine"], 0)
    assert reports.take("other") == (["theirs"], 0)


def test_the_queue_keeps_the_newest_forty_and_counts_the_rest():
    for n in range(45):
        reports.queue("yui", f"report {n}")
    kept, dropped = reports.take("yui")
    assert len(kept) == reports.MAX_QUEUED == 40
    assert dropped == 5
    assert kept[0] == "report 5"
    assert kept[-1] == "report 44"


def test_merged_text_opens_with_the_count_and_keeps_each_report():
    text = reports.merged_text(["first", "second"], 0)
    header, *rest = text.split("\n\n")
    assert header == (
        "While the client was disconnected, 2 reports arrived. "
        "Summarise them for the user in one short reply, most important first."
    )
    assert rest == ["first", "second"]


def test_merged_text_names_the_dropped_reports():
    text = reports.merged_text(["only"], 5)
    assert text.startswith("While the client was disconnected, 1 reports arrived (5 older ones dropped). ")


def test_held_replies_keep_the_newest_forty_and_count_the_rest():
    for n in range(45):
        reports.queue_render("yui", {"n": n})
    kept, dropped = reports.take_renders("yui")
    assert len(kept) == reports.MAX_QUEUED
    assert dropped == 5
    assert kept[0] == {"n": 5}
