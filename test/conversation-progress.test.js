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

const setupCli = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-progress-'));
  const sessionFile = path.join(dir, 'session.json');
  fs.writeFileSync(sessionFile, JSON.stringify({ headers: { Cookie: 'a=b' } }));
  return {
    dir,
    env: { ZERO_CHATGPT_ACCESS_TOKEN: makeJwt(Math.floor(Date.now() / 1000) + 120), ZERO_CHATGPT_SESSION_FILE: sessionFile },
    output: { text: '', write(value) { this.text += value; } }
  };
};
test('zero conversations writes progress before listAll finishes', async () => {
  const ctx = setupCli();
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const runPromise = cli.run(['chatgpt', 'conversations'], ctx.env, ctx.output, {
    listAll: async () => pending
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.match(ctx.output.text, /Loading conversations/);

  release({ outside: [], projects: [], total: 0 });
  const result = await runPromise;
  assert.equal(result.exitCode, 0);
  fs.rmSync(ctx.dir, { recursive: true, force: true });
});

test('global conversation pages emit heartbeat progress', async () => {
  const events = [];
  const response = (json) => ({ status: 200, json });
  const requestJson = async (target) => {
    if (target.includes('offset=0')) return response({ items: [{ id: 'a' }], total: 51, limit: 50, offset: 0 });
    if (target.includes('offset=50')) return response({ items: [{ id: 'b' }], total: 51, limit: 50, offset: 50 });
    throw new Error(`unexpected target ${target}`);
  };
  const items = await conversations.listStandalone({
    token: 'token-1',
    sessionHeaders: { Cookie: 'a=b' },
    requestJson,
    onProgress: (event) => events.push(event)
  });

  assert.deepEqual(items.map((item) => item.id), ['a', 'b']);
  assert.deepEqual(events.map((event) => event.count), [1, 2]);
  assert.ok(events.every((event) => event.type === 'conversation-page'));
});
