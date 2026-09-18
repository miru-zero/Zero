const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const oldExitCode = process.exitCode;
const cli = require('../src/cli');
process.exitCode = oldExitCode;

const makeJwt = (exp) => {
  const enc = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${enc({ alg: 'none' })}.${enc({ exp })}.secret`;
};

test('CLI exposes run for conversations command', () => {
  assert.equal(typeof cli.run, 'function');
});

test('zero conversations prints outside and project conversations', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-conversations-'));
  const sessionFile = path.join(dir, 'session.json');
  fs.writeFileSync(sessionFile, JSON.stringify({ headers: { Cookie: 'a=b' } }));
  const output = { text: '', write(value) { this.text += value; } };
  const env = {
    ZERO_CHATGPT_ACCESS_TOKEN: makeJwt(Math.floor(Date.now() / 1000) + 120),
    ZERO_CHATGPT_SESSION_FILE: sessionFile
  };

  const result = await cli.run(['chatgpt', 'conversations'], env, output, {
    listAll: async () => ({
      outside: [{ id: 'outside-1', title: 'Outside Chat' }],
      projects: [{
        id: 'g-p-1',
        name: 'Zero Project',
        conversations: [{ id: 'project-1', title: 'Project Chat' }]
      }],
      total: 2
    })
  });

  assert.equal(result.exitCode, 0);
  assert.match(output.text, /Outside Projects/);
  assert.match(output.text, /Outside Chat/);
  assert.match(output.text, /Zero Project/);
  assert.match(output.text, /Project Chat/);
  assert.match(output.text, /Total: 2 conversations/);
  fs.rmSync(dir, { recursive: true, force: true });
});
