import { workflow, node, trigger, sticky, placeholder, newCredential, ifElse, switchCase, merge, splitInBatches, nextBatch, languageModel, memory, tool, outputParser, embedding, embeddings, vectorStore, retriever, documentLoader, textSplitter, reranker, fromAi, expr } from '@n8n/workflow-sdk';

const signalQueue = { __rl: true, mode: 'id', value: 'hcb8ErVh7YIFOUbs', cachedResultName: 'signal_queue' };

const dispatchSchedule = trigger({
  type: 'n8n-nodes-base.scheduleTrigger',
  version: 1.3,
  config: {
    name: 'Flush Signal Queue Every 30 Minutes',
    parameters: { rule: { interval: [{ field: 'minutes', minutesInterval: 30 }] } },
    position: [0, 280],
  },
  output: [{}],
});

const fetchPendingRows = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Fetch Pending Signal Queue Rows',
    parameters: {
      resource: 'row',
      operation: 'get',
      dataTableId: signalQueue,
      matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'status', condition: 'eq', keyValue: 'pending' }] },
      returnAll: true,
      orderBy: true,
      orderByColumn: 'createdAt',
      orderByDirection: 'ASC',
    },
    alwaysOutputData: true,
    position: [260, 280],
  },
  output: [{ id: 401, key: 'gmail:18f123', source: 'gmail', priority: 'digest', payload: '{"source":"gmail","kind":"email","id":"18f123"}', status: 'pending', createdAt: '2026-07-19T00:00:00.000Z' }],
});

const hasPendingRows = ifElse({
  version: 2.3,
  config: {
    name: 'Check for Pending Queue Rows',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 3 },
        conditions: [{ leftValue: expr('{{ $input.all().filter(i => i.json.id != null).length }}'), rightValue: 0, operator: { type: 'number', operation: 'gt' } }],
        combinator: 'and',
      },
      options: {},
    },
    position: [520, 280],
  },
  output: [{ id: 401, status: 'pending' }],
});

const composeDigestBody = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Compose Batched Signal Digest',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: "const rows = $('Fetch Pending Signal Queue Rows').all().map(i => i.json).filter(r => r.id != null);\n" +
        "return [{ json: { signals: [{ _directive: 'workflow_reaction_guide', workflow: 'sg-dispatch', how_to_react: 'Batched digest of signals queued since the last flush (30 min cadence). Summarize concisely; only nudge the user about items that look actionable.' }, ...rows.map(r => JSON.parse(r.payload))] } }];",
    },
    position: [780, 160],
  },
  output: [{ signals: [{ _directive: 'workflow_reaction_guide', workflow: 'sg-dispatch', how_to_react: 'Batched digest of signals queued since the last flush (30 min cadence). Summarize concisely; only nudge the user about items that look actionable.' }, { source: 'gmail', kind: 'email', id: '18f123' }] }],
});

const postDigestToYui = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.4,
  config: {
    name: 'Post Batched Digest to YUI',
    parameters: {
      method: 'POST',
      url: 'http://127.0.0.1:8770/signals',
      authentication: 'none',
      sendBody: true,
      contentType: 'json',
      specifyBody: 'json',
      jsonBody: expr('{{ $json }}'),
      options: {},
    },
    executeOnce: true,
    alwaysOutputData: true,
    retryOnFail: true,
    position: [1040, 160],
  },
  output: [{ accepted: true }],
});

const restorePostedRows = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Restore Posted Pending Rows for Sent Marking',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: "return $('Fetch Pending Signal Queue Rows').all().filter(i => i.json.id != null).map(i => ({ json: i.json }));",
    },
    position: [1300, 160],
  },
  output: [{ id: 401, key: 'gmail:18f123', status: 'pending' }],
});

const markRowSent = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Mark Each Posted Queue Row Sent',
    parameters: {
      resource: 'row',
      operation: 'update',
      dataTableId: signalQueue,
      matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'id', condition: 'eq', keyValue: expr('{{ String($json.id) }}') }] },
      columns: { mappingMode: 'defineBelow', value: { status: 'sent', sent_at: expr('{{ $now.toISO() }}') } },
      options: {},
    },
    position: [1560, 160],
  },
  output: [{ id: 401, updatedAt: '2026-07-19T00:01:00.000Z' }],
});

const deleteExpiredSentRows = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Delete Sent Queue Rows Older Than 14 Days',
    parameters: {
      resource: 'row',
      operation: 'deleteRows',
      dataTableId: signalQueue,
      matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'status', condition: 'eq', keyValue: 'sent' }, { keyName: 'createdAt', condition: 'lt', keyValue: expr('{{ $now.minus({ days: 14 }).toISO() }}') }] },
    },
    executeOnce: true,
    position: [1820, 160],
  },
  output: [{ deletedCount: 3 }],
});

const emptyQueueSilence = node({
  type: 'n8n-nodes-base.noOp',
  version: 1,
  config: { name: 'Silence (empty queue)', parameters: {}, position: [780, 400] },
  output: [{}],
});

const dispatchNote = sticky('## Dispatch throttle contract\nFlushes all pending rows as one digest every 30 minutes. An empty queue produces silence. Immediate delivery is reserved for collector fast paths, currently CI failures.', [fetchPendingRows, postDigestToYui, markRowSent], { color: 5 });

export default workflow('sg-dispatch', 'sg-dispatch')
  .add(dispatchNote)
  .add(dispatchSchedule)
  .to(fetchPendingRows)
  .to(hasPendingRows
    .onTrue(composeDigestBody.to(postDigestToYui.to(restorePostedRows.to(markRowSent.to(deleteExpiredSentRows)))))
    .onFalse(emptyQueueSilence));
