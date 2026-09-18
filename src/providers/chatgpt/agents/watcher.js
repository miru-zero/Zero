const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const orchestrator = require('./orchestrator');
const taskRegistry = require('./task-registry');
const mailbox = require('./mailbox');


const defaultTaskFile = path.resolve(__dirname, '../../../runtime/agent-tasks.json');
const defaultMailboxFile = path.resolve(__dirname, '../../../runtime/agent-mailbox.json');

exports.scanOnce = async ({
  taskFile = defaultTaskFile,
  mailboxFile = defaultMailboxFile,
  token,
  sessionHeaders,
  getConversation,
  sendConversation
}) => {
  const running = taskRegistry.listTasks({ filePath: taskFile })
    .filter((task) => task.status === 'RUNNING');
  let completed = 0;
  for (const task of running) {
    const beforeStatus = task.status;
    const after = await orchestrator.checkTask({
      taskFile,
      mailboxFile,
      taskId: task.task_id,
      token,
      sessionHeaders,
      ...(getConversation ? { getConversation } : {})
    });
    if (beforeStatus === 'RUNNING' && after.status === 'DONE') completed += 1;
  }
  const pending = mailbox.list({ filePath: mailboxFile, pendingOnly: true });
  let delivered = 0;
  for (const event of pending) {
    await orchestrator.deliverEvent({
      taskFile,
      mailboxFile,
      eventId: event.event_id,
      token,
      sessionHeaders,
      ...(sendConversation ? { sendConversation } : {})
    });
    delivered += 1;
  }
  return {
    running_checked: running.length,
    completed,
    delivered,
    active: taskRegistry.listTasks({ filePath: taskFile }).filter((task) => task.status === 'RUNNING').length,
    pending: mailbox.list({ filePath: mailboxFile, pendingOnly: true }).length
  };
};

const defaultPidFile = path.resolve(__dirname, '../../../runtime/agent-watcher.pid');
const defaultRunnerPath = path.resolve(__dirname, '../agent-watcher.js');

const defaultProcessIsAlive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

exports.run = async ({
  idleScans = 5,
  pollMs = 1000,
  sleepImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  scanOnceImpl = exports.scanOnce,
  ...scanInput
}) => {
  let idle = 0;
  let last = null;
  while (idle < idleScans) {
    last = await scanOnceImpl(scanInput);
    idle = last.active > 0 || last.pending > 0 ? 0 : idle + 1;
    if (idle < idleScans) await sleepImpl(pollMs);
  }
  return { status: 'IDLE_EXIT', last };
};
exports.ensureRunning = ({
  pidFile = defaultPidFile,
  taskFile = defaultTaskFile,
  mailboxFile = defaultMailboxFile,
  runnerPath = defaultRunnerPath,
  processIsAlive = defaultProcessIsAlive,
  spawnImpl = spawn
} = {}) => {
  fs.mkdirSync(path.dirname(pidFile), { recursive: true });
  if (fs.existsSync(pidFile)) {
    const existingPid = Number(fs.readFileSync(pidFile, 'utf8').trim());
    if (processIsAlive(existingPid)) return { started: false, pid: existingPid };
    fs.rmSync(pidFile, { force: true });
  }

  let reservation = null;
  try {
    reservation = fs.openSync(pidFile, 'wx');
    fs.writeFileSync(reservation, String(process.pid), 'utf8');
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const existingPid = Number(fs.readFileSync(pidFile, 'utf8').trim());
    if (processIsAlive(existingPid)) return { started: false, pid: existingPid };
    fs.rmSync(pidFile, { force: true });
    return exports.ensureRunning({ pidFile, taskFile, mailboxFile, runnerPath, processIsAlive, spawnImpl });
  } finally {
    if (reservation !== null) fs.closeSync(reservation);
  }
  try {
    const child = spawnImpl(process.execPath, [runnerPath], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: {
        ...process.env,
        ZERO_AGENT_TASK_FILE: taskFile,
        ZERO_AGENT_MAILBOX_FILE: mailboxFile,
        ZERO_AGENT_WATCHER_PID_FILE: pidFile
      }
    });
    if (!Number.isInteger(child?.pid) || child.pid <= 0) throw new Error('watcher spawn missing pid');
    fs.writeFileSync(pidFile, String(child.pid), 'utf8');
    child.unref?.();
    return { started: true, pid: child.pid };
  } catch (error) {
    fs.rmSync(pidFile, { force: true });
    throw error;
  }
};

