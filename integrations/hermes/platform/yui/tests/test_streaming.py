"""The gateway's own edited-message stream stays off; the answer streams through the hook."""

from __future__ import annotations

from yui.src.transport.adapter import YuiAdapter


def test_the_adapter_declares_that_it_edits_no_messages():
    """A streamed turn reaches the client as an empty render without this.

    The stream consumer's interim send carries no notify mark, the adapter drops it, and the
    gateway then counts the reply as already delivered and suppresses the final send.
    """
    assert YuiAdapter.SUPPORTS_MESSAGE_EDITING is False
