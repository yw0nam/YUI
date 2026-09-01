---
name: yui-desire-install
description: "Install, update, or verify the yui-desire plugin (Natsume's desire system) on this Hermes host: plugin link, env, monitor script, tick and reflection crons, kickoff."
version: 0.1.0
author: yw0nam
platforms: [linux, macos]
prerequisites:
  commands: [git, python3, hermes]
metadata:
  hermes:
    tags: [yui, desire, natsume, install, cron]
---

# yui-desire install

Installs the desire system that lives in the YUI repository at `integrations/hermes/desire/`.
Run every step in order; each step ends with a check. Never copy the plugin out of the checkout —
the plugin directory and prompts are read from the repository, so `git pull` updates them in place.

Replace `$YUI` below with the absolute path of the YUI checkout (for example
`/home/spow12/codes/2026_upper/agents/YUI`) and `<profile>` with the Hermes profile name (for example `natsume2`).
Every `hermes` command takes `-p <profile>`; without it the CLI acts on the global `~/.hermes` store.

## When to use

- First-time install of the desire system for this profile.
- After `git pull` in the YUI checkout, to confirm nothing on the host went stale (steps 5–7 only).
- When the tick cron stops running or `<desire_state>` stops appearing in requests (step 7).

## 1. Checkout

```bash
cd $YUI && git pull --ff-only && git log -1 --oneline
```

Check: the pull fast-forwards and `integrations/hermes/desire/plugin.yaml` exists.

## 2. Plugin link and enable

```bash
ln -sfn $YUI/integrations/hermes/desire ~/.hermes/plugins/yui-desire
hermes -p <profile> plugins enable yui-desire
```

Check: `hermes -p <profile> plugins list` shows `yui-desire` enabled. Do not grant the plugin built-in tool
override permission; the middleware needs none.

## 3. Environment

Append to the profile `.env` (`~/.hermes/profiles/<profile>/.env`, or `~/.hermes/.env` for the default profile):

```
HERMES_PROFILE=<profile>
DESIRE_STATE_DIR=/home/<user>/.hermes/profiles/<profile>/desire
YUI_SIGNALS_URL=http://127.0.0.1:8770/signals
```

`YUI_SIGNALS_URL` must point at YUI's `/signals` ingress. When YUI runs on another machine and reaches this host
through an SSH reverse tunnel, use the tunnel endpoint instead of port 8770. Check: `grep DESIRE_STATE_DIR` on the
`.env` file prints the line.

## 4. Monitor script (real file, not a symlink)

Hermes resolves symlinks before checking that a monitor script stays under `~/.hermes/scripts/`; a symlink into
the checkout is rejected as an escape. Write a real file that execs the repository script by absolute path:

```bash
printf '#!/bin/sh\nexec python3 %s/integrations/hermes/desire/decay_monitor.py\n' "$YUI" \
  > ~/.hermes/scripts/natsume-desire-monitor.sh
chmod +x ~/.hermes/scripts/natsume-desire-monitor.sh
~/.hermes/scripts/natsume-desire-monitor.sh
```

Check: the last command prints one summary line (for example
`social:low curiosity:mid accomplishment:mid outbox:0 transport:up budget:3/3sig 2/2iss 1/1cmt day:2026-09-01`).
The monitor checks transport with an HTTP GET to `YUI_SIGNALS_URL`; any HTTP response counts as up. A
`transport:down` line without a `day:` token is the monitor's fail-safe fallback, so such a line proves nothing
on its own. The real check is the state directory it bootstraps:

```bash
ls "$DESIRE_STATE_DIR"
```

must list `drives.json`, `budget.json`, `cursor.json`, `transport.json`, `outbox.jsonl`, `audit.jsonl`,
and `state.lock`. If it is
empty or missing, the monitor could not write there — fix `DESIRE_STATE_DIR` before continuing.

## 5. Cron jobs

```bash
hermes -p <profile> cron create "10m" --name natsume-desire-tick \
  --monitor-script natsume-desire-monitor.sh \
  "Follow the instructions in $YUI/integrations/hermes/desire/prompts/tick.md."
hermes -p <profile> cron create "0 23 * * 0" --name natsume-desire-reflection \
  "Follow the instructions in $YUI/integrations/hermes/desire/prompts/reflection.md."
```

The job prompt is the file reference and the three environment values (`HERMES_PROFILE`, `DESIRE_STATE_DIR`,
`YUI_SIGNALS_URL`), nothing else; the prompt file is the only place the tick's behaviour is written.

A job that already exists keeps its own schedule. Read its id from the job list and set the schedule on it:

```bash
hermes -p <profile> cron list
hermes -p <profile> cron edit <job_id> --schedule 10m
```

The tick only wakes a turn when the monitor's one-line summary changes; an unchanged summary suppresses the run.
Check: `hermes -p <profile> cron list` shows both jobs, the tick one with `Monitor: natsume-desire-monitor.sh`.
Without `-p`, `hermes cron list` reads the global store and does not show profile jobs. After the first
10 minutes, the tick job's `last_status` in `~/.hermes/profiles/<profile>/cron/jobs.json` is `ok`.

## 6. Kickoff (once)

Read `$YUI/integrations/hermes/desire/prompts/kickoff.md` and follow it: write 3–5 initial wants into
`$DESIRE_STATE_DIR/wants.md` without speaking to the user.

Check: `wants.md` exists and lists the wants.

## 7. Verify injection

Send yourself a normal YUI user-message turn, then confirm the middleware ran. With `logging.level: DEBUG` in the
profile `config.yaml`, `~/.hermes/logs/agent.log` gains one line per pass:

```
yui-desire llm_request plugin=yui-desire/0.1.0 outcome=injected reason=None interaction=True shape=messages/str cache_hit=False api_request_id=… turn_id=… session_id=…
```

`outcome=skipped reason=…` explains why a request was left alone; `outcome=error reason=<ExceptionClass>` means the
plugin failed open.
The line never contains the desire block, drive levels, want text, or user content.

## Helper commands

`python3 $YUI/integrations/hermes/desire/act.py --help` lists the actions the prompts use: `signal`, `issue`,
`comment`, `satisfy`, `feedback`, `outbox`. Daily caps, reset at KST midnight: three signals, two issues, one
self-initiated comment, and the four `satisfy` events (`learned` 6, `progressed` 6, `shipped` 4, `praised` 4 — see
the README's Action budgets table for their drive doses).

## Tests (optional, needs uv)

```bash
cd $YUI/integrations/hermes/desire && uv run pytest && uv run ruff check .
```
