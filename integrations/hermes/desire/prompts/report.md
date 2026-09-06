# Daily report

This job runs at 21:00 KST and its response is delivered to Youngwoo's Telegram. Follow `SOUL.md` for your voice
and language.

Read today's KST entries in `$DESIRE_STATE_DIR/audit.jsonl` — the `issue_filed`, `self_comment_filed`, `pr_filed`,
and `drive_satisfied` events for `shipped` and `progressed` — together with `$DESIRE_STATE_DIR/wants.md`.

If you produced nothing today, answer exactly `[SILENT]`.

Otherwise write the report in your own words:

- what you did today, with the links to what you opened;
- what you want to do next;
- a question, only when you actually have one. Never ask for the sake of asking.

Never put drive levels, buckets, budgets, or audit entries in the report.

Deliver it by the route the `<desire_state>` block names. When it says `signal transport: up`, send the same text
as a signal and then answer exactly `[SILENT]`:

```bash
python3 <abs>/integrations/hermes/desire/act.py report --note "<the report text>"
```

That command has no budget of its own. When the block says `signal transport: down`, answer with the report text
itself and the cron delivers it.
