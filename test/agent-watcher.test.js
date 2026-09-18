const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const watcher = require('../src/providers/chatgpt/agents/watcher');
const taskRegistry = require('../src/providers/chatgpt/agents/task-registry');
const mailbox = require('../src/providers/chatgpt/agents/mailbox');

const setup = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-agent-watcher-'));
  return { dir, taskFile: path.join(dir, 'tasks.json'), mailboxFile: path.join(dir, 'mailbox.json') };
};

const addTask = (filePath, id, worker) => taskRegistry.createTask({ filePath, task: {
  task_id: id, parent_task_id: null, parent_conversation_id: `P_${id}`,
  parent_turn_id: `PT_${id}`, worker_conversation_id: worker,
  dispatch_node_id: `D_${id}`, status: 'RUNNING'
}});

const msg = (id, role, text, status, endTurn) => ({
  id, author: { role }, content: { content_type: 'text', parts: [text] }, status, end_turn: endTurn
});

test('scanOnce completes finished workers and delivers pending results to their recorded parents', async () => {
  const ctx = setup();
  addTask(ctx.taskFile, 'T1', 'W1');
  addTask(ctx.taskFile, 'T2', 'W2');
  const parentSends = [];
  const conversations = {
    W1: { current_node: 'R1', messages: [msg('R1', 'assistant', 'one', 'finished_successfully', true)] },
    W2: { current_node: 'R2', messages: [msg('R2', 'assistant', 'partial', 'in_progress', false)] }
  };
  const result = await watcher.scanOnce({
    taskFile: ctx.taskFile,
    mailboxFile: ctx.mailboxFile,
    getConversation: async ({ conversationId }) => conversations[conversationId],
    sendConversation: async (input) => {
      parentSends.push(input);
      return { current_node: `PARENT_NODE_${input.conversationId}` };
    }
  });
  assert.equal(result.running_checked, 2);
  assert.equal(result.completed, 1);
  assert.equal(result.delivered, 1);
  assert.equal(taskRegistry.getTask({ filePath: ctx.taskFile, taskId: 'T1' }).status, 'DONE');
  assert.equal(taskRegistry.getTask({ filePath: ctx.taskFile, taskId: 'T1' }).delivery_status, 'DELIVERED');
  assert.equal(taskRegistry.getTask({ filePath: ctx.taskFile, taskId: 'T2' }).status, 'RUNNING');
  assert.equal(parentSends.length, 1);
  assert.equal(parentSends[0].conversationId, 'P_T1');
  assert.equal(parentSends[0].waitForFinal, false);
  assert.equal(mailbox.list({ filePath: ctx.mailboxFile, pendingOnly: true }).length, 0);
  fs.rmSync(ctx.dir, { recursive: true, force: true });
});

test('scanOnce also delivers a pending mailbox event from an earlier completion', async () => {
  const ctx = setup();
  addTask(ctx.taskFile, 'T1', 'W1');
  taskRegistry.updateTask({ filePath: ctx.taskFile, taskId: 'T1', patch: {
    status: 'DONE', result_node_id: 'R1', result_text: 'one'
  }});
  mailbox.enqueue({ filePath: ctx.mailboxFile, event: {
    event_id: 'SUBAGENT_RETURN:T1:R1', type: 'SUBAGENT_RETURN', task_id: 'T1',
    parent_conversation_id: 'P_T1', worker_conversation_id: 'W1', result_node_id: 'R1',
    result_text: 'one', status: 'DONE'
  }});
  let sends = 0;
  const result = await watcher.scanOnce({
    taskFile: ctx.taskFile,
    mailboxFile: ctx.mailboxFile,
    getConversation: async () => { throw new Error('should not check DONE task'); },
    sendConversation: async () => { sends += 1; return { current_node: 'PARENT_NODE' }; }
  });
  assert.equal(result.running_checked, 0);
  assert.equal(result.delivered, 1);
  assert.equal(sends, 1);
  assert.equal(mailbox.list({ filePath: ctx.mailboxFile, pendingOnly: true }).length, 0);
  fs.rmSync(ctx.dir, { recursive: true, force: true });
});
