# yui-desire

`yui-desire` is the Hermes-side desire system for an autonomous agent. Its `llm_request` middleware injects a
compact `<desire_state>` block into the newest user message, while the monitor advances drives, scores the
artefacts the agent produced outside the state directory, and wakes a Hermes cron turn only when its one-line
summary changes. Wants, judgment, feedback handling, and speech decisions remain in Hermes; YUI receives desire
speech through its existing `/signals` ingress.

The integration is a self-contained Python 3.10+ uv project. Runtime code uses only the Python standard library.

## Identity

`DESIRE_AGENT_NAME` names the agent — one short lowercase slug — and every convention derives from it: the
branch prefix `<agent>/`, the issue marker `<!-- from-<agent> -->`, the issue label `from-<agent>`, the
signal source `<agent>-desire`, and the cron job names `<agent>-desire-tick`, `<agent>-desire-reflection`, and
`<agent>-desire-report`. `HERMES_PROFILE` names the Hermes profile the agent runs on, and
`DESIRE_CHAT_PLATFORMS` names the channels the user speaks to the agent on. All three are required and
have no default: the monitor and the helper stop with an error naming the missing variable, and the middleware
injects nothing and logs one. The desire block opens with the line `agent: <agent>` so the prompts can refer to
it.

## State

State lives in `DESIRE_STATE_DIR` when set. Otherwise it resolves to
`~/.hermes/profiles/$HERMES_PROFILE/desire/`.

The state directory contains:

- `drives.json` — curiosity and accomplishment levels and anchors, plus the latest interaction time and hash and
  the signal stamps `last_signal_at` (the last delivered signal) and `last_signal_answered_at` (the first user turn
  after it). Fresh state starts both stored drives at `50.0`, anchored at bootstrap time. The interaction time also
  starts at bootstrap time, and its hash and both signal stamps start as `null`. Social drive is derived from the
  interaction time and is not stored.
- `wants.md` — the agent's own prose record of 3–5 open wants, progress, feedback, and completed or abandoned
  wants.
  Integration code never parses this file.
- `outbox.jsonl` — pent-up desire notes blocked by a daily budget or signal-delivery error. An item persists here,
  and in the pent-up section of the desire block, until it is delivered (`act.py outbox --send`), released
  (`act.py outbox --release`), or expires 48 hours after `created_at`. Each item carries `attempts`, the number of
  failed deliveries so far, and `last_failed_at`. A failed resend updates the item in place and keeps its
  `created_at`. A postponed item also carries `not_before`, the time it becomes visible again; it keeps ageing
  toward the same expiry while it is hidden. Fresh state is empty.
- `transport.json` — whether the YUI signals ingress is reachable: `state` (`up` or `down`), `since` (when the
  current state began), `failed` (consecutive failures, zero while up), `last_checked_at`, and `source`, which
  names what last wrote the record: `probe` for the monitor, `delivery` for a signal delivery, `user-turn` for a
  user message that reached Hermes through YUI. A return read off an already-`up` transport writes nothing, so
  `probe` stays. The monitor
  refreshes it every tick with an HTTP GET to `YUI_SIGNALS_URL`, treating any HTTP response as reachable, and every signal delivery
  outcome updates it too. Absent until the first tick or delivery.
- `budget.json` — KST daily counters for signals, issues, self-initiated comments, pull requests, dispatches, and
  satisfaction events, plus pending issue, comment, pull-request, and dispatch reservations. Fresh counters are
  zero and `pending` is empty.
- `artefacts.json` — what has already been scored: `bootstrapped_at` (when the record was created),
  `bootstrapped` (the sources that have answered at least once and are therefore scored from now on), `seen` (the
  refs the monitor has counted, one list per kind: pull-request and issue URLs, and skill paths),
  `skill_first_seen` (when each skill path was first seen, holding only the skills seen after the skill source was
  bootstrapped, so the report can tell the agent's own skills from the ones that were already installed),
  `shipped` (the refs it has counted as delivered), `learned` (the last 500 sources the agent has reported), and
  `unreported` (the events the desire block has not shown yet, each `{"event", "kind", "ref", "at"}`). Absent
  until the first tick or the first reported `learned`, whichever comes first; the tick writes it without dosing.
- `cursor.json` — the feedback cursor. `last_feedback_check_at` starts at bootstrap time.
- `monitor.json` — the buckets the monitor summary prints, the count of drive rises behind them, and how long
  each drive has stood at its ceiling: `latched` is the bucket printed for each drive, `natural` the bucket each
  drive actually stood in at the last tick, `rises` the running number of times a drive has climbed into a
  higher bucket, and `saturated_since` the time each drive reached 100, or `null` while it stands below. Fresh
  state latches the current buckets with `rises` zero and every drive unsaturated.
- `audit.jsonl` — append-only action and recovery events. Fresh state is empty.
- `ticks.jsonl` — one line per monitor tick, holding what the one-line summary discards: `at`, the three
  drive levels rounded to one decimal, `transport`, `outbox` (the visible pent-up count), and
  `last_interaction_at`. Fresh state is empty.
- `state.lock` — the process lock used for state transactions.

JSON state writes are atomic and all state mutations and JSONL appends are lock-protected. Corrupt JSON state files
are renamed with a `.corrupt-<timestamp>` suffix and bootstrapped again. Malformed JSONL lines are skipped; the
monitor removes malformed outbox lines and records the count in the audit log. Timestamps are timezone-aware and
stored in Asia/Seoul time.

An outbox item stays pent-up across every tick until the agent explicitly releases it (`act.py outbox --release`)
or it ages past the 48-hour hard expiry, which the monitor enforces. Surfacing (the item was submitted in a provider
payload) stamps `surfaced_at` once for record-keeping, but no longer retires the item on its own; if the provider call
then fails, the note simply stays pent-up like any other unreleased item.

The desire block opens with `agent: <agent>` and the drive levels, then
`last interaction: YYYY-MM-DD HH:MM (Nh ago)` from the interaction time in `drives.json`, then
`signal transport: up`, `signal transport: down since YYYY-MM-DD HH:MM (N failed)`, or
`signal transport: unknown` when `transport.json` is absent.

`returned: after Nh away` follows the interaction line on a user-message turn that is the
first one since the ingress was unreachable — the transport is `down`, or it is `up` with a `since` later than the
interaction time. That turn also records the transport as `up` with `source: user-turn`, and moves the interaction
time to itself whatever the gap, so the next turn is an ordinary one. The line ends with `(one held note fits
here)` while a pent-up note is waiting.

`since last turn: <event> <kind> <ref>; …` follows the transport line while `unreported` in `artefacts.json` is
non-empty. Pull requests, issues, and skills are listed one by one up to eight of them, then `and N more`. The
middleware clears `unreported` in the state commit of the turn that rendered the line, so it appears on exactly
one turn.

`last signal: YYYY-MM-DD HH:MM — answered after Nh` follows the transport line once a signal has been delivered and
a user turn has followed it; until then the same line reads `— no reply yet (Nh)`. The line is absent while
`last_signal_at` is `null`. Pent-up lines use
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
export DESIRE_AGENT_NAME=<agent>
export HERMES_PROFILE=<profile>
export DESIRE_STATE_DIR="$HOME/.hermes/profiles/$HERMES_PROFILE/desire"
export DESIRE_CHAT_PLATFORMS=<the Hermes chat platforms the user speaks to the agent on>
```

`DESIRE_AGENT_NAME`, `HERMES_PROFILE`, and `DESIRE_CHAT_PLATFORMS` are required; `DESIRE_STATE_DIR` is optional
when the default profile path is appropriate. `DESIRE_CHAT_PLATFORMS` is a comma-separated list of Hermes platform
names (`telegram`, `discord`, `slack`, …); a turn Hermes attributes to one of them counts as the user speaking
even when it carries no `<client_context>`.

`YUI_SIGNALS_URL` defaults to `http://127.0.0.1:8770/signals`, which assumes Hermes and YUI share a host. The
`/signals` ingress listens only while AgentNotify is enabled in YUI's quick controls, and toggling AgentNotify
requires an app restart. When Hermes runs on
a remote host, such as when it reaches YUI through an SSH reverse tunnel, `YUI_SIGNALS_URL` must be set to the tunnel
endpoint.

Hermes monitor scripts live under `~/.hermes/scripts/`, and Hermes resolves symlinks before checking that a monitor
script stays inside that directory, so a symlink into the YUI checkout is rejected. Install the monitor as a real file
that execs `decay_monitor.py` by absolute path:

```bash
printf '#!/bin/sh\nexec python3 <abs>/integrations/hermes/desire/decay_monitor.py\n' \
  > ~/.hermes/scripts/$DESIRE_AGENT_NAME-desire-monitor.sh
chmod +x ~/.hermes/scripts/$DESIRE_AGENT_NAME-desire-monitor.sh
```

`scripts/desire-monitor.sh` in the checkout is self-locating and serves direct execution from the repository.

Create the tick, weekly reflection, and daily report jobs with these commands, where `<target>` is a delivery
target Hermes accepts for a channel the profile is connected to, such as `telegram:<chat_id>` for a DM listed in
`~/.hermes/profiles/$HERMES_PROFILE/channel_directory.json`:

```bash
hermes -p "$HERMES_PROFILE" cron create "every 10m" --name "$DESIRE_AGENT_NAME-desire-tick" \
  --monitor-script "$DESIRE_AGENT_NAME-desire-monitor.sh" \
  --deliver <target> \
  "Follow the instructions in <abs>/integrations/hermes/desire/prompts/tick.md. The configured environment is HERMES_PROFILE=$HERMES_PROFILE, DESIRE_STATE_DIR=$DESIRE_STATE_DIR, and YUI_SIGNALS_URL=$YUI_SIGNALS_URL."
hermes -p "$HERMES_PROFILE" cron create "0 23 * * 0" --name "$DESIRE_AGENT_NAME-desire-reflection" \
  "Follow the instructions in <abs>/integrations/hermes/desire/prompts/reflection.md. The configured environment is HERMES_PROFILE=$HERMES_PROFILE, DESIRE_STATE_DIR=$DESIRE_STATE_DIR, and YUI_SIGNALS_URL=$YUI_SIGNALS_URL."
hermes -p "$HERMES_PROFILE" cron create "0 21 * * *" --name "$DESIRE_AGENT_NAME-desire-report" \
  --deliver <target> \
  "Follow the instructions in <abs>/integrations/hermes/desire/prompts/report.md. The configured environment is HERMES_PROFILE=$HERMES_PROFILE, DESIRE_STATE_DIR=$DESIRE_STATE_DIR, and YUI_SIGNALS_URL=$YUI_SIGNALS_URL."
```

`--deliver <target>` sends the tick and report responses there; `hermes -p "$HERMES_PROFILE" cron
edit <job_id> --deliver <target>` sets it on a job that already exists. Hermes delivers a failed run
whatever its response says, so a transient tick failure reaches the target even though a quiet tick answers
`[SILENT]`. The job prompt is the file reference followed by the three environment values, nothing else; the
prompt file is the only place a job's behaviour is written.

Hermes injects a changed monitor summary into the tick prompt. An unchanged summary suppresses the run. The
summary is one line:

```text
social:<bucket> curiosity:<bucket> accomplishment:<bucket> outbox:<n>[/<stage>] transport:<up|down> budget:<s>/3sig <i>/2iss <c>/1cmt <p>/1pr day:<YYYY-MM-DD> rises:<r> starved:<social>/<curiosity>/<accomplishment>
```

Buckets are `low` (below 40), `mid` (below 70), and `high`, and the three drive tokens print the latched buckets
from `monitor.json`. A drive that falls into a lower bucket keeps the token it had, so a drive the agent has just
satisfied leaves the whole line unchanged. A drive that stands in a higher bucket than it did at the previous tick
adds one to `<r>` and reprints all three tokens at their current buckets. `<n>` counts the visible pent-up notes
and `<stage>` is the stage of the oldest of them (`fresh`, `heavy`, `bursting`), omitted when none are visible; a
postponed note is in neither until its `not_before` passes. `transport` is the probe result of that tick. `day` is
the date of the current wake day, which rolls at 09:00 KST, and the fail-safe fallback line names it too.
`starved` counts, per drive, the whole three-hour periods that drive has stood at 100, and returns to zero for it
as soon as it leaves the ceiling; each drive keeps its own count so one drive leaving the ceiling cannot mask
another crossing a boundary on the same tick. The line therefore changes, and the tick runs, when a drive rises
into a higher bucket, when the oldest visible note crosses six or 18 hours or expires, when a postponed note
comes back, when the YUI ingress becomes reachable or unreachable, when a used budget resets at midnight, when a
drive has sat at 100 for another three hours, and once every morning. Run the one-time instructions in
`prompts/kickoff.md` after installation to create the initial wants without speaking.

## Action budgets

`act.py` enforces caps that reset at KST midnight: three signals, two issues, one self-initiated comment, one pull
request, and one dispatch. Replies to the user's comments are not routed through this helper and are uncapped.
`signal --note` posts a new note; `outbox --send <id>` posts an existing pent-up note and shares the same budget.
Signal reservations are refunded after a delivery failure; a failed new note enters the outbox with `attempts` 1,
and a failed resend increments the existing item's `attempts` instead of adding another item. `outbox --list`
shows only active (unexpired) items, marking a postponed one with `postponed_until`, so its id stays reachable
while it waits.
`--send` accepts only the ids the desire block shows. `outbox --send` exits 0 after delivery, 1 when blocked or
failed, and 3 for an unknown id.

One pent-up note takes one disposition: `outbox --repeat <id>` keeps it as it is, `outbox --reword <id> --note
"<text>"` replaces its text in place and keeps its `id`, `created_at`, and `attempts`, `outbox --postpone <id>
[--until <hours>]` hides it until then (default 24, from more than 0 up to 8760), and `outbox --release <id>`
drops it. All four take a required
`--why`, act on active items, append an `outbox_disposition` audit event, exit 2 when `--why` (or `--note` with
`--reword`) is missing, and exit 3 for an unknown id. Issue, comment, pull-request, and dispatch actions use
reserve, commit, and release commands so external `gh` and `claude` calls do not hold the state lock.
`<kind> --reserve` prints a reservation id and takes the slot, `<kind> --commit <id> --url <url>` audits
`issue_filed`, `self_comment_filed`, `pr_filed`, or `dispatch_started`, and `<kind> --release <id>` gives the slot
back. `dispatch --commit` also takes `--model <name>` and records it. Pending reservations survive midnight; the
monitor prunes reservations older than seven days.

`report --note "<text>"` posts the daily report to the same ingress, with `report` as the signal kind and
`desire.report` as the event type. It takes no budget, never enters the outbox, records the transport outcome
like a signal delivery, and audits `report_sent` or `report_failed`. `report --skills` sends nothing: it prints the
skill-load section described below on stdout.

Drives rise linearly while unattended: curiosity 9 points per hour, accomplishment 6 per hour, and social 15 per
hour since the last user message. These observation-phase rates and the caps below are deliberately fast so a full
hunger cycle fits in roughly eight hours and every tick day produces telemetry.

Satisfaction uses fixed event doses and KST daily caps. Two of the four events are derived by the monitor from
artefacts outside the state directory; `learned` and `praised` are self-reported, through
`act.py satisfy <event> --ref "<the source or what they said>"`. A `learned` naming a source already in
`artefacts.json` is refused and audited as `satisfy_repeated`, and costs no daily slot:

| Event | Applies when | Drive dose | Daily cap |
| --- | --- | --- | ---: |
| `learned` | The agent reports a source it read, with `act.py satisfy learned --ref <source>`, each source scoring once for good | curiosity −30 | 6 |
| `progressed` | The monitor first sees a pull request opened from an `<agent>/` branch, an issue whose body carries `<!-- from-<agent> -->`, or a skill directory under the profile | accomplishment −15 | 6 |
| `shipped` | The monitor sees one of those pull requests merged, or one of those issues closed | accomplishment −40 | 4 |
| `praised` | The agent reports positive feedback from the user | accomplishment −25 | 4 |

The homeostatic reward is `r = D(before) - D(after)`, where
`D(levels) = sqrt(sum((level_i / 100)^4 for i in levels))` over social, curiosity, and accomplishment.

## Derived events

Every tick the monitor reads three sources and doses each artefact it has not counted yet through
`desire_state.satisfy`. The sources are read before the tick takes the state lock, so a `gh` call never blocks a
turn; the scoring runs inside the same state transaction as the drive advance, before the summary line. Each
derived event is appended to `unreported` and audited as `drive_satisfied` with its `kind` (`pr`, `issue`,
`skill`) and `ref`.

- **Repositories** — every directory one level under `~/.hermes/profiles/$HERMES_PROFILE/workspace/` whose
  `.git/config` names an `origin` remote on github.com, in both the HTTPS and SSH forms. Two directories cloning the
  same repository count as one. A directory without such a remote is skipped, and so is a checkout that keeps its
  config elsewhere (a linked worktree, `--separate-git-dir`); there is no configured repository list.
- **Pull requests** — `gh pr list --repo <owner/name> --author @me --state all --limit 100`, keeping the ones whose
  head branch starts with `<agent>/`. First sight scores `progressed`.
- **Issues** — `gh issue list --repo <owner/name> --author @me --state all --limit 100`, keeping the ones whose body
  contains the literal `<!-- from-<agent> -->`. First sight scores `progressed`.
- **Delivery** — the list calls carry a fixed window that the user's own activity shares, so an artefact that stays
  open longer than the window would fall out of it. Delivery is read from the artefact itself instead:
  `gh pr view <url> --json state,mergedAt` and `gh issue view <url> --json state,closedAt`, once per tick for each
  artefact that is counted but not yet shipped. A set `mergedAt` or `closedAt` scores `shipped` once. A failing view
  audits `derive_failed` for that artefact alone and leaves it for the next tick.
- **Skills** — every directory under `~/.hermes/profiles/$HERMES_PROFILE/skills/` containing a `SKILL.md`,
  identified by its path relative to the skills root. First sight scores `progressed`. This is the one source
  the agent can add to alone, and it counts what appears rather than who put it there: a skill installed into the
  profile from outside scores too, and a nested `SKILL.md` inside an existing skill counts as its own directory.

A source is scored only from the tick after its first answer: everything it reported the first time is recorded as
seen (and everything already merged or closed as shipped) without a dose, whether that first answer arrives on the
first tick or days later. A failing `gh` call appends a `derive_failed` audit event naming the source, the
repository or artefact it was reading, and a short error, and leaves that source's cursor and seen list untouched;
the summary line is printed regardless. While a kind has never fully answered, one repository failing
drops the whole kind for that tick, so a partial answer is never mistaken for the complete first sight; afterwards
only the failing repository's own contribution is dropped and the healthy ones still score. An artefact is dosed
once per tick however many sources report it. An artefact past its daily cap is still recorded as seen and audited
as `satisfy_blocked`; that dose is lost rather than carried over. A self-reported `learned` naming a source already
recorded is audited as `satisfy_repeated` instead, and one the cap refuses is not recorded at all, so that source
is reportable again the next day. A ref that is not text is audited as
`derive_failed` for its source rather than dropped silently. Derived events only lower drives, so they never change
the latched buckets and never wake the agent.

## Skill loads

A new skill scores `progressed`, so the report says whether anything then loads it. `act.py report --skills`
renders that section:

```
skills you made (7 days):
- devops/sdlc-review — tick 0, other 0, last used never — unused: archive it or say why it stays
- mcp/yui-desire-tick-operations — tick 52, other 4, last used 2026-09-09 17:53
```

It lists the `skill_first_seen` entries of `artefacts.json`, which hold the skills first seen after the skill
source was bootstrapped; the skills already installed at bootstrap are not the agent's. A listed skill drops out of
the section once its directory is gone or its `.usage.json` `state` is no longer `active`, so archiving one ends
its verdict. With no such skill the whole section is `skills you made (7 days): none yet`, which is what it reads
from the bootstrap tick until the agent writes its first new skill; the skills that were already installed never
enter it.

- **Loads** — every `skill_view` tool call in the last seven days, read from the `messages` table of
  `~/.hermes/profiles/$HERMES_PROFILE/state.db`: an assistant row carries its calls as JSON in `tool_calls`, and
  `timestamp` is unix seconds. A call counts for a skill when its `arguments.name` is the skill path or the last
  segment of it, which is the name `.usage.json` and `skill_view` both use, so two skills sharing a last segment
  under different categories would each absorb the other's bare-name loads. The database is opened read-only
  (`file:<path>?mode=ro`) and outside the state lock, inside the report step only, once a day; the ten-minute
  monitor never reads it.
- **Session kind** — Hermes names every cron-started session `cron_<job id>_<timestamp>`, and `sessions.source` is
  `cron` for all of them, so `source` cannot separate the tick from the digest, reflection, report, and other
  cron jobs. The tick's job id is read by name from `~/.hermes/profiles/$HERMES_PROFILE/cron/jobs.json`, job
  `<agent>-desire-tick`; a `session_id` starting with `cron_<that id>_` is a tick load and everything else — a chat
  platform, the YUI api_server, every other cron job — is an `other` load.
- **Last used** — `last_used_at` from `~/.hermes/profiles/$HERMES_PROFILE/skills/.usage.json`, an offset-carrying
  ISO stamp, rendered in KST. A skill with no stamp reads `never`, and one whose stamp cannot be parsed reads
  `unknown` and carries no verdict.
- **Verdict** — a skill created 14 or more days ago with zero `other` loads in the last seven days is marked
  `unused: archive it or say why it stays`; loads from the agent's own tick do not clear it. The age comes from
  `created_at` in `.usage.json`, or from `skill_first_seen` when the skill has no usage entry. `prompts/report.md`
  tells the agent to archive the skill with `skill_manage` or to write one line in the report saying why it stays,
  and the verdict returns daily until the skill is archived or something outside the tick loads it.
- **Failure** — an absent, locked, or unreadable database, or a `jobs.json` without the tick job, renders every
  line as `loads unavailable` with no verdict and audits `report_skills_failed` with the reason. The rest of the
  report is unaffected.

## Verify

```bash
cd integrations/hermes/desire
uv run pytest
uv run ruff format --check .
uv run ruff check .
```

With `logging.level: DEBUG` in the Hermes profile `config.yaml`, every middleware pass writes one
`yui-desire llm_request …` line to `~/.hermes/logs/agent.log` carrying only outcome, skip reason, trigger
class, the trigger kind read off the headline `trigger:` line of the last `<client_context>` block
(`trigger=user message`, `proactive`, `screen`, `agent`, `signals`, `other` for any headline outside that
vocabulary, or `none` without a block), the channel Hermes named for the turn (`platform=<name>`, or `none` when
it named none), request shape, cache-hit status, and the Hermes request/turn/session ids — never the desire block,
drive levels, or user text.

A turn counts as an interaction, and moves the interaction time, when that headline is `trigger: user message` or
when Hermes names a platform listed in `DESIRE_CHAT_PLATFORMS`. A turn with neither, such as a bare API call,
leaves social drive rising.

Each `<client_context>` block the middleware sees for the first time also appends a `turn` event carrying that
trigger kind to `audit.jsonl`, whatever the log level. A cache hit or a request repeating the text of the one
before it appends nothing, so the events count distinct turns.
