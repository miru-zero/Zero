const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');

const mainFile = path.resolve(__dirname, '../src/main.js');
const missingAuthFile = path.join(os.tmpdir(), 'zero-main-missing-auth.json');

const makeJwt = (exp) => {
  const enc = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${enc({ alg: 'none', typ: 'JWT' })}.${enc({ sub: 'user', exp })}.secret`;
};

const runMain = (token = '') => {
  const env = {
    ...process.env,
    ZERO_CHATGPT_ACCESS_TOKEN: token,
    ZERO_CHATGPT_AUTH_FILE: missingAuthFile
  };
  return spawnSync(process.execPath, [mainFile], { encoding: 'utf8', env });
};

test('main reports MISSING when accessToken is absent', () => {
  const result = runMain();
  assert.equal(result.status, 2);
  assert.match(result.stdout, /accessToken: MISSING/);
});
test('main reports VALID without printing accessToken', () => {
  const token = makeJwt(Math.floor(Date.now() / 1000) + 120);
  const result = runMain(token);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /accessToken: VALID/);
  assert.doesNotMatch(result.stdout, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('main reports EXPIRED for expired accessToken', () => {
  const token = makeJwt(Math.floor(Date.now() / 1000) - 10);
  const result = runMain(token);
  assert.equal(result.status, 3);
  assert.match(result.stdout, /accessToken: EXPIRED/);
});

test('main run enters Login Menu when accessToken is VALID on TTY', async () => {
  const { PassThrough } = require('node:stream');
  const main = require('../src/main');
  const input = new PassThrough();
  const output = new PassThrough();
  input.isTTY = true;
  output.isTTY = true;
  let screen = '';
  output.on('data', (chunk) => { screen += chunk.toString(); });

  const token = makeJwt(Math.floor(Date.now() / 1000) + 120);
  input.end('0\n');
  const result = await main.run({
    ZERO_CHATGPT_ACCESS_TOKEN: token,
    ZERO_CHATGPT_TOKEN_NAME: 'ZERO1',
    ZERO_CHATGPT_AUTH_FILE: missingAuthFile
  }, input, output);

  assert.equal(result.menuSelection, '0');
  assert.match(screen, /Login Menu/);
  assert.match(screen, /ZERO1/);
});

test('Login ChatGPT menu verifies backend session', async () => {
  const { PassThrough } = require('node:stream');
  const main = require('../src/main');
  const input = new PassThrough();
  const output = new PassThrough();
  input.isTTY = true;
  output.isTTY = true;
  let screen = '';
  output.on('data', (chunk) => { screen += chunk.toString(); });

  const token = makeJwt(Math.floor(Date.now() / 1000) + 120);
  input.end('1\n');
  const result = await main.run({
    ZERO_CHATGPT_ACCESS_TOKEN: token,
    ZERO_CHATGPT_TOKEN_NAME: 'ZERO1',
    ZERO_CHATGPT_AUTH_FILE: missingAuthFile
  }, input, output, {
    verifyLogin: async () => ({ status: 'VERIFIED', httpStatus: 200, tokenName: 'ZERO1' })
  });

  assert.equal(result.chatgpt.status, 'VERIFIED');
  assert.equal(result.chatgpt.httpStatus, 200);
  assert.match(screen, /LOGIN VERIFIED/);
});
