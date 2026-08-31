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
- `outbox.jsonl` — pent-up desire notes blocked by a daily budget or signal-delivery error. An item persists here,
  and in the pent-up section of the desire block, until it is delivered (`act.py outbox --send`), released
  (`act.py outbox --release`), or expires 48 hours after `created_at`. Each item carries `attempts`, the number of
  failed deliveries so far, and `last_failed_at`. A failed resend updates the item in place and keeps its
  `created_at`. Fresh state is empty.
- `transport.json` — whether the YUI signals ingress is reachable: `state` (`up` or `down`), `since` (when the
  current state began), `failed` (consecutive failures, zero while up), and `last_checked_at`. The monitor
  refreshes it every tick with a TCP connect to the `YUI_SIGNALS_URL` host and port, and every signal delivery
  outcome updates it too. Absent until the first tick or delivery.
- `budget.json` — KST daily counters for signals, issues, self-initiated comments, and satisfaction events, plus
  pending issue/comment reservations. Fresh counters are zero and `pending` is empty.
- `cursor.json` — the feedback cursor. `last_feedback_check_at` starts at bootstrap time.
- `audit.jsonl` — append-only action and recovery events. Fresh state is empty.
- `state.lock` — the process lock used for state transactions.

JSON state writes are atomic and all state mutations and JSONL appends are lock-protected. Corrupt JSON state files
are renamed with a `.corrupt-<timestamp>` suffix and bootstrapped again. Malformed JSONL lines are skipped; the
monitor removes malformed outbox lines and records the count in the audit log. Timestamps are timezone-aware and
stored in Asia/Seoul time.

An outbox item stays pent-up across every tick until Natsume explicitly releases it (`act.py outbox --release`) or it
ages past the 48-hour hard expiry, which the monitor enforces. Surfacing (the item was submitted in a provider
payload) stamps `surfaced_at` once for record-keeping, but no longer retires the item on its own; if the provider call
then fails, the note simply stays pent-up like any other unreleased item.

The desire block opens with the drive levels, then `last interaction: YYYY-MM-DD HH:MM (Nh ago)` from the
interaction time in `drives.json`, then `signal transport: up`, `signal transport: down since YYYY-MM-DD HH:MM
(N failed)`, or `signal transport: unknown` when `transport.json` is absent. Pent-up lines use
`- [YYYY-MM-DD HH:MM] <note>` while fresh, add `(waited Nh, heavy)` once the note is at least six hours old, use
`(waited Nh, bursting)` once it is at least 18 hours old, and end with `(attempts N)` from the second failed
delivery on.

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

The job prompt is the file reference and the three environment values (`HERMES_PROFILE`, `DESIRE_STATE_DIR`,
`YUI_SIGNALS_URL`), nothing else; the prompt file is the only place the tick's behaviour is written.

Hermes injects a changed monitor summary into the tick prompt. An unchanged summary suppresses the run. The
summary is one line:

```text
social:<bucket> curiosity:<bucket> accomplishment:<bucket> outbox:<n>[/<stage>] transport:<up|down> budget:<s>/3sig <i>/2iss <c>/1cmt
```

Buckets are `low` (below 40), `mid` (below 70), and `high`. `<stage>` is the stage of the oldest active pent-up
note (`fresh`, `heavy`, `bursting`) and is omitted when the outbox is empty. `transport` is the probe result of
that tick. The line therefore changes, and the tick runs, when a bucket flips, when the oldest note crosses six or
18 hours or expires, when the YUI ingress becomes reachable or unreachable, and when a used budget resets at
midnight. Run the one-time instructions in `prompts/kickoff.md` after installation to create the initial wants
without speaking.

## Action budgets

`act.py` enforces caps that reset at KST midnight: three signals, two YUI issues, and one self-initiated comment.
Replies to Youngwoo's comments are not routed through this helper and are uncapped. `signal --note` posts a new
note; `outbox --send <id>` posts an existing pent-up note and shares the same budget. Signal reservations are
refunded after a delivery failure; a failed new note enters the outbox with `attempts` 1, and a failed resend
increments the existing item's `attempts` instead of adding another item. `outbox --list` shows only active
(unexpired) items and `--send` accepts only their ids. `outbox --send` exits 0 after delivery, 1 when
blocked or failed, and 3 for an unknown id; `outbox --release` also exits 3 for an unknown id. Issue and comment actions use reserve,
commit, and release commands so external `gh` calls do not hold the state lock. Pending reservations survive
midnight; the monitor prunes reservations older than seven days.

Drives rise linearly while unattended: curiosity 9 points per hour, accomplishment 6 per hour, and social 15 per
hour since the last user message. These observation-phase rates and the caps below are deliberately fast so a full
hunger cycle fits in roughly eight hours and every tick day produces telemetry.

Satisfaction uses fixed event doses and KST daily caps:

| Event | Applies when | Drive dose | Daily cap |
| --- | --- | --- | ---: |
| `learned` | Something genuinely new is learned from reading or exploring | curiosity −30 | 6 |
| `progressed` | One concrete step on an open want is completed | accomplishment −15 | 6 |
| `shipped` | A fix, merge, or artifact is delivered | accomplishment −40 | 4 |
| `praised` | Youngwoo gives positive feedback | accomplishment −25 | 4 |

The homeostatic reward is `r = D(before) - D(after)`, where
`D(levels) = sqrt(sum((level_i / 100)^4 for i in levels))` over social, curiosity, and accomplishment.

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
