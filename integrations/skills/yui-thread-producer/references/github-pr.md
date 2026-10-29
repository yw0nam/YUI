# GitHub pull request producer

A producer that watches one repository's pull requests, posts each PR as a Thread when
its checks finish, and merges, closes, or comments on the user's answer. The Thread id is
`github-pr:<owner>:<repo>:<n>` — colons are legal in Thread ids and never appear in
GitHub owner or repository names.

The wire contract is `docs/reference/threads.md`; this file adds only the GitHub side.
Actions run through `gh`, the GitHub CLI, or the REST command shown beside it.

## Post the Thread

Post when a PR's checks finish, and refresh the same Thread when a new head arrives.

1. Gather the title, the author, and the checks' conclusions (`gh pr view <n>`; check
   your tool's docs for the exact fields).
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
| `close` choice with text | Comment the text, then close |
| Text only | Comment the text, then re-ask the same question under a new ask id |

- Merge only when the head still equals the SHA the ask carries:
  `gh pr merge <n> --squash --match-head-commit <sha>`, or REST
  `PUT /repos/{owner}/{repo}/pulls/{n}/merge` with `"sha": "<sha>"`. A stale head is
  refused with "Head branch was modified" (measured 2026-10-29 on a throwaway repo);
  treat that refusal as a partial failure.
- Close: `gh pr close <n>`, or REST `PATCH /repos/{owner}/{repo}/pulls/{n}` with
  `{"state": "closed"}`.
- Comment: `gh pr comment <n> --body "<text>"`, or a REST issue comment on the PR.

Then PUT the result entry and the final state. A partial failure — the comment posted,
the merge refused — gets a `system` entry naming exactly what happened, and a new ask
when a retry makes sense.

Record each answer durably before acting. When an action times out or the producer dies
mid-action, post `failed` and ask the user to check the source; never retry on your own.

Done when: one real answer has been acted on and the Thread shows the result entry.

## Watching the checks

- A producer that can block: `gh pr checks <n> --watch --fail-fast` exits 0 when the
  checks pass and 1 when they fail (measured); post the Thread when it exits.
- A scheduled producer: each run lists the check runs completed since the previous run
  and posts or refreshes only those pull requests.

## Credentials

A token with write access to the repository's pull requests — a `gh auth login` session
or a token your environment holds.
