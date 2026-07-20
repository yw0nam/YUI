import { workflow, node, trigger, sticky, placeholder, newCredential, ifElse, switchCase, merge, splitInBatches, nextBatch, languageModel, memory, tool, outputParser, embedding, embeddings, vectorStore, retriever, documentLoader, textSplitter, reranker, fromAi, expr } from '@n8n/workflow-sdk';

const signalQueue = { __rl: true, mode: 'id', value: 'hcb8ErVh7YIFOUbs', cachedResultName: 'signal_queue' };

const gmailPoll = trigger({
  type: 'n8n-nodes-base.gmailTrigger',
  version: 1.3,
  config: {
    name: 'Poll Unread Inbox Every 10 Minutes',
    parameters: {
      pollTimes: { item: [{ mode: 'everyX', value: 10, unit: 'minutes' }] },
      authentication: 'oAuth2',
      event: 'messageReceived',
      simple: true,
      filters: { q: 'in:inbox -category:promotions -category:social', readStatus: 'unread' },
    },
    credentials: { gmailOAuth2: newCredential('Gmail account') },
    position: [0, 240],
  },
  output: [{ id: '18f123', threadId: '18f100', subject: 'Review requested', from: { value: [{ address: 'sender@example.com', name: 'Sender' }] }, snippet: 'Could you review this?', date: '2026-07-19T00:00:00.000Z' }],
});

const buildGmailCandidates = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Gmail Digest Candidates',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: "function fromOf(m) {\n" +
        "  if (!m.from) return '';\n" +
        "  if (typeof m.from === 'string') return m.from;\n" +
        "  if (m.from.value && m.from.value[0]) return m.from.value[0].address || m.from.value[0].name || '';\n" +
        "  return m.from.text || '';\n" +
        "}\n" +
        "return $input.all().filter(i => i.json.id).map(i => {\n" +
        "  const m = i.json;\n" +
        "  return { json: { key: 'gmail:' + m.id, source: 'gmail', priority: 'digest', payload: JSON.stringify({ source: 'gmail', kind: 'email', id: m.id, thread_id: m.threadId || m.thread_id || '', subject: m.subject || '', from: fromOf(m), snippet: m.snippet || '', date: m.date || m.internalDate || '' }) } };\n" +
        "});",
    },
    position: [260, 240],
  },
  output: [{ key: 'gmail:18f123', source: 'gmail', priority: 'digest', payload: '{"source":"gmail","kind":"email","id":"18f123"}' }],
});

const fetchGmailHistory = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Fetch Gmail Queue History',
    parameters: {
      resource: 'row',
      operation: 'get',
      dataTableId: signalQueue,
      matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'source', condition: 'eq', keyValue: 'gmail' }] },
      returnAll: true,
    },
    executeOnce: true,
    alwaysOutputData: true,
    position: [520, 240],
  },
  output: [{ id: 201, key: 'gmail:18f100', source: 'gmail', status: 'sent' }],
});

const keepNewGmailSignals = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Apply Permanent Gmail Dedup',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: "const candidates = $('Build Gmail Digest Candidates').all().map(i => i.json).filter(i => i.key);\n" +
        "const keys = new Set($input.all().map(i => i.json.key).filter(Boolean));\n" +
        "return candidates.filter(c => !keys.has(c.key)).map(c => ({ json: c }));",
    },
    position: [780, 240],
  },
  output: [{ key: 'gmail:18f123', source: 'gmail', priority: 'digest', payload: '{}' }],
});

const insertPendingGmailSignal = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Insert Pending Gmail Signal',
    parameters: {
      resource: 'row',
      operation: 'insert',
      dataTableId: signalQueue,
      columns: { mappingMode: 'defineBelow', value: { key: expr('{{ $json.key }}'), source: expr('{{ $json.source }}'), priority: expr('{{ $json.priority }}'), payload: expr('{{ $json.payload }}'), status: 'pending' } },
      options: {},
    },
    position: [1040, 240],
  },
  output: [{ id: 202, createdAt: '2026-07-19T00:00:00.000Z' }],
});

export default workflow('sg-collect-gmail', 'sg-collect-gmail')
  .add(gmailPoll)
  .to(buildGmailCandidates)
  .to(fetchGmailHistory)
  .to(keepNewGmailSignals)
  .to(insertPendingGmailSignal);
