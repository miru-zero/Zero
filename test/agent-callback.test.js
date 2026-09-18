const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const orchestrator = require('../src/providers/chatgpt/agents/orchestrator');
const taskRegistry = require('../src/providers/chatgpt/agents/task-registry');

const setup = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-agent-callback-'));
  return { dir, taskFile: path.join(dir, 'tasks.json') };
};

test('spawnAgent tells worker how to return explicitly instead of relying on polling', async () => {
  const ctx = setup();
  const sends = [];
  await orchestrator.spawnAgent({
    taskFile: ctx.taskFile, taskId: 'T1', workerConversationId: 'C_WORKER',
    parentConversationId: 'C_MAIN', parentTurnId: 'N_MAIN', taskMessage: 'do one cycle',
    sendConversation: async (input) => { sends.push(input); return { current_node: 'N_DISPATCH' }; }
  });
  assert.match(sends[0].message, /do one cycle/);
  assert.match(sends[0].message, /task_id=T1/);
  assert.match(sends[0].message, /zero chatgpt agent return T1/);
  assert.match(sends[0].message, /FACT \/ VERIFIED \/ BLOCKER \/ STATE \/ NEXT/);
  fs.rmSync(ctx.dir, { recursive: true, force: true });
});

test('returnAgent pushes report directly to recorded parent and marks task delivered', async () => {
  const ctx = setup();
  taskRegistry.createTask({ filePath: ctx.taskFile, task: {
    task_id: 'T1', parent_task_id: null, parent_conversation_id: 'C_MAIN',
    parent_turn_id: 'N_MAIN', worker_conversation_id: 'C_WORKER',
    dispatch_node_id: 'N_DISPATCH', status: 'RUNNING'
  }});
  const sends = [];
  const result = await orchestrator.returnAgent({
    taskFile: ctx.taskFile, taskId: 'T1', report: 'FACT\n- done\nNEXT\n- stop',
    sendConversation: async (input) => { sends.push(input); return { current_node: 'N_PARENT_RETURN' }; }
  });
  assert.equal(sends.length, 1);
  assert.equal(sends[0].conversationId, 'C_MAIN');
  assert.equal(sends[0].waitForFinal, false);
  assert.match(sends[0].message, /\[ZERO_SUBAGENT_RESULT\]/);
  assert.match(sends[0].message, /task_id=T1/);
  assert.match(sends[0].message, /FACT\n- done/);
  assert.equal(result.status, 'DELIVERED');
  const task = taskRegistry.getTask({ filePath: ctx.taskFile, taskId: 'T1' });
  assert.equal(task.status, 'DONE');
  assert.equal(task.result_text, 'FACT\n- done\nNEXT\n- stop');
  assert.equal(task.delivery_status, 'DELIVERED');
  assert.equal(task.delivery_node_id, 'N_PARENT_RETURN');
  fs.rmSync(ctx.dir, { recursive: true, force: true });
});