const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cli = require('../src/cli');
const conversations = require('../src/providers/chatgpt/conversations');

const makeJwt = (exp) => {
  const enc = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${enc({ alg: 'none' })}.${enc({ exp })}.secret`;
};

test('conversation requests expose HTTP status on failure', async () => {
  await assert.rejects(
    conversations.listStandalone({
      token: 'token',
      sessionHeaders: {},
      requestJson: async () => ({ status: 429, json: null })
    }),
    (error) => error.status === 429
  );
});
test('zero conversations reports 429 without fatal error text', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-rate-limit-'));
  const sessionFile = path.join(dir, 'session.json');
  fs.writeFileSync(sessionFile, JSON.stringify({ headers: { Cookie: 'a=b' } }));
  const output = { text: '', write(value) { this.text += value; } };
  const error = new Error('ChatGPT request failed (429)');
  error.status = 429;

  const result = await cli.run(['chatgpt', 'conversations'], {
    ZERO_CHATGPT_ACCESS_TOKEN: makeJwt(Math.floor(Date.now() / 1000) + 120),
    ZERO_CHATGPT_SESSION_FILE: sessionFile
  }, output, {
    listAll: async () => { throw error; }
  });

  assert.equal(result.exitCode, 75);
  assert.match(output.text, /RATE_LIMITED/);
  assert.match(output.text, /HTTP 429/);
  assert.doesNotMatch(output.text, /fatal|ChatGPT request failed/i);
  fs.rmSync(dir, { recursive: true, force: true });
});
