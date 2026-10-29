# GitHub pull request producer

A producer that watches one repository's pull requests, posts each PR as a Thread when
its checks finish, and merges, closes, or comments on the user's answer. The Thread id is
`github-pr:<owner>:<repo>:<n>` — colons are legal in Thread ids and never appear in
GitHub owner or repository names. Actions run through `gh`, the GitHub CLI, or the REST
command shown beside it.

## Watching the checks

- A producer that can block: `gh pr checks <n> --watch --fail-fast` exits 0 when the
  checks pass and 1 when they fail (measured); post the Thread when it exits.
- A scheduled producer: each run reads every open PR's head check runs and posts a PR
  whose head and result differ from what the producer's store last posted.

A PR's checks are in one of three states:

- Passed: every check run is `completed` with conclusion `success`, `neutral`, or
  `skipped`.
- Failed: any run is `completed` with another conclusion.
- Not finished: zero check runs, or any run is not `completed`; post nothing yet.

Done when: the producer knows each open pull request's head and whether its checks passed,
failed, or have not finished.

## Post the Thread

1. Gather the title, the author, and the head SHA (`gh pr view <n>`, or REST
   `GET /repos/{owner}/{repo}/pulls/{n}`), then each check run's `status` and `conclusion`
   (`gh pr checks <n>`, or REST
   `GET /repos/{owner}/{repo}/commits/{sha}/check-runs`).

   Done when: the trigger fires on a test PR's finished checks and the gathered values
   include the head SHA and each check's conclusion.

2. All checks pass: state `input-required` with the ask
   `{ask_id: "merge:<head sha>:<nonce>", prompt: "Merge?", choices: [merge: "Merge
   (squash)", close: "Close"], text: true}`. The nonce is a fresh short value per ask, so
   a retry or a re-ask on the same head opens a new ask.
3. Any check fails: state `failed`, one entry naming the failing checks, no ask.

A refresh while the current ask is unanswered keeps its id, so the ask is replaced in
place and an answer already recorded still matches. A new head closes the old ask: PUT the
Thread `working` with `ask: null`, then post the new head's ask once its checks finish.

Done when: the Thread holds the PR's checks and the ask.

## Act on the answer

Each answer maps to actions in this order:

| Answer | Actions |
| --- | --- |
| `merge` choice with text | Merge, then post the text as a comment |
| `merge` choice alone | Merge |
| `close` choice with text | Comment the text, then close |
| `close` choice alone | Close |
| Text only | Comment the text, then re-ask the same question under a new ask id |

- Merge only when the head still equals the SHA the ask carries:
  `gh pr merge <n> --squash --match-head-commit <sha>`, or REST
  `PUT /repos/{owner}/{repo}/pulls/{n}/merge` with `"sha": "<sha>"`. A stale head is
  refused with "Head branch was modified"; treat that refusal as a partial failure.
- Close: `gh pr close <n>`, or REST `PATCH /repos/{owner}/{repo}/pulls/{n}` with
  `{"state": "closed"}`.
- Comment: `gh pr comment <n> --body "<text>"`, or a REST issue comment on the PR.

Then PUT the result entry and the final state. A partial failure — the comment posted,
the merge refused — gets a `system` entry naming exactly what happened; when a retry makes
sense, that PUT carries state `input-required` and a new ask under a fresh `ask_id`, and
with nothing left to ask it carries state `failed`.

Record the answer durably before acting and leave the retry to the user: follow SKILL.md
step 5.
