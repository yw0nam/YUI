---
name: yui-dispatch
description: "Hand a ready-for-agent issue from any GitHub repository Youngwoo names to a headless Claude Code session that implements it and opens the pull request. Use when Youngwoo asks you to dispatch, delegate, or hand over an issue by number."
version: 0.2.0
author: yw0nam
platforms: [linux]
prerequisites:
  commands: [git, gh, claude, timeout]
metadata:
  hermes:
    tags: [yui, natsume, dispatch, claude-code]
---

# yui-dispatch

Youngwoo closes the spec inside an issue, labels it `ready-for-agent`, and tells you in plain language which one to
hand over (for example "YUI 123 맡아" or "memory_layer 45 넘겨"). You start one headless `claude -p` session on that
issue and relay the outcome. You do not implement anything yourself; the session works from the issue and the
repository's own rules and opens the pull request.

`$YUI` is the absolute path of the YUI checkout. `$N` is the issue number. `$REPO` is the repository as
`owner/name`, resolved from the name Youngwoo gives:

```bash
gh search repos <name> --match name --json fullName --jq '.[].fullName'
```

Take the entry whose name part equals what Youngwoo said. If none or more than one matches, ask which one and stop.
`$CLONE` is the clone under `~/.hermes/profiles/<profile>/workspace/<name>`; if it does not exist yet,
`gh repo clone $REPO` it there first.
`$MODEL` is `sonnet` unless Youngwoo names a model in the request (for example "Opus로 해줘" means `opus`); pass the
name exactly as given, in lower case.

## 1. Check the issue

```bash
gh issue view $N --repo $REPO --json state,labels,assignees
```

Hand over only when all of these hold. Otherwise reply with the one that fails and stop.

- `state` is `OPEN`.
- `labels` contains `ready-for-agent` and does not contain `ui`. A `ui` issue needs the running app to verify and
  cannot be done headless.
- `assignees` is empty. An assignee means a session already took it.

Only one dispatch runs at a time. If a previous `claude -p` you started is still running, reply that it is still
running and stop.

## 2. Claim

```bash
gh issue edit $N --repo $REPO --add-assignee @me
gh issue comment $N --repo $REPO --body "Picked up by Natsume; a headless Claude Code session is working on it."
```

## 3. Build the prompt and start the session

```bash
{ cat $YUI/integrations/hermes/skills/yui-dispatch/prompt.md; gh issue view $N --repo $REPO --json number,title,body --template 'Issue #{{.number}}: {{.title}}

{{.body}}'; } > /tmp/dispatch-$N.md
```

Run exactly this command with `background=true` and `notify_on_complete=true`. Do not change the flags other than
`$MODEL`.

```bash
cd $CLONE && git checkout $(git remote show origin | sed -n 's/.*HEAD branch: //p') && git pull --ff-only && timeout 1h claude -p --model $MODEL --dangerously-skip-permissions --output-format json < /tmp/dispatch-$N.md
```

Reply to Youngwoo with one line: `Started #$N.` Then end the turn; the completion notification wakes you.

## 4. Report

The completion notification carries the exit code and the tail of the output. Find the pull request URL in the
`result` text. If there is none, check once more:

```bash
gh pr list --repo $REPO --search "#$N" --state open --json url
```

- Pull request found: `gh issue comment $N --repo $REPO --body "Pull request: <url>"` and tell Youngwoo
  `Dispatched #$N → <url>`.
- No pull request (timeout, exit code other than 0, or `No pull request opened.` in the result): comment the reason on
  the issue in one or two sentences, remove the `ready-for-agent` label, add `needs-info` if the repository has that
  label, and tell Youngwoo `Dispatch failed #$N: <reason>`.

Leave the assignee in place either way. Youngwoo clears it when re-labeling the issue.

## What you do not do

- Fix review comments on the pull request. Youngwoo does that from a local Claude Code session.
- Retry a failed dispatch on your own. Wait for the issue to be labeled `ready-for-agent` again.
- Poll issues for the label. Dispatch only what Youngwoo hands you.
