const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cli = require('../src/cli');

const jwt = () => {
  const enc = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
  return enc({ alg: 'none' }) + '.' + enc({ exp: Math.floor(Date.now() / 1000) + 120 }) + '.x';
};

test('chatgpt sugar routes through ChatGPT provider hub instead of direct conversations module', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-cli-chatgpt-route-'));
  const sessionFile = path.join(dir, 'session.json');
  fs.writeFileSync(sessionFile, JSON.stringify({ headers: { Cookie: 'a=b' } }));
  const env = { ZERO_CHATGPT_ACCESS_TOKEN: jwt(), ZERO_CHATGPT_SESSION_FILE: sessionFile };
  const output = { text: '', write(value) { this.text += value; } };
  let seen = null;
  const fakeHub = {
    getProvider: () => ({ name: 'chatgpt', type: 'internal' }),
    callTool: async (provider, tool, args, context) => {
      seen = { provider, tool, args, context };
      return { conversation_id: 'c1', title: 'Hub', current_node: 'n1', messages: [] };
    },
    close() {}
  };
  try {
    const result = await cli.run(['chatgpt', 'conversation', 'get', 'c1'], env, output, {
      createHub: () => fakeHub
    });
    assert.equal(result.exitCode, 0);
    assert.equal(seen.provider, 'chatgpt');
    assert.equal(seen.tool, 'conversation_get');
    assert.deepEqual(seen.args, { conversation_id: 'c1' });
    assert.ok(seen.context.token);
    assert.deepEqual(seen.context.sessionHeaders, { Cookie: 'a=b' });
    assert.match(output.text, /title=Hub/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
