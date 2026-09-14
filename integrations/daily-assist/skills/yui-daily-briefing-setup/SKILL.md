---
name: yui-daily-briefing-setup
description: "Install and wire the YUI daily briefing when the user asks to install it from a YUI checkout: turn on the ingress, register the runtime skill in this agent's skill store, post a fixture, and build the morning producer."
license: PolyForm-Noncommercial-1.0.0
---

# yui-daily-briefing-setup

The user has asked you to install the YUI daily briefing from a YUI checkout. Work through
the seven steps in order and stop at each check before moving on.

Two variables run through every step:

- `YUI`: the YUI checkout the user named. Every path below reads
  `$YUI/integrations/daily-assist/...`.
- `YUI_SIGNALS_URL`: the ingress base URL. Its host is loopback and its port is the
  "Listener port" field in YUI Settings → Reactions, so its default value reads
  `http://127.0.0.1:8770`.

## 1. Turn the ingress on

Ask the user to open YUI Settings → Reactions, switch "Agent notifications" on, and read
the "Listener port" back to you. Ask them to open Settings → Proactive and switch
"Scheduled greeting" on. Ask them to restart YUI, since both fields take effect at launch.

Once they report the restart, run the check yourself:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -X POST "$YUI_SIGNALS_URL/signals" \
  -H 'content-type: application/json' --data '{"signals":[]}'
```

Check: the command prints `200`. From another machine, reach the port through an SSH
reverse tunnel first.

## 2. Register the runtime skill in your skill store

Add `$YUI/integrations/daily-assist/skills/yui-daily-briefing` to the place you load your
own skills from. The plugin directory `$YUI/integrations/daily-assist` follows the Agent
Plugins layout (`plugin.json` beside `skills/<name>/SKILL.md`), and the repository lists it
in `$YUI/.claude-plugin/marketplace.json` and `$YUI/.agents/plugins/marketplace.json`.
Take the route your tool offers: a skills directory setting, a plugin install from one of
those marketplace files, or a copy of the skill directory.

Check: your own skill list shows `yui-daily-briefing`.

## 3. Post a fixture

Run `$YUI/integrations/daily-assist/skills/yui-daily-briefing-setup/scripts/post-fixture.sh`.
It posts `assets/fixtures/daily-briefing.json` by default and reads `YUI_SIGNALS_URL` from
the environment. A fixture path as its one argument posts that file:

```bash
SKILL_DIR="$YUI/integrations/daily-assist/skills/yui-daily-briefing-setup"
"$SKILL_DIR/scripts/post-fixture.sh" "$SKILL_DIR/assets/fixtures/daily-briefing-empty.json"
```

The turn log lives at `$YUI/logs/turns_<date>.jsonl` in a dev run and at
`~/Library/Logs/com.yui.desktop/turns_<date>.jsonl` in a macOS release build.

Check: the script prints `200`, the turn log gains one line whose
`client_context.trigger.signals[0].items[0].skill` reads `yui-daily-briefing`, and the
bubble shows a link. That line's `event_name` reads `signals.push` while the user is
present and the pipeline idle, and reads `signals.catchup`,
`time_milestone.first_activity`, or `proactive.tap_bored` otherwise. Posting the empty
fixture yields a turn line and silence.

## 4. Choose sources

With the user, list each source the producer reads, giving its `name` and the rule that
yields `ok`, `stale`, `failed`, and `disabled`. A source the user switches off on this
machine is listed with the rule `disabled`, so its absence is told apart from a missed
run.

Check: every source has a rule that names a time bound or an error condition. Post
`assets/fixtures/daily-briefing-sources-down.json` with `post-fixture.sh` and confirm the
speech names all three sources — `failed`, `stale` with its `last_ok`, and `disabled` —
in one sentence ahead of anything else.

## 5. Implement the producer

Build the producer to `references/producer-contract.md`.

With n8n: import `references/n8n-daily-briefing.template.json` into the user's n8n, fill
the two placeholders `{{YUI_SIGNALS_URL}}` and `{{SIGNAL_QUEUE_TABLE_ID}}`, and set
`triggerAtHour` on the `Run Every Morning` node to an hour ahead of the user's usual first
activity. The template ships `7`. Edit the `SOURCES` list and `STALE_HOURS` at the top of
the `Compose Daily Briefing` node so they match the source list from step 4, since a source
missing from `SOURCES` stays out of `sources[]`. `sources[]` holds at most 10 entries, and
each `name` runs to 40 characters at most.

With another tool: build the same request.

Check: trigger a manual run against a stopped YUI, which ends on the `Leave Rows Pending`
node and leaves every row as it was. Trigger a second manual run against a running YUI,
which ends on `Mark Row Sent`, and the turn log gains the line from step 3.

## 6. Wire the error workflow

Import `references/n8n-daily-briefing-health.template.json` into the user's n8n and fill
the placeholder `{{YUI_SIGNALS_URL}}`. Open the `daily-briefing` workflow's Settings and
pick the imported workflow as its Error Workflow. The template runs only when a
daily-briefing execution raises, and it posts nothing when YUI itself is offline. A
manual run of the daily-briefing workflow never fires the error workflow — n8n's Error
Trigger only fires for automatic executions — which is why the check below posts the
fixture directly.

Check: post `assets/fixtures/source-health-run-failed.json` with `post-fixture.sh`; the
turn log gains one line whose
`client_context.trigger.signals[0].items[0].sources[0].status` reads `failed`, and the
bubble names the workflow with a link.

## 7. Watch one morning

The producer runs ahead of the user's first activity. The group waits in the away buffer,
and the first present tick fires the turn that carries it.

Check, the following morning: the turn log shows one line carrying the group with
`event_id` `daily-briefing:<today>`, and the bubble shows a link.
