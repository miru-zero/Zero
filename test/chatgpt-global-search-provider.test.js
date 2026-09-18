const test = require('node:test');
const assert = require('node:assert/strict');
const conversations = require('../src/providers/chatgpt/conversations');
const chatgptProvider = require('../src/providers/chatgpt');
const cli = require('../src/cli');

const makeJwt = () => {
  const enc = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${enc({ alg: 'none' })}.${enc({ exp: Math.floor(Date.now() / 1000) + 600 })}.x`;
};
const capture = () => {
  let text = '';
  return { output: { write(value) { text += value; return true; } }, text: () => text };
};

test('chatgpt provider exposes global_search and forwards search args', async () => {
  const original = conversations.searchGlobal;
  let seen;
  conversations.searchGlobal = async (args) => { seen = args; return { items: [], cursor: 'next' }; };
  try {
    const tool = chatgptProvider.listTools().find((item) => item.name === 'global_search');
    assert.ok(tool);
    assert.deepEqual(tool.inputSchema.required, ['query']);
    const result = await chatgptProvider.callTool('global_search', { query: 'Zero', cursor: 'c0', limit: 7, source: 'conversation' }, { token: 't', sessionHeaders: {} });
    assert.equal(seen.query, 'Zero');
    assert.equal(seen.cursor, 'c0');
    assert.equal(seen.limit, 7);
    assert.equal(seen.source, 'conversation');
    assert.equal(result.cursor, 'next');
  } finally { conversations.searchGlobal = original; }
});
test('zero chatgpt search default path dispatches through provider hub', async () => {
  const io = capture();
  let seen;
  const createHub = () => ({
    getProvider: (name) => name === 'chatgpt' ? { name, type: 'internal' } : null,
    callTool: async (provider, tool, args, context) => {
      seen = { provider, tool, args, context };
      return { items: [], cursor: null };
    },
    close: () => {}
  });
  const result = await cli.run(['chatgpt', 'search', 'Zero'], {
    ZERO_JOURNAL: 'off',
    ZERO_CHATGPT_ACCESS_TOKEN: makeJwt(),
    ZERO_CHATGPT_SESSION_FILE: 'unused.json'
  }, io.output, {
    createHub,
    loadSession: () => ({ status: 'READY', headers: { Cookie: 'a=b' } })
  });
  assert.equal(result.exitCode, 0);
  assert.equal(seen.provider, 'chatgpt');
  assert.equal(seen.tool, 'global_search');
  assert.equal(seen.args.query, 'Zero');
  assert.equal(seen.args.source, 'conversation');
  assert.equal(seen.context.sessionHeaders.Cookie, 'a=b');
});