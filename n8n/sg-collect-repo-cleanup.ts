import { workflow, node, trigger, sticky, placeholder, newCredential, ifElse, switchCase, merge, splitInBatches, nextBatch, languageModel, memory, tool, outputParser, embedding, embeddings, vectorStore, retriever, documentLoader, textSplitter, reranker, fromAi, expr } from '@n8n/workflow-sdk';

const signalQueue = { __rl: true, mode: 'id', value: 'hcb8ErVh7YIFOUbs', cachedResultName: 'signal_queue' };

const cleanupSchedule = trigger({
  type: 'n8n-nodes-base.scheduleTrigger',
  version: 1.3,
  config: {
    name: 'Run Repository Cleanup Check Monday at 10',
    parameters: { rule: { interval: [{ field: 'weeks', weeksInterval: 1, triggerAtDay: [1], triggerAtHour: 10, triggerAtMinute: 0 }] } },
    position: [0, 300],
  },
  output: [{}],
});

const cleanupRepositoryList = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'List Repositories for Cleanup Check',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: "return [\n" +
        "  { json: { owner: 'yw0nam', name: 'observability', repo: 'yw0nam/observability' } },\n" +
        "  { json: { owner: 'yw0nam', name: 'YUI', repo: 'yw0nam/YUI' } },\n" +
        "  { json: { owner: 'yw0nam', name: 'tts_express_broker', repo: 'yw0nam/tts_express_broker' } },\n" +
        "];",
    },
    position: [220, 300],
  },
  output: [{ owner: 'yw0nam', name: 'YUI', repo: 'yw0nam/YUI' }],
});

const fetchBranches = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Fetch Branches Per Repository',
    parameters: {
      method: 'GET',
      url: expr('https://api.github.com/repos/{{ $json.owner }}/{{ $json.name }}/branches?per_page=100'),
      authentication: 'none',
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: { parameters: [{ name: 'Accept', value: 'application/vnd.github+json' }, { name: 'User-Agent', value: 'n8n' }] },
      options: {},
    },
    alwaysOutputData: true,
    position: [480, 160],
  },
  output: [{ name: 'feature/merged-work', commit: { url: 'https://api.github.com/repos/yw0nam/YUI/commits/abc123' } }],
});

const fetchClosedPullRequests = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Fetch Recently Closed Pull Requests Per Repository',
    parameters: {
      method: 'GET',
      url: expr('https://api.github.com/repos/{{ $json.owner }}/{{ $json.name }}/pulls?state=closed&sort=updated&direction=desc&per_page=50'),
      authentication: 'none',
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: { parameters: [{ name: 'Accept', value: 'application/vnd.github+json' }, { name: 'User-Agent', value: 'n8n' }] },
      options: {},
    },
    alwaysOutputData: true,
    position: [480, 440],
  },
  output: [{ number: 41, title: 'Merged feature', merged_at: '2026-07-18T00:00:00.000Z', head: { ref: 'feature/merged-work' }, base: { repo: { full_name: 'yw0nam/YUI' } } }],
});

const mergeCleanupInputs = merge({
  version: 3.2,
  config: { name: 'Merge Branch and Pull Request Responses', parameters: { mode: 'append' }, position: [740, 300] },
  output: [{ name: 'feature/merged-work' }],
});

const buildCleanupCandidates = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Weekly Stale Branch Candidates',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: "function flatten(items) {\n" +
        "  return items.flatMap(i => Array.isArray(i.json) ? i.json : [i.json]).filter(v => v && Object.keys(v).length);\n" +
        "}\n" +
        "function repoFromBranch(b) {\n" +
        "  const url = b.commit?.url || b._links?.self?.href || '';\n" +
        "  const match = url.match(/\\/repos\\/([^/]+\\/[^/]+)\\/(?:commits|branches)\\//);\n" +
        "  return match ? match[1] : '';\n" +
        "}\n" +
        "function isoWeek(date) {\n" +
        "  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));\n" +
        "  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));\n" +
        "  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));\n" +
        "  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);\n" +
        "  return d.getUTCFullYear() + '-W' + String(week).padStart(2, '0');\n" +
        "}\n" +
        "const branches = flatten($('Fetch Branches Per Repository').all());\n" +
        "const pulls = flatten($('Fetch Recently Closed Pull Requests Per Repository').all());\n" +
        "const branchesByRepo = new Map();\n" +
        "for (const b of branches) {\n" +
        "  const repo = repoFromBranch(b);\n" +
        "  if (!repo || !b.name) continue;\n" +
        "  if (!branchesByRepo.has(repo)) branchesByRepo.set(repo, new Set());\n" +
        "  branchesByRepo.get(repo).add(b.name);\n" +
        "}\n" +
        "const staleByRepo = new Map();\n" +
        "for (const p of pulls) {\n" +
        "  const repo = p.base?.repo?.full_name || '';\n" +
        "  const branch = p.head?.ref || '';\n" +
        "  if (!p.merged_at || !repo || !branch || branch === 'main' || branch === 'master' || !branchesByRepo.get(repo)?.has(branch)) continue;\n" +
        "  if (!staleByRepo.has(repo)) staleByRepo.set(repo, []);\n" +
        "  staleByRepo.get(repo).push({ branch, pr: p.number, title: p.title || '' });\n" +
        "}\n" +
        "const week = isoWeek(new Date());\n" +
        "return Array.from(staleByRepo.entries()).filter(([, stale]) => stale.length).map(([repo, stale_branches]) => ({ json: { key: 'cleanup:' + repo + ':' + week, source: 'repo-cleanup', priority: 'digest', payload: JSON.stringify({ source: 'repo_cleanup', repo, stale_branches }) } }));",
    },
    position: [980, 300],
  },
  output: [{ key: 'cleanup:yw0nam/YUI:2026-W29', source: 'repo-cleanup', priority: 'digest', payload: '{"source":"repo_cleanup","repo":"yw0nam/YUI","stale_branches":[{"branch":"feature/merged-work","pr":41,"title":"Merged feature"}]}' }],
});

const fetchCleanupHistory = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Fetch Repository Cleanup Queue History',
    parameters: {
      resource: 'row',
      operation: 'get',
      dataTableId: signalQueue,
      matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'source', condition: 'eq', keyValue: 'repo-cleanup' }] },
      returnAll: true,
    },
    executeOnce: true,
    alwaysOutputData: true,
    position: [1220, 300],
  },
  output: [{ id: 301, key: 'cleanup:yw0nam/YUI:2026-W28', source: 'repo-cleanup', status: 'sent' }],
});

const keepNewCleanupSignals = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Apply Weekly Cleanup Dedup',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: "const candidates = $('Build Weekly Stale Branch Candidates').all().map(i => i.json).filter(i => i.key);\n" +
        "const keys = new Set($input.all().map(i => i.json.key).filter(Boolean));\n" +
        "return candidates.filter(c => !keys.has(c.key)).map(c => ({ json: c }));",
    },
    position: [1460, 300],
  },
  output: [{ key: 'cleanup:yw0nam/YUI:2026-W29', source: 'repo-cleanup', priority: 'digest', payload: '{}' }],
});

const insertPendingCleanupSignal = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Insert Pending Repository Cleanup Signal',
    parameters: {
      resource: 'row',
      operation: 'insert',
      dataTableId: signalQueue,
      columns: { mappingMode: 'defineBelow', value: { key: expr('{{ $json.key }}'), source: expr('{{ $json.source }}'), priority: expr('{{ $json.priority }}'), payload: expr('{{ $json.payload }}'), status: 'pending' } },
      options: {},
    },
    position: [1700, 300],
  },
  output: [{ id: 302, createdAt: '2026-07-19T00:00:00.000Z' }],
});

export default workflow('sg-collect-repo-cleanup', 'sg-collect-repo-cleanup')
  .add(cleanupSchedule)
  .to(cleanupRepositoryList)
  .to(fetchBranches.to(mergeCleanupInputs.input(0)))
  .add(cleanupRepositoryList)
  .to(fetchClosedPullRequests.to(mergeCleanupInputs.input(1)))
  .add(mergeCleanupInputs)
  .to(buildCleanupCandidates)
  .to(fetchCleanupHistory)
  .to(keepNewCleanupSignals)
  .to(insertPendingCleanupSignal);
