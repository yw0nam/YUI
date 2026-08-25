# yui-desire

`yui-desire` is the Hermes-side desire system for Natsume. Its `llm_request` middleware injects a compact
`<desire_state>` block into the newest user message, while the monitor advances drives and wakes a Hermes cron
turn only when its one-line summary changes. Wants, judgment, feedback handling, and speech decisions remain in
Hermes; YUI receives desire speech through its existing `/signals` ingress.

The integration is a self-contained Python 3.10+ uv project. Runtime code uses only the Python standard library.

## State

State lives in `DESIRE_STATE_DIR` when set. Otherwise it resolves to
`~/.hermes/profiles/$HERMES_PROFILE/desire/`, with `HERMES_PROFILE` defaulting to `natsume2`.

The state directory contains:

- `drives.json` — curiosity and accomplishment levels and anchors, plus the latest interaction time and hash.
  Fresh state starts both stored drives at `50.0`, anchored at bootstrap time. The interaction time also starts at
  bootstrap time and its hash starts as `null`. Social drive is derived from the interaction time and is not stored.
- `wants.md` — Natsume's own prose record of 3–5 open wants, progress, feedback, and completed or abandoned wants.
  Integration code never parses this file.
- `outbox.jsonl` — desire notes blocked by a daily budget or signal-delivery error. Fresh state is empty.
- `budget.json` — KST daily counters for signals, issues, and self-initiated comments, plus pending issue/comment
  reservations. Fresh counters are zero and `pending` is empty.
- `cursor.json` — the feedback cursor. `last_feedback_check_at` starts at bootstrap time.
- `audit.jsonl` — append-only action and recovery events. Fresh state is empty.
- `state.lock` — the process lock used for state transactions.

JSON state writes are atomic and all state mutations and JSONL appends are lock-protected. Corrupt JSON state files
are renamed with a `.corrupt-<timestamp>` suffix and bootstrapped again. Malformed JSONL lines are skipped; the
monitor removes malformed outbox lines and records the count in the audit log. Timestamps are timezone-aware and
stored in Asia/Seoul time.

An outbox item remains active until 15 minutes after it is surfaced. Surfacing means the item was submitted in a
provider payload; if the provider call then fails, the item can still expire without reaching the model. Version 1
does not compensate for that case.

The middleware keeps one in-process turn-cache entry, with a sliding 10-minute expiry, to make repeated provider
calls within a turn byte-stable. Interleaved concurrent sessions can evict that entry and lose only the byte-stability
optimization. Distinct turns with byte-identical newest-user text can share an entry; YUI's per-turn `time:` line
normally makes those texts distinct. The state commit phase writes interaction state, then outbox surfacing stamps,
then the in-memory cache. A process crash during that phase can leave a partial commit; version 1 does not journal or
roll it back.

## Install

The install procedure is also packaged as a Hermes skill at `skills/yui-desire-install/SKILL.md`. Registering the
`skills/` directory in the profile `config.yaml` makes the agent able to run the install itself:

```yaml
skills:
  external_dirs:
    - <abs>/integrations/hermes/desire/skills
```

On the Hermes host, clone the YUI repository and link the plugin directory into the Hermes plugin directory:

```bash
ln -s <abs>/integrations/hermes/desire ~/.hermes/plugins/yui-desire
hermes -p "$HERMES_PROFILE" plugins enable yui-desire
```

Set the deployment environment for the plugin, cron jobs, monitor, and helper commands:

```bash
export HERMES_PROFILE=natsume2
export DESIRE_STATE_DIR="$HOME/.hermes/profiles/$HERMES_PROFILE/desire"
```

`DESIRE_STATE_DIR` is optional when the default profile path is appropriate. `YUI_SIGNALS_URL` defaults to
`http://127.0.0.1:8770/signals`, which assumes Hermes and YUI share a host. The `/signals` ingress listens only while
AgentNotify is enabled in YUI's quick controls, and toggling AgentNotify requires an app restart. When Hermes runs on
a remote host, such as when it reaches YUI through an SSH reverse tunnel, `YUI_SIGNALS_URL` must be set to the tunnel
endpoint.

Hermes monitor scripts live under `~/.hermes/scripts/`, and Hermes resolves symlinks before checking that a monitor
script stays inside that directory, so a symlink into the YUI checkout is rejected. Install the monitor as a real file
that execs `decay_monitor.py` by absolute path:

```bash
printf '#!/bin/sh\nexec python3 <abs>/integrations/hermes/desire/decay_monitor.py\n' \
  > ~/.hermes/scripts/natsume-desire-monitor.sh
chmod +x ~/.hermes/scripts/natsume-desire-monitor.sh
```

`scripts/natsume-desire-monitor.sh` in the checkout is self-locating and serves direct execution from the repository.

Create the tick and weekly reflection jobs with these commands:

```bash
hermes -p "$HERMES_PROFILE" cron create "30m" --name natsume-desire-tick \
  --monitor-script natsume-desire-monitor.sh \
  "Follow the instructions in <abs>/integrations/hermes/desire/prompts/tick.md."
hermes -p "$HERMES_PROFILE" cron create "0 23 * * 0" --name natsume-desire-reflection \
  "Follow the instructions in <abs>/integrations/hermes/desire/prompts/reflection.md."
```

Hermes injects a changed monitor summary into the tick prompt. An unchanged summary suppresses the run. Run the
one-time instructions in `prompts/kickoff.md` after installation to create the initial wants without speaking.

## Action budgets

`act.py` enforces caps that reset at KST midnight: three signals, two YUI issues, and one self-initiated comment.
Replies to Youngwoo's comments are not routed through this helper and are uncapped. Signal reservations are
refunded after a delivery failure and the blocked note enters the outbox. Issue and comment actions use reserve,
commit, and release commands so external `gh` calls do not hold the state lock. Pending reservations survive
midnight; the monitor prunes reservations older than seven days.

## Verify

```bash
cd integrations/hermes/desire
uv run pytest
uv run ruff format --check .
uv run ruff check .
```

With `logging.level: DEBUG` in the Hermes profile `config.yaml`, every middleware pass writes one
`yui-desire llm_request …` line to `~/.hermes/logs/agent.log` carrying only outcome, skip reason, trigger
class, request shape, cache-hit status, and the Hermes request/turn/session ids — never the desire block,
drive levels, or user text.
