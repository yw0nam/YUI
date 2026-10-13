---
name: yui-desire-install
description: "Install, update, move from the monitor to the gate, or verify the yui-desire plugin (the agent's desire system) on this Hermes host: plugin link, env, gate script, workspace clones, tick, reflection and report crons, kickoff."
version: 0.2.0
author: yw0nam
platforms: [linux, macos]
prerequisites:
  commands: [git, python3, hermes, gh]
metadata:
  hermes:
    tags: [yui, desire, install, cron]
---

# yui-desire install

Installs the desire system that lives in the YUI repository at `integrations/hermes/desire/`.
Run every step in order; each step ends with a check. Never copy the plugin out of the checkout:
the plugin directory and prompts are read from the repository, so `git pull` updates them in place.

Replace `$YUI` below with the absolute path of the YUI checkout, `<profile>` with the Hermes profile name, and
`<agent>` with the agent's own slug, one short lowercase word, the name every desire convention derives from.
Every `hermes` command takes `-p <profile>`; without it the CLI acts on the global `~/.hermes` store.

## When to use

- First-time install of the desire system for this profile.
- After `git pull` in the YUI checkout, to confirm nothing on the host went stale (steps 4–9).
- A profile whose tick job still runs the monitor script (`Monitor:` in `hermes cron list`): steps 2b, 3 and 4,
  then the "Moving from the monitor" part of step 6, right after the pull, since the monitor script the job names
  is gone from the checkout and Hermes alerts on every tick until the job is edited.
- When the tick cron stops running or `<desire_state>` stops appearing in requests (step 8).

For the default profile, `~/.hermes/profiles/<profile>/` below stands for `~/.hermes/`.

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

Check: `hermes -p <profile> plugins list` shows `yui-desire` enabled. The list is configuration state only and does not
prove the plugin loaded; the load check is step 9, after the gateway restarts. Do not grant the plugin built-in tool
override permission; the middleware needs none.

## 2b. Skills directory

The tick and the reflection load the `yui-desire` skill by name. Register the checkout's `skills/` directory in
the profile `config.yaml`:

```yaml
skills:
  external_dirs:
    - $YUI/integrations/hermes/desire/skills
```

Check: `hermes -p <profile> skills list` names `yui-desire` and `yui-desire-install`.

## 3. Environment

Append to the profile `.env` (`~/.hermes/profiles/<profile>/.env`, or `~/.hermes/.env` for the default profile):

```
DESIRE_AGENT_NAME=<agent>
DESIRE_STATE_DIR=<home>/.hermes/profiles/<profile>/desire
YUI_SIGNALS_URL=http://127.0.0.1:8770/signals
DESIRE_CHAT_PLATFORMS=<the chat platforms the user speaks to the agent on>
```

`DESIRE_AGENT_NAME` and `DESIRE_CHAT_PLATFORMS` are required: without `DESIRE_AGENT_NAME` the gate and the helper
stop with an error naming it, and without either the middleware injects nothing. `DESIRE_STATE_DIR` is optional:
without it, state lives in `desire/` under the profile directory. The plugin reads these settings per profile, so
a gateway that serves several profiles from one process gives each profile its own values.

The helper runs in the agent's terminal and the gate runs as a cron subprocess; Hermes forwards a profile `.env`
value to either only for the names the profile's `config.yaml` lists under `terminal.env_passthrough`. Add the
three they read:

```yaml
terminal:
  env_passthrough:
    - DESIRE_AGENT_NAME
    - DESIRE_STATE_DIR
    - YUI_SIGNALS_URL
```

`DESIRE_CHAT_PLATFORMS` is a comma-separated list of Hermes platform names (`telegram`, `discord`, `slack`, …); a
turn from one of them counts as the user speaking even when it carries no `<client_context>`.

`YUI_SIGNALS_URL` must point at YUI's `/signals` ingress. When YUI runs on another machine and reaches this host
through an SSH reverse tunnel, use the tunnel endpoint instead of port 8770. Check: `grep DESIRE_STATE_DIR` on the
`.env` file prints the line.

## 4. Gate script (a real file)

A profile's pre-run scripts live under `~/.hermes/profiles/<profile>/scripts/`. Hermes resolves symlinks before
checking that a script stays under that directory, so a symlink into the checkout is rejected as an escape. Write
a real file that execs the repository script by absolute path:

```bash
mkdir -p ~/.hermes/profiles/<profile>/scripts
printf '#!/bin/sh\nexec python3 %s/integrations/hermes/desire/gate.py\n' "$YUI" \
  > ~/.hermes/profiles/<profile>/scripts/<agent>-desire-gate.sh
chmod +x ~/.hermes/profiles/<profile>/scripts/<agent>-desire-gate.sh
set -a; . ~/.hermes/profiles/<profile>/.env; set +a
~/.hermes/profiles/<profile>/scripts/<agent>-desire-gate.sh
```

Run the last line on a fresh install only: on a profile that already holds notes it prints a wake line and stamps
the notes as presented, which keeps the cron from waking for them for six hours. On a migrating profile, skip it
and read the state directory after the first cron run instead.

Check: the last command prints `{"wakeAgent": false}` (nothing waits on a fresh state) and

```bash
ls "$DESIRE_STATE_DIR"
```

lists `drives.json`, `budget.json`, `transport.json`, `artefacts.json`, `gate.json`, `feelings.json`,
`outbox.jsonl`, `audit.jsonl`, and `state.lock`. If it is empty or missing, the gate could not write there; fix
`DESIRE_STATE_DIR` before continuing. `grep gate_error "$DESIRE_STATE_DIR/audit.jsonl"` finds nothing.

That first run records the pull requests and issues that already exist as seen without filing an event; only what
changes after it becomes an event. A profile that ran the monitor before keeps `wants.md`, `audit.jsonl`,
`outbox.jsonl`, `budget.json`, `transport.json` and `artefacts.json`; `drives.json` keeps its stamps; the gate
deletes `monitor.json`, `ticks.jsonl` and `cursor.json`; `events.jsonl`, `readings.jsonl` and `judgments.jsonl`
start empty.

## 5. Workspace clones

The agent works in every repository cloned under the profile workspace, and the gate reads each of them for the
agent's issues and pull requests, their closing and merging, and comments by others on them. Clone the
repositories the user wants the agent to work in, and create the `from-<agent>` label in each one the user's own
GitHub account owns:

```bash
gh auth status
mkdir -p ~/.hermes/profiles/<profile>/workspace
cd ~/.hermes/profiles/<profile>/workspace
gh repo clone <owner>/<repo>
gh label create from-<agent> --repo <owner>/<repo>
```

Check: `gh auth status` reports a logged-in account with `repo` scope, every clone exists in the workspace, and
`gh label list --repo <owner>/<repo>` shows `from-<agent>` for each repository that account owns. A label that
already exists makes `gh label create` exit non-zero; that is fine. The gate runs `gh` as the gateway user, so
that user's `gh auth status` is the one that counts; on a gateway serving several profiles, a `GH_TOKEN` in the
profile `.env` reaches the gate only when `env_passthrough` lists it.

## 6. Cron jobs

The tick and the report are delivered to the user over a channel the profile is connected to; `<target>` below is
the Hermes delivery target for it, such as `telegram:<chat_id>`. Read the channels and their ids from the profile
channel directory:

```bash
python3 -c "import json,os;d=json.load(open(os.path.expanduser('~/.hermes/profiles/<profile>/channel_directory.json')));print({p:[(c['id'],c['type']) for c in v] for p,v in d['platforms'].items()})"
```

```bash
hermes -p <profile> cron create "every 10m" --name <agent>-desire-tick \
  --script <agent>-desire-gate.sh \
  --deliver <target> \
  "Follow the instructions in $YUI/integrations/hermes/desire/prompts/tick.md. The configured environment is DESIRE_STATE_DIR=<state_dir> and YUI_SIGNALS_URL=<signals_url>, on Hermes profile <profile>."
hermes -p <profile> cron create "0 23 * * 0" --name <agent>-desire-reflection \
  "Follow the instructions in $YUI/integrations/hermes/desire/prompts/reflection.md. The configured environment is DESIRE_STATE_DIR=<state_dir> and YUI_SIGNALS_URL=<signals_url>, on Hermes profile <profile>."
hermes -p <profile> cron create "0 21 * * *" --name <agent>-desire-report \
  --deliver <target> \
  "Follow the instructions in $YUI/integrations/hermes/desire/prompts/report.md. The configured environment is DESIRE_STATE_DIR=<state_dir> and YUI_SIGNALS_URL=<signals_url>, on Hermes profile <profile>."
```

The job prompt is the file reference followed by the two values from step 3 and the profile name, nothing else;
the prompt file is the only place the job's behaviour is written.

Moving from the monitor: a tick job created with `--monitor-script` keeps its schedule and delivery target and
takes the gate with one command. Read its id from the job list:

```bash
hermes -p <profile> cron list
hermes -p <profile> cron edit <job_id> --script <agent>-desire-gate.sh --monitor-script ""
rm -f ~/.hermes/profiles/<profile>/scripts/<agent>-desire-monitor.sh
```

A job that already exists also keeps its own schedule and delivery target when those need changing:

```bash
hermes -p <profile> cron edit <job_id> --schedule "every 10m"
hermes -p <profile> cron edit <job_id> --deliver <target>
```

The schedule keeps the `every` prefix: a bare `10m` runs the job once, ten minutes later.

The tick wakes a turn only when the gate prints a wake line: events wait for the agent's reading, or a held note
can be delivered. Check: `hermes -p <profile> cron list` shows the three jobs, the tick one with
`Script: <agent>-desire-gate.sh` and no `Monitor:`, and the tick and report ones with `Deliver: <target>`.
Without `-p`, `hermes cron list` reads the global store and does not show profile jobs. After the first
10 minutes, the tick job's `last_status` in `~/.hermes/profiles/<profile>/cron/jobs.json` is `ok`.

## 7. Kickoff (once)

Read `$YUI/integrations/hermes/desire/prompts/kickoff.md` and follow it: write the initial wants into
`$DESIRE_STATE_DIR/wants.md` without speaking to the user.

Check: `wants.md` exists and lists the wants.

## 8. Verify injection

Send yourself a normal YUI user-message turn, then confirm the middleware ran. With `logging.level: DEBUG` in the
profile `config.yaml`, `~/.hermes/profiles/<profile>/logs/agent.log` gains one line per pass:

```
yui-desire llm_request plugin=yui-desire/0.1.0 outcome=injected reason=None interaction=True trigger=user message platform=… shape=messages/str cache_hit=False api_request_id=… turn_id=… session_id=…
```

`outcome=skipped reason=…` explains why a request was left alone; `outcome=error reason=<ExceptionClass>` means the
plugin failed open.
The line never contains the desire block, want text, or user content.

## 9. Gateway restart (plugin code changed)

The gateway process imports the middleware, so a pull that touches `__init__.py` or any `desire_*.py` module takes effect
only after a restart. Prompts, the gate script, and `act.py` run as subprocesses and need none. The restart ends
every running turn, including the one that issues it, so answer first and issue it detached:

```bash
setsid nohup sh -c 'sleep 30; hermes -p <profile> gateway restart' >/dev/null 2>&1 &
```

Check: `~/.hermes/profiles/<profile>/logs/gateway.log` gains `api_server connected` after the restart. Then compare the last
failure line with the time of the restart:
`grep -n "Failed to load plugin 'yui-desire'" ~/.hermes/profiles/<profile>/logs/agent.log | tail -1`.
A line dated after the restart means the load failed, and the reason follows the colon. With `HERMES_PLUGINS_DEBUG=1` set
as an environment variable of the process that runs the gateway, the traceback follows the warning.

## Helper commands

`python3 $YUI/integrations/hermes/desire/act.py --help` lists the actions the prompts use: `feel`, `correct`,
`retract`, `judge`, `how`, `signal`, `issue`, `comment`, `pr`, `report`, `outbox`. Daily caps, reset at KST
midnight: three signals, two issues, one self-initiated comment, zero pull requests (the agent opens none).
`report --note` carries the daily report to YUI and has no budget. The `yui-desire` skill beside this one is the
agent-facing description of the recording commands.

## Tests (optional, needs uv)

```bash
cd $YUI/integrations/hermes/desire && uv run pytest && uv run ruff check .
```
