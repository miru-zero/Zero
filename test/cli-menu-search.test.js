const test = require('node:test');
const assert = require('node:assert/strict');
const cli = require('../src/cli');
const conversations = require('../src/providers/chatgpt/conversations');

const capture = () => {
  let text = '';
  return { output: { write(value) { text += value; return true; } }, text: () => text };
};

test('zero with no args enters interactive menu instead of usage error', async () => {
  const io = capture();
  let called = 0;
  const result = await cli.run([], { ZERO_JOURNAL: 'off' }, io.output, {
    interactiveMenu: async () => { called += 1; return { exitCode: 0, action: 'exit' }; }
  });
  assert.equal(called, 1);
  assert.equal(result.exitCode, 0);
});

test('searchGlobal uses the verified global search GET contract', async () => {
  assert.equal(typeof conversations.searchGlobal, 'function');
  let seen;
  const result = await conversations.searchGlobal({
    query: 'Zero', limit: 10, source: 'conversation', token: 't', sessionHeaders: {},
    requestJson: async (target, token, headers, options) => {
      seen = { target, token, headers, options };
      return { status: 200, json: { items: [], cursor: null } };
    }
  });
  assert.match(seen.target, /^\/backend-api\/global\/search\?/);
  assert.equal(result.cursor, null);
});

test('zero no-args passes provider registry into interactive menu', async () => {
  const io = capture();
  const providers = [{ name: 'plug-a', type: 'mcp-stdio' }];
  let seenProviders;
  const result = await cli.run([], { ZERO_JOURNAL: 'off' }, io.output, {
    createHub: () => ({
      listProviders: () => providers,
      close: () => {}
    }),
    interactiveMenu: async ({ providers: actual }) => {
      seenProviders = actual;
      return { exitCode: 0, action: 'exit' };
    }
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(seenProviders, providers);
});

test('zero chatgpt search routes query through searchGlobal', async () => {
  const io = capture();
  const token = 'x.' + Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url') + '.x';
  let seen;
  const result = await cli.run(['chatgpt', 'search', 'Zero'], {
    ZERO_JOURNAL: 'off',
    ZERO_CHATGPT_ACCESS_TOKEN: token,
    ZERO_CHATGPT_SESSION_FILE: 'unused.json'
  }, io.output, {
    loadSession: () => ({ status: 'READY', headers: {} }),
    searchGlobal: async (args) => {
      seen = args;
      return { items: [{ id: 'conversation:c1:message:m1', title: 'Zero room', source_type: 'conversation', payload: { conversation_id: 'c1', message_id: 'm1' } }], cursor: null };
    }
  });
  assert.equal(result.exitCode, 0);
  assert.equal(seen.query, 'Zero');
  assert.match(io.text(), /Zero room/);
  assert.match(io.text(), /conversation_id=c1/);
  assert.match(io.text(), /message_id=m1/);
});
