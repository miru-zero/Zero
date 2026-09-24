'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cli = require('../src/cli');
const pkg = require('../package.json');

const tempEnv = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-agent-autostart-'));
  return {
    ZERO_AGENT_HOME: path.join(root, 'home'),
    APPDATA: path.join(root, 'roaming'),
    USERPROFILE: path.join(root, 'user'),
    ZERO_MCP_ROOT: path.join(root, 'mcp'),
    ZERO_AGENT_ROOTS: [path.join(root, 'Desktop', 'zero'), path.join(root, 'Downloads')].join(path.delimiter),
    ZERO_AGENT_SKIP_GLOBAL_INSTALL: '1'
  };
};

test('start --once bootstraps local config and autostart files when first run from npm start', async () => {
  const env = tempEnv();
  const code = await cli.run(['start', '--once'], env);
  assert.equal(code, 0);
  const deviceFile = path.join(env.ZERO_AGENT_HOME, 'device.json');
  const launcherFile = path.join(env.ZERO_AGENT_HOME, 'start-zero-agent.cmd');
  const startupFile = path.join(env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'MiruZeroAgent.vbs');

  assert.equal(fs.existsSync(deviceFile), true);
  assert.equal(fs.existsSync(launcherFile), true);
  assert.equal(fs.existsSync(startupFile), true);

  const device = JSON.parse(fs.readFileSync(deviceFile, 'utf8'));
  assert.equal(device.server, 'https://zero.miru.work');
  assert.equal(device.name, os.hostname());

  const launcher = fs.readFileSync(launcherFile, 'utf8');
  assert.match(launcher, /ZERO_AGENT_ROOTS=/);
  assert.match(launcher, /zero-agent\.log/);
  assert.match(launcher, /node ".+zero-agent[\\/]bin[\\/]zero-agent\.js" start/);
});

test('setup writes autostart launcher with requested name and roots', async () => {
  const env = tempEnv();
  const code = await cli.run(['setup', '--name', 'TON', '--no-global'], env);
  assert.equal(code, 0);
  const launcher = fs.readFileSync(path.join(env.ZERO_AGENT_HOME, 'start-zero-agent.cmd'), 'utf8');
  assert.match(launcher, /ZERO_AGENT_ROOTS=/);
  assert.match(launcher, /interval=30000ms/);

  const device = JSON.parse(fs.readFileSync(path.join(env.ZERO_AGENT_HOME, 'device.json'), 'utf8'));
  assert.equal(device.name, 'TON');
});
