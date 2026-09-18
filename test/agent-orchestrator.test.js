const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const orchestrator = require('../src/providers/chatgpt/agents/orchestrator');
const taskRegistry = require('../src/providers/chatgpt/agents/task-registry');
const mailbox = require('../src/providers/chatgpt/agents/mailbox');

const setup = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-agent-orchestrator-'));
  return {
    dir,
    taskFile: path.join(dir, 'tasks.json'),
    mailboxFile: path.join(dir, 'mailbox.json')
  };
};

const message = (id, role, text, status = null, endTurn = null) => ({
  id,
  author: { role },
  content: { content_type: 'text', parts: [text] },
  status,
  end_turn: endTurn
});

test('spawnAgent resolves parent turn, dispatches worker, and persists RUNNING task', async () => {
  const ctx = setup();
  const sends = [];
  const result = await orchestrator.spawnAgent({
    taskFile: ctx.taskFile,
    mailboxFile: ctx.mailboxFile,
    workerConversationId: 'C_WORKER',
    parentConversationId: 'C_MAIN',
    taskMessage: 'research this',
    taskId: 'T1',
    getConversation: async ({ conversationId }) => ({ conversation_id: conversationId, current_node: 'N_MAIN' }),
    sendConversation: async (input) => { sends.push(input); return { conversation_id: input.conversationId, current_node: 'N_WORKER_USER' }; }
  });
  assert.equal(result.status, 'DISPATCHED');
  assert.equal(result.task_id, 'T1');
  assert.equal(result.agent_id, 'C_WORKER');
  assert.equal(sends.length, 1);
  assert.equal(sends[0].waitForFinal, false);
  const task = taskRegistry.getTask({ filePath: ctx.taskFile, taskId: 'T1' });
  assert.equal(task.parent_conversation_id, 'C_MAIN');
  assert.equal(task.parent_turn_id, 'N_MAIN');
  assert.equal(task.worker_conversation_id, 'C_WORKER');
  assert.equal(task.dispatch_node_id, 'N_WORKER_USER');
  assert.equal(task.status, 'RUNNING');
  fs.rmSync(ctx.dir, { recursive: true, force: true });
});

test('checkTask marks final worker result DONE and enqueues SUBAGENT_RETURN once', async () => {
  const ctx = setup();
  taskRegistry.createTask({ filePath: ctx.taskFile, task: {
    task_id: 'T1', parent_task_id: null, parent_conversation_id: 'C_MAIN',
    parent_turn_id: 'N_MAIN', worker_conversation_id: 'C_WORKER',
    dispatch_node_id: 'N_WORKER_USER', status: 'RUNNING'
  }});
  const worker = {
    conversation_id: 'C_WORKER', current_node: 'N_DONE',
    messages: [message('N_WORKER_USER', 'user', 'work'), message('N_DONE', 'assistant', 'RESULT', 'finished_successfully', true)]
  };
  const first = await orchestrator.checkTask({
    taskFile: ctx.taskFile, mailboxFile: ctx.mailboxFile, taskId: 'T1',
    getConversation: async () => worker
  });
  const second = await orchestrator.checkTask({
    taskFile: ctx.taskFile, mailboxFile: ctx.mailboxFile, taskId: 'T1',
    getConversation: async () => worker
  });
  assert.equal(first.status, 'DONE');
  assert.equal(first.result_node_id, 'N_DONE');
  assert.equal(first.result_text, 'RESULT');
  assert.equal(second.status, 'DONE');
  const events = mailbox.list({ filePath: ctx.mailboxFile });
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'SUBAGENT_RETURN');
  assert.equal(events[0].task_id, 'T1');
  assert.equal(events[0].result_text, 'RESULT');
  fs.rmSync(ctx.dir, { recursive: true, force: true });
});

test('deliverEvent resumes the recorded parent non-blocking and acknowledges mailbox event', async () => {
  const ctx = setup();
  taskRegistry.createTask({ filePath: ctx.taskFile, task: {
    task_id: 'T1', parent_task_id: null, parent_conversation_id: 'C_MAIN',
    parent_turn_id: 'N_MAIN', worker_conversation_id: 'C_WORKER',
    dispatch_node_id: 'N_WORKER_USER', result_node_id: 'N_DONE', status: 'DONE', result_text: 'RESULT'
  }});
  mailbox.enqueue({ filePath: ctx.mailboxFile, event: {
    event_id: 'SUBAGENT_RETURN:T1:N_DONE', type: 'SUBAGENT_RETURN', task_id: 'T1',
    parent_conversation_id: 'C_MAIN', worker_conversation_id: 'C_WORKER',
    result_node_id: 'N_DONE', result_text: 'RESULT', status: 'DONE'
  }});
  const sends = [];
  const delivered = await orchestrator.deliverEvent({
    taskFile: ctx.taskFile, mailboxFile: ctx.mailboxFile,
    eventId: 'SUBAGENT_RETURN:T1:N_DONE',
    sendConversation: async (input) => { sends.push(input); return { conversation_id: input.conversationId, current_node: 'N_PARENT_USER' }; }
  });
  assert.equal(sends.length, 1);
  assert.equal(sends[0].conversationId, 'C_MAIN');
  assert.equal(sends[0].waitForFinal, false);
  assert.match(sends[0].message, /\[ZERO_SUBAGENT_RESULT\]/);
  assert.match(sends[0].message, /task_id=T1/);
  assert.match(sends[0].message, /RESULT/);
  assert.equal(delivered.delivery_node_id, 'N_PARENT_USER');
  assert.equal(delivered.acked, true);
  const task = taskRegistry.getTask({ filePath: ctx.taskFile, taskId: 'T1' });
  assert.equal(task.delivery_status, 'DELIVERED');
  fs.rmSync(ctx.dir, { recursive: true, force: true });
});

test('checkTask leaves incomplete worker RUNNING without mailbox event', async () => {
  const ctx = setup();
  taskRegistry.createTask({ filePath: ctx.taskFile, task: {
    task_id: 'T1', parent_task_id: null, parent_conversation_id: 'C_MAIN',
    parent_turn_id: 'N_MAIN', worker_conversation_id: 'C_WORKER',
    dispatch_node_id: 'N_WORKER_USER', status: 'RUNNING'
  }});
  const task = await orchestrator.checkTask({
    taskFile: ctx.taskFile, mailboxFile: ctx.mailboxFile, taskId: 'T1',
    getConversation: async () => ({
      current_node: 'N_PARTIAL',
      messages: [message('N_PARTIAL', 'assistant', 'partial', 'in_progress', false)]
    })
  });
  assert.equal(task.status, 'RUNNING');
  assert.equal(mailbox.list({ filePath: ctx.mailboxFile }).length, 0);
  fs.rmSync(ctx.dir, { recursive: true, force: true });
});
