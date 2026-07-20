import { workflow, node, trigger, sticky, placeholder, newCredential, ifElse, switchCase, merge, splitInBatches, nextBatch, languageModel, memory, tool, outputParser, embedding, embeddings, vectorStore, retriever, documentLoader, textSplitter, reranker, fromAi, expr } from '@n8n/workflow-sdk';

const signalQueue = { __rl: true, mode: 'id', value: 'hcb8ErVh7YIFOUbs', cachedResultName: 'signal_queue' };

const repoStatusSchedule = trigger({
  type: 'n8n-nodes-base.scheduleTrigger',
  version: 1.3,
  config: {
    name: 'Poll Repository Status Every 15 Minutes',
    parameters: { rule: { interval: [{ field: 'minutes', minutesInterval: 15 }] } },
    position: [0, 300],
  },
  output: [{}],
});

const repositoryList = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'List Monitored Repositories',
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
  output: [{ owner: 'yw0nam', name: 'observability', repo: 'yw0nam/observability' }],
});

const fetchOpenPullRequests = node({
  type: 'n8n-nodes-base.github',
  version: 1.1,
  config: {
    name: 'Fetch Open Pull Requests Per Repository',
    parameters: {
      resource: 'repository',
      operation: 'getPullRequests',
      authentication: 'accessToken',
      owner: { __rl: true, mode: 'name', value: expr('{{ $json.owner }}') },
      repository: { __rl: true, mode: 'name', value: expr('{{ $json.name }}') },
      returnAll: true,
      getRepositoryPullRequestsFilters: { state: 'open' },
    },
    credentials: { githubApi: newCredential('GitHub account') },
    alwaysOutputData: true,
    position: [460, 160],
  },
  output: [{ number: 42, title: 'Improve signal handling', html_url: 'https://github.com/yw0nam/YUI/pull/42', draft: false, user: { login: 'contributor' }, created_at: '2026-07-19T00:00:00.000Z', base: { repo: { full_name: 'yw0nam/YUI' } } }],
});

const buildPullRequestCandidates = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Non-Draft Pull Request Candidates',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: "return $input.all().filter(i => i.json.number != null && !i.json.draft).map(i => {\n" +
        "  const p = i.json;\n" +
        "  const repo = p.base?.repo?.full_name || p.head?.repo?.full_name || '';\n" +
        "  return { json: { key: 'pr:' + repo + '#' + p.number, source: 'repo-status', priority: 'digest', payload: JSON.stringify({ source: 'github_pr', repo, n: p.number, title: p.title || '', url: p.html_url || p.url || '', draft: Boolean(p.draft), author: p.user?.login || '', created_at: p.created_at || '' }) } };\n" +
        "}).filter(i => i.json.key !== 'pr:#undefined');",
    },
    position: [700, 160],
  },
  output: [{ key: 'pr:yw0nam/YUI#42', source: 'repo-status', priority: 'digest', payload: '{"source":"github_pr","repo":"yw0nam/YUI","n":42}' }],
});

const fetchWorkflowRuns = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Fetch Recent CI Runs Per Repository',
    parameters: {
      method: 'GET',
      url: expr('https://api.github.com/repos/{{ $json.owner }}/{{ $json.name }}/actions/runs?per_page=15'),
      authentication: 'none',
      sendHeaders: true,
      specifyHeaders: 'keypair',
      headerParameters: { parameters: [{ name: 'Accept', value: 'application/vnd.github+json' }, { name: 'User-Agent', value: 'n8n' }] },
      options: {},
    },
    alwaysOutputData: true,
    position: [460, 440],
  },
  output: [{ total_count: 1, workflow_runs: [{ id: 9001, status: 'completed', conclusion: 'failure', name: 'CI', head_branch: 'main', html_url: 'https://github.com/yw0nam/YUI/actions/runs/9001', created_at: '2026-07-19T00:00:00.000Z', repository: { full_name: 'yw0nam/YUI' } }] }],
});

const buildCiCandidates = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Completed CI Run Candidates',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: "const runs = $input.all().flatMap(i => Array.isArray(i.json.workflow_runs) ? i.json.workflow_runs : (i.json.id != null ? [i.json] : []));\n" +
        "const cutoff = Date.now() - 24 * 60 * 60 * 1000;\n" +
        "return runs.filter(r => r.status === 'completed' && Date.parse(r.created_at) >= cutoff).map(r => {\n" +
        "  const repo = r.repository?.full_name || r.head_repository?.full_name || '';\n" +
        "  return { json: { key: 'ci:' + repo + '#' + r.id, source: 'repo-status', priority: r.conclusion === 'success' ? 'digest' : 'immediate', payload: JSON.stringify({ source: 'github_ci', repo, run_id: r.id, workflow_name: r.name || r.workflow_name || '', branch: r.head_branch || '', conclusion: r.conclusion || '', url: r.html_url || r.url || '', created_at: r.created_at || '' }) } };\n" +
        "}).filter(i => i.json.key !== 'ci:#undefined');",
    },
    position: [700, 440],
  },
  output: [{ key: 'ci:yw0nam/YUI#9001', source: 'repo-status', priority: 'immediate', payload: '{"source":"github_ci","repo":"yw0nam/YUI","run_id":9001,"conclusion":"failure"}' }],
});

const mergeRepoCandidates = merge({
  version: 3.2,
  config: { name: 'Merge Pull Request and CI Candidates', parameters: { mode: 'append' }, position: [940, 300] },
  output: [{ key: 'pr:yw0nam/YUI#42', source: 'repo-status', priority: 'digest', payload: '{}' }],
});

const fetchRepoStatusHistory = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Fetch Repository Status Queue History',
    parameters: {
      resource: 'row',
      operation: 'get',
      dataTableId: signalQueue,
      matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'source', condition: 'eq', keyValue: 'repo-status' }] },
      returnAll: true,
      orderBy: true,
      orderByColumn: 'createdAt',
      orderByDirection: 'DESC',
    },
    executeOnce: true,
    alwaysOutputData: true,
    position: [1180, 300],
  },
  output: [{ id: 1, key: 'pr:yw0nam/YUI#41', source: 'repo-status', status: 'sent', createdAt: '2026-07-18T00:00:00.000Z' }],
});

const keepNewRepoSignals = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Apply PR Cooldown and CI Permanent Dedup',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: "const candidates = $('Merge Pull Request and CI Candidates').all().map(i => i.json).filter(i => i.key);\n" +
        "const rows = $input.all().map(i => i.json).filter(i => i.key);\n" +
        "const cutoff = Date.now() - 24 * 60 * 60 * 1000;\n" +
        "return candidates.filter(c => {\n" +
        "  const matches = rows.filter(r => r.key === c.key);\n" +
        "  if (c.key.startsWith('ci:')) return matches.length === 0;\n" +
        "  if (c.key.startsWith('pr:')) return !matches.some(r => Date.parse(r.createdAt || '') >= cutoff);\n" +
        "  return matches.length === 0;\n" +
        "}).map(c => ({ json: c }));",
    },
    position: [1420, 300],
  },
  output: [{ key: 'ci:yw0nam/YUI#9001', source: 'repo-status', priority: 'immediate', payload: '{}' }],
});

const routeImmediateCi = ifElse({
  version: 2.3,
  config: {
    name: 'Route Immediate CI Failures',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 3 },
        conditions: [{ leftValue: expr('{{ $json.priority }}'), rightValue: 'immediate', operator: { type: 'string', operation: 'equals' } }],
        combinator: 'and',
      },
      options: {},
    },
    position: [1660, 300],
  },
  output: [{ key: 'ci:yw0nam/YUI#9001', priority: 'immediate' }],
});

const insertSentCiFailure = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Insert Sent CI Failure',
    parameters: {
      resource: 'row',
      operation: 'insert',
      dataTableId: signalQueue,
      columns: { mappingMode: 'defineBelow', value: { key: expr('{{ $json.key }}'), source: expr('{{ $json.source }}'), priority: expr('{{ $json.priority }}'), payload: expr('{{ $json.payload }}'), status: 'sent', sent_at: expr('{{ $now.toISO() }}') } },
      options: {},
    },
    position: [1900, 180],
  },
  output: [{ id: 101, createdAt: '2026-07-19T00:00:00.000Z' }],
});

const pushCiFailures = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Push Immediate CI Failures to YUI',
    parameters: {
      method: 'POST',
      url: 'http://127.0.0.1:8770/signals',
      authentication: 'none',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{ { "signals": [ { "_directive": "workflow_reaction_guide", "workflow": "sg-collect-repo-status", "how_to_react": "CI run failed. Tell the user promptly which repo/workflow failed." }, ...$("Apply PR Cooldown and CI Permanent Dedup").all().filter(i => i.json.priority === "immediate").map(i => JSON.parse(i.json.payload)) ] } }}'),
      options: {},
    },
    executeOnce: true,
    retryOnFail: true,
    position: [2140, 180],
  },
  output: [{ accepted: true }],
});

const insertPendingRepoSignal = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Insert Pending Repository Signal',
    parameters: {
      resource: 'row',
      operation: 'insert',
      dataTableId: signalQueue,
      columns: { mappingMode: 'defineBelow', value: { key: expr('{{ $json.key }}'), source: expr('{{ $json.source }}'), priority: expr('{{ $json.priority }}'), payload: expr('{{ $json.payload }}'), status: 'pending' } },
      options: {},
    },
    position: [1900, 420],
  },
  output: [{ id: 102, createdAt: '2026-07-19T00:00:00.000Z' }],
});

const repoStatusNote = sticky('## Repository status collector\nQueues non-draft PRs and successful CI runs for the digest. Only completed CI runs created within the last 24 hours are considered. CI failures use the queue-first fast path: a sent row is inserted before the immediate gateway POST. PR keys cool down for 24 hours; CI run keys are permanently deduplicated.', [fetchOpenPullRequests, fetchWorkflowRuns, fetchRepoStatusHistory], { color: 5 });

export default workflow('sg-collect-repo-status', 'sg-collect-repo-status')
  .add(repoStatusNote)
  .add(repoStatusSchedule)
  .to(repositoryList)
  .to(fetchOpenPullRequests.to(buildPullRequestCandidates.to(mergeRepoCandidates.input(0))))
  .add(repositoryList)
  .to(fetchWorkflowRuns.to(buildCiCandidates.to(mergeRepoCandidates.input(1))))
  .add(mergeRepoCandidates)
  .to(fetchRepoStatusHistory)
  .to(keepNewRepoSignals)
  .to(routeImmediateCi
    .onTrue(insertSentCiFailure.to(pushCiFailures))
    .onFalse(insertPendingRepoSignal));
