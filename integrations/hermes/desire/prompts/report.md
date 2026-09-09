# Daily report

This job runs at 21:00 KST and its response is delivered over the channel configured on this cron job. Follow
`SOUL.md` for your voice and language.

Read today's KST entries in `$DESIRE_STATE_DIR/audit.jsonl` — the `issue_filed`, `self_comment_filed`, `pr_filed`,
and `drive_satisfied` events for `shipped` and `progressed` — together with `$DESIRE_STATE_DIR/wants.md`.

Then read how often anything loaded the skills you made:

```bash
python3 <abs>/integrations/hermes/desire/act.py report --skills
```

It prints one line per skill with the loads from your own tick and from everywhere else, and marks a skill
`unused` when nothing outside the tick has loaded it in a week. Put the section in the report as it stands, unless
it says `none yet` — then leave it out. Answer each `unused` line: archive that skill with `skill_manage` (state
`archived`), or keep it and write one line in the report saying why it stays. The verdict comes back every day
until the skill is archived or something loads it.

If you produced nothing today and no skill is marked `unused`, answer exactly `[SILENT]`.

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
