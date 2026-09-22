const test = require('node:test');
const assert = require('node:assert/strict');

const audit = require('../src/providers/chatgpt/agents/takeover-audit');

const call = (id, source, start, end) => ({
  id,
  author: { role: 'assistant' },
  recipient: 'api_tool.call_tool',
  content: {
    content_type: 'code',
    text: `start_process conversation get ${source} limit ${start}-${end} debug`
  }
});

const result = (id, source, start, end) => ({
  id,
  author: { role: 'tool' },
  recipient: 'all',
  content: {
    content_type: 'code',
    text: [`conversation_id=${source}`, ...Array.from(
      { length: end - start + 1 },
      (_, i) => `[#${start + i}] USER`
    )].join('\n')
  }
});
test('buildWindows covers 25 turns without gaps or overlap', () => {
  assert.deepEqual(audit.buildWindows(25, 4), [
    { start: 1, end: 4 },
    { start: 5, end: 8 },
    { start: 9, end: 12 },
    { start: 13, end: 16 },
    { start: 17, end: 20 },
    { start: 21, end: 24 },
    { start: 25, end: 25 }
  ]);
});

test('verifyWindow requires matching call and complete tool result', () => {
  const source = 'C_MAIN';
  assert.equal(audit.verifyWindow({ messages: [call('C1', source, 1, 4)] }, {
    sourceConversationId: source, start: 1, end: 4
  }), false);
  assert.equal(audit.verifyWindow({ messages: [
    call('C1', source, 1, 4), result('R1', source, 1, 3)
  ] }, { sourceConversationId: source, start: 1, end: 4 }), false);
  assert.equal(audit.verifyWindow({ messages: [
    call('C1', source, 1, 4), result('R1', source, 1, 4)
  ] }, { sourceConversationId: source, start: 1, end: 4 }), true);
});
test('runAudit advances only after verified windows', async () => {
  const source = 'C_MAIN';
  const worker = { messages: [
    call('C1', source, 1, 4),
    result('R1', source, 1, 4)
  ] };
  const sent = [];
  const progress = [];
  const out = await audit.runAudit({
    taskId: 'T1',
    sourceConversationId: source,
    workerConversationId: 'C_WORKER',
    totalUserTurns: 9,
    windowSize: 4,
    getConversation: async () => worker,
    sendConversation: async (input) => {
      sent.push(input.message);
      const match = input.message.match(/audit_window=(\d+)-(\d+)/);
      const start = Number(match[1]);
      const end = Number(match[2]);
      worker.messages.push(call(`C${start}`, source, start, end));
      worker.messages.push(result(`R${start}`, source, start, end));
      return { current_node: `N${end}` };
    },
    onProgress: async (state) => progress.push(state.cursor)
  });  assert.equal(out.complete, true);
  assert.equal(out.cursor, 9);
  assert.deepEqual(progress, [4, 8, 9]);
  assert.equal(sent.length, 2);
  assert.match(sent[0], /audit_window=5-8/);
  assert.match(sent[1], /audit_window=9-9/);
});

test('runAudit blocks at first window without evidence', async () => {
  const sent = [];
  const out = await audit.runAudit({
    taskId: 'T2',
    sourceConversationId: 'C_MAIN',
    workerConversationId: 'C_WORKER',
    totalUserTurns: 5,
    windowSize: 4,
    getConversation: async () => ({ messages: [] }),
    sendConversation: async (input) => {
      sent.push(input.message);
      return { current_node: 'N1' };
    }
  });
  assert.equal(out.complete, false);
  assert.equal(out.cursor, 0);
  assert.deepEqual(out.nextWindow, { start: 1, end: 4 });
  assert.equal(sent.length, 1);
});
test('runAudit keeps cursor and reports RATE_LIMITED without throwing', async () => {
  const error = new Error('ChatGPT request failed (429)');
  error.status = 429;
  const out = await audit.runAudit({
    taskId: 'T429',
    sourceConversationId: 'C_MAIN',
    workerConversationId: 'C_WORKER',
    totalUserTurns: 9,
    windowSize: 4,
    initialCursor: 4,
    getConversation: async () => { throw error; },
    sendConversation: async () => { throw new Error('must not send'); }
  });
  assert.equal(out.complete, false);
  assert.equal(out.rateLimited, true);
  assert.equal(out.httpStatus, 429);
  assert.equal(out.cursor, 4);
  assert.deepEqual(out.nextWindow, { start: 5, end: 8 });
});

test('runAudit resumes after initialCursor without rereading verified windows', async () => {
  const source = 'C_MAIN';
  const worker = { messages: [] };
  const sent = [];
  const out = await audit.runAudit({
    taskId: 'T_RESUME',
    sourceConversationId: source,
    workerConversationId: 'C_WORKER',
    totalUserTurns: 9,
    windowSize: 4,
    initialCursor: 4,
    getConversation: async () => worker,
    sendConversation: async (input) => {
      sent.push(input.message);
      const m = input.message.match(/audit_window=(\d+)-(\d+)/);
      const start = Number(m[1]);
      const end = Number(m[2]);
      worker.messages.push(call(`C${start}`, source, start, end));
      worker.messages.push(result(`R${start}`, source, start, end));
      return { current_node: `N${end}` };
    }
  });
  assert.equal(out.complete, true);
  assert.equal(out.cursor, 9);
  assert.equal(sent.length, 2);
  assert.match(sent[0], /audit_window=5-8/);
  assert.match(sent[1], /audit_window=9-9/);
});