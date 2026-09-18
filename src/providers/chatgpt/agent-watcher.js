const watcher = require('./agents/watcher');

const taskFile = process.env.ZERO_AGENT_TASK_FILE;
const mailboxFile = process.env.ZERO_AGENT_MAILBOX_FILE;
const pidFile = process.env.ZERO_AGENT_WATCHER_PID_FILE;

watcher.run({
  ...(taskFile ? { taskFile } : {}),
  ...(mailboxFile ? { mailboxFile } : {})
}).finally(() => {
  if (pidFile) {
    try {
      require('node:fs').rmSync(pidFile, { force: true });
    } catch {}
  }
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
