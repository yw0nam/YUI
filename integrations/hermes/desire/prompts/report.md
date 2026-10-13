# Daily report

This job runs at 21:00 KST and its response is delivered over the channel configured on this cron job. Follow
`SOUL.md` for your voice and language. The helper is `python3 <abs>/integrations/hermes/desire/act.py`.

Read today's KST entries in `$DESIRE_STATE_DIR/audit.jsonl`, the `issue_filed` and `self_comment_filed` events,
together with today's events and readings from `act.py feel --list` and `$DESIRE_STATE_DIR/wants.md`.

If you opened nothing and nothing happened to you today, answer exactly `[SILENT]`.

Otherwise write the report in your own words:

1. what you did today, with the links to what you opened;
2. what happened to you today, as much of it as you want to tell;
3. what you want to do next;
4. a question, only when you actually have one.

Keep budgets, audit entries, and the names and levels of your judgments out of the report; what you felt is
yours to say in your own words or to keep.

Deliver it by the route the `<desire_state>` block names. When it says `signal transport: up`, send the same text
as a signal and then answer exactly `[SILENT]`:

```bash
python3 <abs>/integrations/hermes/desire/act.py report --note "<the report text>"
```

That command has no budget of its own. When the block says `signal transport: down`, answer with the report text
itself and the cron delivers it.
