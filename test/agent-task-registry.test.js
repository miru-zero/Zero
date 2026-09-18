const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const taskRegistry = require('../src/providers/chatgpt/agents/task-registry');

const setup = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-agent-registry-'));
  return { dir, filePath: path.join(dir, 'tasks.json') };
};

test('task registry creates a root task without mixing message lineage', () => {
  const ctx = setup();
  const task = taskRegistry.createTask({
    filePath: ctx.filePath,
    task: {
      task_id: 'T1',
      parent_task_id: null,
      parent_conversation_id: 'C_MAIN',
      parent_turn_id: 'N_MAIN',
      worker_conversation_id: 'C_WORKER',
      dispatch_node_id: 'N_WORKER_USER',
      status: 'RUNNING'
    }
  });
  assert.equal(task.root_task_id, 'T1');
  assert.equal(task.parent_task_id, null);
  assert.equal(task.parent_turn_id, 'N_MAIN');
  assert.notEqual(task.parent_turn_id, task.parent_task_id);
  fs.rmSync(ctx.dir, { recursive: true, force: true });
});
test('task registry inherits root lineage from its parent task', () => {
  const ctx = setup();
  taskRegistry.createTask({ filePath: ctx.filePath, task: {
    task_id: 'T1', parent_task_id: null, parent_conversation_id: 'C0',
    parent_turn_id: 'N0', worker_conversation_id: 'C1', dispatch_node_id: 'N1', status: 'RUNNING'
  }});
  const child = taskRegistry.createTask({ filePath: ctx.filePath, task: {
    task_id: 'T1.A', parent_task_id: 'T1', parent_conversation_id: 'C1',
    parent_turn_id: 'N2', worker_conversation_id: 'C2', dispatch_node_id: 'N3', status: 'RUNNING'
  }});
  assert.equal(child.root_task_id, 'T1');
  assert.equal(child.parent_task_id, 'T1');
  fs.rmSync(ctx.dir, { recursive: true, force: true });
});

test('task registry persists updates and lists tasks', () => {
  const ctx = setup();
  taskRegistry.createTask({ filePath: ctx.filePath, task: {
    task_id: 'T1', parent_task_id: null, parent_conversation_id: 'C0',
    parent_turn_id: 'N0', worker_conversation_id: 'C1', dispatch_node_id: 'N1', status: 'RUNNING'
  }});
  const updated = taskRegistry.updateTask({ filePath: ctx.filePath, taskId: 'T1', patch: {
    status: 'DONE', result_node_id: 'N_DONE'
  }});
  assert.equal(updated.status, 'DONE');
  assert.equal(taskRegistry.getTask({ filePath: ctx.filePath, taskId: 'T1' }).result_node_id, 'N_DONE');
  assert.equal(taskRegistry.listTasks({ filePath: ctx.filePath }).length, 1);
  const disk = JSON.parse(fs.readFileSync(ctx.filePath, 'utf8'));
  assert.equal(disk.tasks[0].task_id, 'T1');
  fs.rmSync(ctx.dir, { recursive: true, force: true });
});
