const fs = require('node:fs');
const path = require('node:path');


const readState = (filePath) => {
  if (!fs.existsSync(filePath)) return { version: 1, tasks: [] };
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return {
    version: Number(parsed?.version) || 1,
    tasks: Array.isArray(parsed?.tasks) ? parsed.tasks : []
  };
};

const writeState = (filePath, state) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, filePath);
};

const stamp = (task, now = Date.now()) => ({
  ...task,
  created_at: task.created_at || new Date(now).toISOString(),
  updated_at: new Date(now).toISOString()
});

exports.getTask = ({ filePath, taskId }) =>
  readState(filePath).tasks.find((task) => task.task_id === taskId) || null;
exports.listTasks = ({ filePath }) => readState(filePath).tasks;

exports.createTask = ({ filePath, task, now = Date.now() }) => {
  const state = readState(filePath);
  if (!task?.task_id) throw new Error('task_id is required');
  if (state.tasks.some((item) => item.task_id === task.task_id)) {
    throw new Error(`task already exists: ${task.task_id}`);
  }
  let rootTaskId = task.root_task_id || task.task_id;
  if (task.parent_task_id) {
    const parent = state.tasks.find((item) => item.task_id === task.parent_task_id);
    if (!parent) throw new Error(`parent task not found: ${task.parent_task_id}`);
    rootTaskId = parent.root_task_id || parent.task_id;
  }
  const created = stamp({
    result_node_id: null,
    delivery_status: 'PENDING',
    ...task,
    root_task_id: rootTaskId
  }, now);
  state.tasks.push(created);
  writeState(filePath, state);
  return created;
};

exports.updateTask = ({ filePath, taskId, patch, now = Date.now() }) => {
  const state = readState(filePath);
  const index = state.tasks.findIndex((task) => task.task_id === taskId);
  if (index < 0) throw new Error(`task not found: ${taskId}`);
  const updated = stamp({ ...state.tasks[index], ...patch, task_id: taskId }, now);
  state.tasks[index] = updated;
  writeState(filePath, state);
  return updated;
};

