const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const watcher = require('../src/providers/chatgpt/agents/watcher');

test('watcher run stays alive while work exists and exits after consecutive idle scans', async () => {
  const sequence = [
    { active: 1, pending: 0 },
    { active: 0, pending: 0 },
    { active: 0, pending: 0 }
  ];
  let scans = 0;
  let sleeps = 0;
  const result = await watcher.run({
    idleScans: 2,
    pollMs: 1,
    scanOnceImpl: async () => { scans += 1; return sequence.shift(); },
    sleepImpl: async () => { sleeps += 1; }
  });
  assert.equal(result.status, 'IDLE_EXIT');
  assert.equal(scans, 3);
  assert.equal(sleeps, 2);
});

test('ensureRunning reuses a live watcher pid', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-agent-watcher-pid-'));
  const pidFile = path.join(dir, 'watcher.pid');
  fs.writeFileSync(pidFile, '4321');
  let spawned = false;
  const result = watcher.ensureRunning({
    pidFile,
    processIsAlive: (pid) => pid === 4321,
    spawnImpl: () => { spawned = true; throw new Error('should not spawn'); }
  });
  assert.equal(result.started, false);
  assert.equal(result.pid, 4321);
  assert.equal(spawned, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('ensureRunning replaces stale pid and detaches a new watcher', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-agent-watcher-spawn-'));
  const pidFile = path.join(dir, 'watcher.pid');
  fs.writeFileSync(pidFile, '9999');
  let unrefCalled = false;
  let spawnArgs = null;
  const result = watcher.ensureRunning({
    pidFile,
    taskFile: path.join(dir, 'tasks.json'),
    mailboxFile: path.join(dir, 'mailbox.json'),
    processIsAlive: () => false,
    spawnImpl: (cmd, args, options) => {
      spawnArgs = { cmd, args, options };
      return { pid: 7777, unref: () => { unrefCalled = true; } };
    }
  });
  assert.equal(result.started, true);
  assert.equal(result.pid, 7777);
  assert.equal(fs.readFileSync(pidFile, 'utf8'), '7777');
  assert.equal(unrefCalled, true);
  assert.equal(spawnArgs.options.detached, true);
  fs.rmSync(dir, { recursive: true, force: true });
});


test('ensureRunning retries after an EEXIST reservation race with a stale pid', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-agent-watcher-race-'));
  const pidFile = path.join(dir, 'watcher.pid');
  const originalOpenSync = fs.openSync;
  let injectedRace = false;
  try {
    fs.openSync = (...args) => {
      if (args[0] === pidFile && !injectedRace) {
        injectedRace = true;
        fs.writeFileSync(pidFile, '9999');
        const error = new Error('simulated reservation race');
        error.code = 'EEXIST';
        throw error;
      }
      return originalOpenSync(...args);
    };
    const result = watcher.ensureRunning({
      pidFile,
      processIsAlive: () => false,
      spawnImpl: () => ({ pid: 7778, unref() {} })
    });
    assert.equal(result.started, true);
    assert.equal(result.pid, 7778);
  } finally {
    fs.openSync = originalOpenSync;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
