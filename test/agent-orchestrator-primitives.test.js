const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const orchestrator = require('../src/providers/chatgpt/agents/orchestrator');
const taskRegistry = require('../src/providers/chatgpt/agents/task-registry');

const setup = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-agent-primitives-'));
  const taskFile = path.join(dir, 'tasks.json');
  const mailboxFile = path.join(dir, 'mailbox.json');
  taskRegistry.createTask({ filePath: taskFile, task: {
    task_id: 'T1', parent_task_id: null, parent_conversation_id: 'C_MAIN',
    parent_turn_id: 'N_MAIN', worker_conversation_id: 'C_WORKER',
    dispatch_node_id: 'N_DISPATCH', status: 'RUNNING'
  }});
  return { dir, taskFile, mailboxFile };
};

test('listAgents and agentStatus expose task registry state', () => {
  const ctx = setup();
  assert.equal(orchestrator.listAgents({ taskFile: ctx.taskFile }).length, 1);
  assert.equal(orchestrator.agentStatus({ taskFile: ctx.taskFile, taskId: 'T1' }).status, 'RUNNING');
  fs.rmSync(ctx.dir, { recursive: true, force: true });
});

test('agentResult returns completed result without changing task state', () => {
  const ctx = setup();
  taskRegistry.updateTask({ filePath: ctx.taskFile, taskId: 'T1', patch: {
    status: 'DONE', result_node_id: 'N_DONE', result_text: 'RESULT'
  }});
  const result = orchestrator.agentResult({ taskFile: ctx.taskFile, taskId: 'T1' });
  assert.deepEqual(result, {
    task_id: 'T1', status: 'DONE', result_node_id: 'N_DONE', result_text: 'RESULT'
  });
  fs.rmSync(ctx.dir, { recursive: true, force: true });
});

test('sendMessage follows up in worker and resets task to RUNNING', async () => {
  const ctx = setup();
  taskRegistry.updateTask({ filePath: ctx.taskFile, taskId: 'T1', patch: {
    status: 'DONE', result_node_id: 'N_OLD', result_text: 'OLD', delivery_status: 'DELIVERED'
  }});
  const calls = [];
  const result = await orchestrator.sendMessage({
    taskFile: ctx.taskFile,
    taskId: 'T1',
    message: 'continue',
    sendConversation: async (input) => { calls.push(input); return { current_node: 'N_FOLLOWUP' }; }
  });
  assert.equal(calls[0].conversationId, 'C_WORKER');
  assert.equal(calls[0].waitForFinal, false);
  assert.equal(result.status, 'DISPATCHED');
  const task = taskRegistry.getTask({ filePath: ctx.taskFile, taskId: 'T1' });
  assert.equal(task.status, 'RUNNING');
  assert.equal(task.dispatch_node_id, 'N_FOLLOWUP');
  assert.equal(task.result_node_id, null);
  assert.equal(task.delivery_status, 'PENDING');
  fs.rmSync(ctx.dir, { recursive: true, force: true });
});
test('waitAgent polls until task reaches DONE', async () => {
  const ctx = setup();
  let checks = 0;
  const result = await orchestrator.waitAgent({
    taskFile: ctx.taskFile,
    mailboxFile: ctx.mailboxFile,
    taskId: 'T1',
    timeoutMs: 1000,
    pollMs: 1,
    sleepImpl: async () => {},
    checkTaskImpl: async () => {
      checks += 1;
      if (checks === 2) {
        return taskRegistry.updateTask({ filePath: ctx.taskFile, taskId: 'T1', patch: { status: 'DONE' } });
      }
      return taskRegistry.getTask({ filePath: ctx.taskFile, taskId: 'T1' });
    }
  });
  assert.equal(result.status, 'DONE');
  assert.equal(checks, 2);
  fs.rmSync(ctx.dir, { recursive: true, force: true });
});

test('closeAgent marks task CLOSED without touching conversation DAG', () => {
  const ctx = setup();
  const closed = orchestrator.closeAgent({ taskFile: ctx.taskFile, taskId: 'T1' });
  assert.equal(closed.status, 'CLOSED');
  assert.equal(closed.parent_turn_id, 'N_MAIN');
  assert.equal(closed.parent_task_id, null);
  fs.rmSync(ctx.dir, { recursive: true, force: true });
});
