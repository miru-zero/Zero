const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const orchestrator = require('../src/providers/chatgpt/agents/orchestrator');
const taskRegistry = require('../src/providers/chatgpt/agents/task-registry');
const mailbox = require('../src/providers/chatgpt/agents/mailbox');

const setup = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-takeover-gate-'));
  return {
    dir,
    taskFile: path.join(dir, 'tasks.json'),
    mailboxFile: path.join(dir, 'mailbox.json'),
    conversionsDir: path.join(dir, 'conversions')
  };
};

const parent = {
  conversation_id: 'C_MAIN',
  current_node: 'N_MAIN',
  gizmo_id: 'P1',
  user_turns: 5
};
test('spawnTakeover blocks before START when audit is incomplete', async () => {
  const ctx = setup();
  const sends = [];
  const out = await orchestrator.spawnTakeover({
    taskFile: ctx.taskFile,
    conversionsDir: ctx.conversionsDir,
    parentConversationId: 'C_MAIN',
    taskMessage: 'continue',
    taskId: 'T_BLOCK',
    getConversation: async () => parent,
    createConversation: async () => ({
      conversation_id: 'C_WORKER', current_node: 'N_INIT'
    }),
    runAudit: async () => ({
      complete: false, cursor: 4, nextWindow: { start: 5, end: 5 }
    }),
    sendConversation: async (input) => {
      sends.push(input);
      return { current_node: 'N_START' };
    }
  });
  assert.equal(out.status, 'AUDIT_BLOCKED');
  assert.equal(out.audit_cursor, 4);
  assert.equal(out.audit_total_user_turns, 5);
  assert.equal(out.audit_next_window, '5-5');
  assert.equal(sends.length, 0);
  const task = taskRegistry.getTask({ filePath: ctx.taskFile, taskId: 'T_BLOCK' });
  assert.equal(task.status, 'AUDIT_BLOCKED');
  assert.equal(task.audit_complete, false);  assert.equal(task.source_snapshot_node_id, 'N_MAIN');
  assert.equal(task.audit_total_user_turns, 5);
  fs.rmSync(ctx.dir, { recursive: true, force: true });
});

test('spawnTakeover opens START only after audit completes', async () => {
  const ctx = setup();
  const sends = [];
  const out = await orchestrator.spawnTakeover({
    taskFile: ctx.taskFile,
    conversionsDir: ctx.conversionsDir,
    parentConversationId: 'C_MAIN',
    taskMessage: 'continue',
    taskId: 'T_PASS',
    getConversation: async () => parent,
    createConversation: async () => ({
      conversation_id: 'C_WORKER', current_node: 'N_INIT'
    }),
    runAudit: async ({ onProgress }) => {
      await onProgress({ cursor: 4, window: { start: 1, end: 4 } });
      await onProgress({ cursor: 5, window: { start: 5, end: 5 } });
      return { complete: true, cursor: 5, nextWindow: null };
    },
    sendConversation: async (input) => {
      sends.push(input);
      return { previous_node: 'N_INIT', current_node: 'N_START' };
    }
  });
  assert.equal(out.status, 'DISPATCHED');  assert.equal(sends.length, 1);
  assert.match(sends[0].message, /ZERO_TAKEOVER_START/);
  const task = taskRegistry.getTask({ filePath: ctx.taskFile, taskId: 'T_PASS' });
  assert.equal(task.status, 'RUNNING');
  assert.equal(task.audit_complete, true);
  assert.equal(task.audit_cursor, 5);
  assert.deepEqual(task.audit_windows_verified, ['1-4', '5-5']);
  fs.rmSync(ctx.dir, { recursive: true, force: true });
});

test('returnAgent cannot bypass incomplete takeover audit', async () => {
  const ctx = setup();
  taskRegistry.createTask({ filePath: ctx.taskFile, task: {
    task_id: 'T_RETURN',
    parent_conversation_id: 'C_MAIN',
    parent_turn_id: 'N_MAIN',
    worker_conversation_id: 'C_WORKER',
    mode: 'TAKEOVER',
    audit_cursor: 4,
    audit_total_user_turns: 5,
    audit_complete: false,
    status: 'AUDITING'
  }});
  await assert.rejects(
    orchestrator.returnAgent({
      taskFile: ctx.taskFile, taskId: 'T_RETURN', report: 'done'
    }),
    /TAKEOVER_AUDIT_INCOMPLETE:4\/5/
  );  fs.rmSync(ctx.dir, { recursive: true, force: true });
});

test('checkTask ignores final worker message while audit gate is closed', async () => {
  const ctx = setup();
  taskRegistry.createTask({ filePath: ctx.taskFile, task: {
    task_id: 'T_CHECK',
    parent_conversation_id: 'C_MAIN',
    parent_turn_id: 'N_MAIN',
    worker_conversation_id: 'C_WORKER',
    mode: 'TAKEOVER',
    audit_cursor: 4,
    audit_total_user_turns: 5,
    audit_complete: false,
    status: 'RUNNING'
  }});
  const out = await orchestrator.checkTask({
    taskFile: ctx.taskFile,
    mailboxFile: ctx.mailboxFile,
    taskId: 'T_CHECK',
    getConversation: async () => ({
      current_node: 'N_DONE',
      messages: [{
        id: 'N_DONE', author: { role: 'assistant' },
        content: { content_type: 'text', parts: ['premature'] },
        status: 'finished_successfully', end_turn: true
      }]
    })  });
  assert.equal(out.status, 'RUNNING');
  assert.equal(mailbox.list({ filePath: ctx.mailboxFile }).length, 0);
  fs.rmSync(ctx.dir, { recursive: true, force: true });
});

test('sendMessage preserves AUDITING status before gate opens', async () => {
  const ctx = setup();
  taskRegistry.createTask({ filePath: ctx.taskFile, task: {
    task_id: 'T_SAY',
    parent_conversation_id: 'C_MAIN',
    parent_turn_id: 'N_MAIN',
    worker_conversation_id: 'C_WORKER',
    mode: 'TAKEOVER',
    audit_complete: false,
    status: 'AUDITING'
  }});
  await orchestrator.sendMessage({
    taskFile: ctx.taskFile,
    taskId: 'T_SAY',
    message: 'correction',
    sendConversation: async () => ({
      previous_node: 'N0', current_node: 'N1'
    })
  });
  const task = taskRegistry.getTask({ filePath: ctx.taskFile, taskId: 'T_SAY' });
  assert.equal(task.status, 'AUDITING');
  fs.rmSync(ctx.dir, { recursive: true, force: true });
});
test('resumeTakeover keeps same worker and cursor on repeated 429', async () => {
  const ctx = setup();
  taskRegistry.createTask({ filePath: ctx.taskFile, task: {
    task_id: 'T_RESUME_429',
    parent_conversation_id: 'C_MAIN',
    parent_turn_id: 'N_MAIN',
    worker_conversation_id: 'C_WORKER',
    mode: 'TAKEOVER',
    task_message: 'continue',
    takeover_phase: 'AUDIT',
    audit_total_user_turns: 9,
    audit_window_size: 4,
    audit_cursor: 4,
    audit_windows_verified: ['1-4'],
    audit_complete: false,
    status: 'RATE_LIMITED'
  }});
  let seen = null;
  const out = await orchestrator.resumeTakeover({
    taskFile: ctx.taskFile,
    taskId: 'T_RESUME_429',
    runAudit: async (input) => {
      seen = input;
      return {
        complete: false, cursor: 4,
        nextWindow: { start: 5, end: 8 },
        rateLimited: true, httpStatus: 429, error: '429'
      };
    },
    sendConversation: async () => { throw new Error('must not start'); }
  });
  assert.equal(out.status, 'RATE_LIMITED');
  assert.equal(out.agent_id, 'C_WORKER');
  assert.equal(out.audit_cursor, 4);
  assert.equal(out.audit_next_window, '5-8');
  assert.equal(seen.initialCursor, 4);
  fs.rmSync(ctx.dir, { recursive: true, force: true });
});
test('resumeTakeover opens START in the same worker after audit completes', async () => {
  const ctx = setup();
  taskRegistry.createTask({ filePath: ctx.taskFile, task: {
    task_id: 'T_RESUME_OK',
    parent_conversation_id: 'C_MAIN',
    parent_turn_id: 'N_MAIN',
    worker_conversation_id: 'C_WORKER',
    mode: 'TAKEOVER',
    task_message: 'continue real NEXT',
    takeover_phase: 'AUDIT',
    audit_total_user_turns: 5,
    audit_window_size: 4,
    audit_cursor: 4,
    audit_windows_verified: ['1-4'],
    audit_complete: false,
    status: 'RATE_LIMITED'
  }});
  const sends = [];
  const out = await orchestrator.resumeTakeover({
    taskFile: ctx.taskFile,
    taskId: 'T_RESUME_OK',
    runAudit: async ({ onProgress, initialCursor }) => {
      assert.equal(initialCursor, 4);
      await onProgress({ cursor: 5, window: { start: 5, end: 5 } });
      return { complete: true, cursor: 5, nextWindow: null, rateLimited: false };
    },
    sendConversation: async (input) => {
      sends.push(input);
      return { previous_node: 'N_AUDIT', current_node: 'N_START' };
    }
  });
  assert.equal(out.status, 'DISPATCHED');
  assert.equal(out.agent_id, 'C_WORKER');
  assert.equal(sends.length, 1);
  assert.equal(sends[0].conversationId, 'C_WORKER');
  assert.match(sends[0].message, /ZERO_TAKEOVER_START/);
  const task = taskRegistry.getTask({ filePath: ctx.taskFile, taskId: 'T_RESUME_OK' });
  assert.equal(task.status, 'RUNNING');
  assert.equal(task.audit_complete, true);
  assert.equal(task.audit_cursor, 5);
  assert.deepEqual(task.audit_windows_verified, ['1-4', '5-5']);
  fs.rmSync(ctx.dir, { recursive: true, force: true });
});
test('resumeTakeover respects retry_not_before without touching network', async () => {
  const ctx = setup();
  const retryAt = new Date(Date.now() + 60000).toISOString();
  taskRegistry.createTask({ filePath: ctx.taskFile, task: {
    task_id: 'T_COOLDOWN',
    parent_conversation_id: 'C_MAIN',
    parent_turn_id: 'N_MAIN',
    worker_conversation_id: 'C_WORKER',
    mode: 'TAKEOVER',
    task_message: 'continue',
    takeover_phase: 'AUDIT',
    audit_total_user_turns: 9,
    audit_window_size: 4,
    audit_cursor: 4,
    audit_windows_verified: ['1-4'],
    audit_next_window: '5-8',
    audit_complete: false,
    retry_after_ms: 60000,
    retry_not_before: retryAt,
    status: 'RATE_LIMITED'
  }});
  let touched = false;
  const out = await orchestrator.resumeTakeover({
    taskFile: ctx.taskFile,
    taskId: 'T_COOLDOWN',
    getConversation: async () => { touched = true; throw new Error('network touched'); },
    sendConversation: async () => { touched = true; throw new Error('network touched'); },
    runAudit: async () => { touched = true; throw new Error('audit touched'); }
  });
  assert.equal(out.status, 'RATE_LIMITED');
  assert.equal(out.agent_id, 'C_WORKER');
  assert.equal(out.audit_cursor, 4);
  assert.equal(out.audit_next_window, '5-8');
  assert.equal(out.retry_not_before, retryAt);
  assert.ok(out.retry_after_ms > 0);
  assert.equal(touched, false);
  fs.rmSync(ctx.dir, { recursive: true, force: true });
});