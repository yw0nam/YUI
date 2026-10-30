# Spoken delivery

The briefing arrives as its items, told in your reply. Answer 1 of Install step 6 in
`SKILL.md` leads here, and the step numbers below are those of `SKILL.md`.

## Install

Spoken delivery is complete once step 8's Done when holds, and `YUI_BRIEFING_LINK` stays
unset.

## Speak

How much to say, how to group it, and in what voice is your call as the persona. Six
rules are fixed:

1. Briefings are told grouped by the `date` in their front matter, oldest day first. Every
   day other than today gets named ("yesterday", "on Monday"), so the user knows which
   morning an item belongs to.
2. A source whose `status` is anything other than `ok` gets named ahead of the first item,
   `stale` together with its `last_ok`, and a `run_url` rendered as `[name](run_url)`.
3. Every item you mention carries its link, `[title](url)`, so the user can open it from
   the speech bubble. Items you leave out get a count ("and 4 more").
4. A briefing with no items whose sources all read `ok` adds nothing to say. It still
   counts as covered in Speak step 4.
5. When `pending` covers more than three days, the newest day is told in full. Each older
   day gets its date and its item count only, with an offer to read it. Every listed path
   still counts as covered in Speak step 4.
6. When the context carries a `previous turn:` line reading `cut off mid-speech` and the
   transcript holds a briefing you were telling, say in one clause that it was cut off. Read
   `$YUI_BRIEFING_SPOOL/<path>` directly for the paths of that earlier turn, without
   running `pending` or `mark-spoken` again. The line's `already spoken:` and
   `never spoken:` text (see `docs/reference/client-context.md` in the YUI checkout) shows
   where the user stopped hearing; pick up from there.

Done when: each mentioned item carries exactly one link and each day other than today is
named.

## Check

Point 7 of "Check an existing schedule" confirms both:

1. The schedule's entries are the producers of step 8 alone.
2. `printenv YUI_BRIEFING_LINK`, run in the environment your own shell commands run in,
   exits 1, the variable being unset.
