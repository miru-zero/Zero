'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const config = require('../src/config');

const tempEnv = () => ({ ZERO_AGENT_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'zero-agent-')) });

test('save/load device redacts token for display', () => {
  const env = tempEnv();
  config.saveDevice({ name: 'TON', device_id: 'dev1', device_token: 'secret' }, env);
  const loaded = config.loadDevice(env);
  assert.equal(loaded.device_token, 'secret');
  assert.equal(config.redactedDevice(loaded).device_token, 'REDACTED');
});
