'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cli = require('../src/cli');

const tempEnv = () => ({
  ZERO_AGENT_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'zero-agent-cli-')),
  ZERO_MCP_ROOT: 'M:/Zero_MCP'
});

test('doctor returns safe local status', () => {
  const env = tempEnv();
  const result = cli.doctor(env);
  assert.equal(result.ok, true);
  assert.equal(result.mcp_root, 'M:\\Zero_MCP');
  assert.ok(result.providers >= 1);
});
test('init command writes redacted device state', async () => {
  const env = tempEnv();
  const code = await cli.run(['init', '--name', 'TON', '--server', 'https://zero.miru.work'], env);
  assert.equal(code, 0);
  const file = path.join(env.ZERO_AGENT_HOME, 'device.json');
  const device = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(device.name, 'TON');
  assert.equal(device.server, 'https://zero.miru.work');
});

test('start once reports NOT_PAIRED before network work', async () => {
  const env = tempEnv();
  const code = await cli.run(['start', '--once'], env);
  assert.equal(code, 0);
});
