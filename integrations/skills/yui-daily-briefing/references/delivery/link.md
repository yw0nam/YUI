# Link delivery

The briefing arrives as a greeting and one link per day. The links open the spool,
published as a private repository the user owns on a git hosting service that renders
markdown. Answer 2 of Install step 6 in `SKILL.md` leads here, and the step numbers below
are those of `SKILL.md`.

## Install

This runs after step 8, with the spool holding briefings and the producers scheduled. Ask
the user for the repository that receives the briefings: an empty one, made on the host
with no README, license, or `.gitignore`, so the first push has nothing to merge. Then, in
order:

1. Write the spool's `.gitignore`, so the ledger and the lock file stay out of every commit:

   ```bash
   printf 'spoken.json\n.lock\n' > "$YUI_BRIEFING_SPOOL/.gitignore"
   ```

2. Make the spool its own repository with the user's repository as its remote:

   ```bash
   git -C "$YUI_BRIEFING_SPOOL" init
   git -C "$YUI_BRIEFING_SPOOL" remote add origin <repository URL>
   ```

   The spool is the top directory of that repository; `publish` exits 2 on a spool nested
   inside another work tree. A commit needs `user.name` and `user.email`; set them with
   `git -C "$YUI_BRIEFING_SPOOL" config` when the machine has none.
3. Settle with the user a push credential that asks for nothing, since the scheduler
   pushes unattended: a git credential helper for an HTTPS remote (`gh auth setup-git`
   when the host is GitHub), or a deploy key with write access for an SSH remote.
4. Make the first commit and push with `publish` itself. The commit holds the dated `.md`
   files only, and the push sends the current branch:

   ```bash
   python3 "$SKILL_DIR/scripts/briefing.py" publish
   ```

5. Read the spool's branch with `git -C "$YUI_BRIEFING_SPOOL" branch --show-current`, and
   set `YUI_BRIEFING_LINK` to the browse URL of that branch, beside `YUI_BRIEFING_SPOOL`
   and `SKILL_DIR` in the environment your own shell commands run in (step 7). The path
   after the host follows the hosting service's browse URL for a folder, for example:

   ```bash
   YUI_BRIEFING_LINK=https://<git host>/<owner>/<repo>/tree/<branch>
   ```

6. Add one line to the schedule of step 8, under the same variables:

   ```crontab
   30 7 * * * python3 "$SKILL_DIR/scripts/briefing.py" publish
   ```

   Cron starts every line of one minute at once, so the `publish` line runs later than the
   producers' time by more than the slowest producer took in its manual run of step 8.
   One commit a day then carries that day's briefings. Another scheduler runs the same
   command after the producers.

Done when: a manual run of the `publish` line, as the scheduler's user, prints nothing and
exits 0; `printenv YUI_BRIEFING_LINK` in a new shell of yours prints the URL; and the user
opens `$YUI_BRIEFING_LINK/<today>` and sees today's files.

## Speak

`$YUI_BRIEFING_LINK/<YYYY-MM-DD>` opens that day's folder. The reply holds the greeting and
one line per day `pending` covers, oldest day first. Each line carries:

1. The day, named when it is other than today ("yesterday", "on Monday").
2. The item count of each briefing that day, under its `source`.
3. Each source whose `status` is anything other than `ok`, `stale` together with its
   `last_ok`, and a `run_url` rendered as `[name](run_url)`.
4. The link to that day, `[<YYYY-MM-DD>](<value>/<YYYY-MM-DD>)` with the variable's value
   in place of `<value>`.

Items stay on the page; follow-ups (Speak step 5) read the files. When `pending` covers
more than three days, the newest day gets its line and the older days get one sentence
giving how many days and items they hold and the link to the variable's value. Every path
`pending` printed counts as covered in Speak step 4.

Done when: the reply carries the link of each day it gives a line, the link to the
variable's value when it collapses older days, and no item title.

## Check

Point 7 of "Check an existing schedule" confirms each of these, and a point that fails is
set up again as in § Install:

1. The spool is the top directory of its own git repository with a remote, and its
   `.gitignore` lists `spoken.json` and `.lock`.
2. `git -C "$YUI_BRIEFING_SPOOL" ls-files` lists dated `.md` files only. Any other tracked
   file leaves the repository through `git rm --cached` and a commit the user makes.
3. Each schedule has one `briefing.py publish` entry, later than its producers by more
   than the slowest producer's run.
4. The environment your own shell commands run in holds `YUI_BRIEFING_LINK`, ending in the
   branch `git -C "$YUI_BRIEFING_SPOOL" branch --show-current` prints.
