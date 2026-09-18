const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');

const cli = path.resolve(__dirname, '../src/cli.js');
const missingAuthFile = path.join(os.tmpdir(), 'zero-cli-missing-auth.json');

const makeJwt = (exp) => {
  const enc = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${enc({ alg: 'none', typ: 'JWT' })}.${enc({ sub: 'user', exp })}.secret`;
};

const run = (token) => {
  const env = {
    ...process.env,
    ZERO_CHATGPT_ACCESS_TOKEN: token || '',
    ZERO_CHATGPT_AUTH_FILE: missingAuthFile
  };
  return spawnSync(process.execPath, [cli, 'auth', 'status'], {
    encoding: 'utf8',
    env
  });
};

test('CLI reports VALID without printing the accessToken', () => {
  const token = makeJwt(Math.floor(Date.now() / 1000) + 120);  const result = run(token);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /VALID/);
  assert.doesNotMatch(result.stdout, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('CLI reports EXPIRED with exit code 3', () => {
  const token = makeJwt(Math.floor(Date.now() / 1000) - 10);
  const result = run(token);
  assert.equal(result.status, 3);
  assert.match(result.stdout, /EXPIRED/);
});

test('CLI reports MISSING with exit code 2', () => {
  const result = run('');
  assert.equal(result.status, 2);
  assert.match(result.stdout, /MISSING/);
});