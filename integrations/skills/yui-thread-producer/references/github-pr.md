# GitHub pull request producer

A producer that watches one repository's pull requests, posts each PR as a Thread when
its checks finish, and merges, closes, or comments on the user's answer. The Thread id is
`github-pr:<owner>:<repo>:<n>` — colons are legal in Thread ids and never appear in
GitHub owner or repository names. Actions run through `gh`, the GitHub CLI, or the REST
command shown beside it.

## Watching the checks

- A producer that can block: `gh pr checks <n> --watch --fail-fast` exits 0 when the
  checks pass and 1 when they fail (measured); post the Thread when it exits.
- A scheduled producer: each run lists the check runs completed since the previous run
  and posts or refreshes only those pull requests.

Done when: the producer knows which pull requests finished their checks since it last
ran.

## Post the Thread

1. Gather the title, the author, and the checks' conclusions (`gh pr view <n>`; check
   your tool's docs for the exact fields).

   Done when: the trigger fires on a test PR's finished checks and the gathered values
   include the head SHA and each check's conclusion.

2. All checks pass: state `input-required` with the ask
   `{ask_id: "merge:<head sha>:<nonce>", prompt: "Merge?", choices: [merge: "Merge
   (squash)", close: "Close"], text: true}`. The nonce is a fresh short value per ask, so
   a retry or a re-ask on the same head opens a new ask.
3. Any check fails: state `failed`, one entry naming the failing checks, no ask.

A refresh on a new head carries the new head's ask; a refresh while the current ask is
unanswered keeps its id, so the ask is replaced in place and an answer already recorded
still matches.

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
the merge refused — gets a `system` entry naming exactly what happened, and a new ask
when a retry makes sense. Record the answer durably before acting and leave the retry to
the user: follow SKILL.md step 5.
