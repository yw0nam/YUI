@AGENTS.md

## Agent skills

### Issue tracker

Issues live in GitHub Issues (`gh` CLI), opened from the `.github/ISSUE_TEMPLATE/` templates. See `docs/agents/issue-tracker.md`.

### Triage labels

Default label vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ui`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `GLOSSARY.md`. When naming a domain concept, use the term as `GLOSSARY.md` defines it and avoid the synonyms it lists.

No `docs/adr/`. A decision goes in the issue's closing comment and the PR body.
