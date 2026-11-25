# GitHub pull request producer

A producer that watches one repository's pull requests, posts each PR as a Thread when its
checks finish, and merges, closes, or comments when the user tells the character to. The
Thread id is `github-pr:<owner>:<repo>:<n>`. Colons are legal in Thread ids and never appear
in GitHub owner or repository names. Actions run through `gh`, the GitHub CLI, or the REST
command shown beside it.

## Watching the checks

- A producer that can block: `gh pr checks <n> --watch --fail-fast` exits 0 when the
  checks pass and 1 when they fail (measured). Post the Thread when it exits.
- A scheduled producer: each run reads every open PR's head check runs and posts a PR
  whose head and result differ from what the producer's store last posted.

A PR's checks are in one of three states:

- Passed: every check run is `completed` with conclusion `success`, `neutral`, or
  `skipped`.
- Failed: any run is `completed` with another conclusion.
- Not finished: zero check runs, or any run is not `completed`. Post nothing yet.

Done when: the producer knows each open pull request's head and whether its checks passed,
failed, or have not finished.

## Post the Thread

1. Gather the title, the author, and the head SHA (`gh pr view <n>`, or REST
   `GET /repos/{owner}/{repo}/pulls/{n}`), then each check's result
   (`gh pr checks <n> --json name,state,bucket`, whose `bucket` is `pass`, `fail`, `pending`,
   `skipping` or `cancel`; or REST `GET /repos/{owner}/{repo}/commits/{sha}/check-runs`, with
   `status` and `conclusion` as above).

   Done when: a test PR's finished checks yield the head SHA and each check's conclusion.

2. All checks pass: state `input-required`. One entry names the head SHA the user decides
   on, for example `Head <sha>: checks passed. Merge, close, or comment.`
3. Any check fails: state `input-required`, with one entry naming the head SHA and the
   failing checks, for example `Head <sha>: lint and test failed.`

A new head gets a new entry naming its SHA, and the state for that head. The user's
decision applies to the SHA it was made on, so an action checks that SHA before it runs.

Done when: the Thread holds the PR's checks and the head SHA the user decides on.

## Act on the user's request

When the user tells the character to merge, close, or comment, the backend takes the head
SHA from the Thread's latest entry that names one, then runs the action:

- Merge only when the head still equals that SHA: `gh pr merge <n> --squash
  --match-head-commit <sha>`, or REST `PUT /repos/{owner}/{repo}/pulls/{n}/merge` with
  `"sha": "<sha>"`. A stale head is refused with "Head branch was modified". Record the
  refusal as a partial failure.
- Close: `gh pr close <n>`, or REST `PATCH /repos/{owner}/{repo}/pulls/{n}` with
  `{"state": "closed"}`.
- Comment: `gh pr comment <n> --body "<text>"`, or a REST issue comment on the PR.

Then PUT a `system` entry naming what happened, with the new state. A partial failure (the
comment posted, the merge refused) is named exactly in that entry. The source is checked
before any retry.

Done when: the action lands on the PR, and the Thread shows the result entry.

## Credentials

The integration's identity needs read access to pull requests and their check runs, and
the repository actions the guide uses: merge, close, and comment on pull requests.
