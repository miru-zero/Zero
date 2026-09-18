const test = require('node:test');
const assert = require('node:assert/strict');
const cli = require('../src/cli');

const makeJwt = () => {
  const enc = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${enc({ alg: 'none' })}.${enc({ exp: Math.floor(Date.now() / 1000) + 600 })}.x`;
};

test('conversation list progress is portable text without mojibake', async () => {
  let text = '';
  const output = { write(value) { text += value; return true; } };
  const result = await cli.run(['chatgpt', 'conversations'], {
    ZERO_JOURNAL: 'off',
    ZERO_CHATGPT_ACCESS_TOKEN: makeJwt(),
    ZERO_CHATGPT_SESSION_FILE: 'unused.json'
  }, output, {
    loadSession: () => ({ status: 'READY', headers: {} }),
    listAll: async ({ onProgress }) => {
      onProgress({ type: 'standalone-loaded', count: 5 });
      onProgress({ type: 'projects-loaded', count: 2 });
      onProgress({ type: 'done', returned: 5 });
      return { outside: [], projects: [], returned: 5, total: 5 };
    }
  });
  assert.equal(result.exitCode, 0);
  assert.doesNotMatch(text, /Ã|Â|â/);
  assert.match(text, /\[OK\] Conversation index: 5/);
  assert.match(text, /\[OK\] Projects: 2/);
  assert.match(text, /\[OK\] Loaded 5 conversations from this page/);
});