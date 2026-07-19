# n8n signal queue workflows

These SDK files define YUI's n8n signal collection and dispatch layer. Collectors write opaque signal payloads to the n8n data table `signal_queue`; the dispatcher sends pending rows together as one digest. CI failures are the only fast path: the repository-status collector records them as sent and posts them immediately.

## Queue schema

The workflows use data table ID `hcb8ErVh7YIFOUbs` (`signal_queue`). Its columns are:

| Column | Type | Meaning |
| --- | --- | --- |
| `key` | string | Signal deduplication key |
| `source` | string | Collector namespace |
| `priority` | string | `immediate` or `digest` |
| `payload` | string | JSON-serialized opaque signal object |
| `status` | string | `pending` or `sent` |
| `sent_at` | date | Time successfully dispatched, or empty while pending |

The table also supplies `id`, `createdAt`, and `updatedAt` automatically. Sent rows older than 14 days are removed during successful dispatch runs.

## Workflows

- `sg-collect-repo-status` runs every 15 minutes for `yw0nam/observability`, `yw0nam/YUI`, and `yw0nam/tts_express_broker`. It queues non-draft open pull requests and completed successful CI runs for the digest. Completed CI runs with any non-success conclusion are inserted as sent and posted immediately.
- `sg-collect-gmail` polls every 10 minutes for unread inbox mail, excluding Promotions and Social categories, and queues messages for the digest.
- `sg-collect-repo-cleanup` runs Mondays at 10:00. It queues one signal per repository when branches from merged pull requests still exist, excluding `main` and `master`.
- `sg-dispatch` runs every 30 minutes. It posts all pending payloads as one digest, marks each included row sent only after a successful POST, and stays silent when the queue is empty.

Pull request keys have a 24-hour cooldown, so an older matching row permits another notification. CI run and Gmail message keys are permanently deduplicated while their queue history exists. Repository cleanup keys include the ISO year-week, allowing at most one cleanup notification per repository per week.

The raw GitHub REST calls (CI runs, branches, and closed pull requests) run unauthenticated because the monitored repositories are public (about 12 requests per hour, below GitHub's 60-per-hour unauthenticated limit); if a repository becomes private or rate limits become a problem, assign the GitHub credential to those HTTP Request nodes in the n8n UI.

Gateway requests use `POST http://127.0.0.1:8770/signals` with a `signals` array whose first item is a `workflow_reaction_guide` directive. The workflow files in this directory are the source of truth deployed to the n8n instance through the n8n MCP.
