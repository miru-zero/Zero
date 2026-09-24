'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cli = require('../src/cli');

const tempEnv = () => ({
  ZERO_AGENT_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'zero-agent-setup-')),
  ZERO_MCP_ROOT: 'M:/Zero_MCP',
  ZERO_AGENT_SKIP_GLOBAL_INSTALL: '1'
});

test('setup initializes device and prints pairing instructions without code', async () => {
  const env = tempEnv();
  const code = await cli.run(['setup', '--name', 'TON', '--server', 'https://zero.miru.work', '--no-global'], env);
  assert.equal(code, 0);
  const device = JSON.parse(fs.readFileSync(path.join(env.ZERO_AGENT_HOME, 'device.json'), 'utf8'));
  assert.equal(device.name, 'TON');
  assert.equal(device.host, os.hostname());
  assert.equal(device.server, 'https://zero.miru.work');
  assert.equal(device.device_id, null);
});

test('usage includes npx-friendly setup command', () => {
  assert.match(cli.usage(), /zero-agent setup/);
  assert.match(cli.usage(), /--code <pairing-code>/);
});
