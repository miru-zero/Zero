const test = require('node:test');
const assert = require('node:assert/strict');
const conversations = require('../src/providers/chatgpt/conversations');
const chatgptProvider = require('../src/providers/chatgpt');
const cli = require('../src/cli');

const makeJwt = () => {
  const enc = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${enc({ alg: 'none' })}.${enc({ exp: Math.floor(Date.now() / 1000) + 600 })}.x`;
};
const capture = () => { let text = ''; return { output: { write(v) { text += v; return true; } }, text: () => text }; };

test('getConversationHistory walks every previous page and preserves raw page order', async () => {
  const calls = [];
  const current = { conversation_id: 'c1', messages: [{ id: 'now' }], page_info: { start_cursor: 'cur0', has_previous_page: true } };
  const result = await conversations.getConversationHistory({
    conversationId: 'c1', token: 't', sessionHeaders: {},
    getConversation: async () => current,
    getMessagesPage: async ({ before }) => {
      calls.push(before);
      if (before === 'cur0') return { messages: [{ id: 'old2a' }, { id: 'old2b' }], page_info: { start_cursor: 'cur1', has_previous_page: true } };
      if (before === 'cur1') return { messages: [{ id: 'old1' }], page_info: { start_cursor: 'cur2', has_previous_page: false } };
      throw new Error('unexpected cursor');
    }
  });
  assert.deepEqual(calls, ['cur0', 'cur1']);
  assert.equal(result.complete, true);
  assert.equal(result.direction, 'current_to_older');
  assert.equal(result.page_count, 3);
  assert.equal(result.message_count, 4);
  assert.deepEqual(result.pages.map((p) => p.messages.map((m) => m.id)), [['now'], ['old2a', 'old2b'], ['old1']]);
});
test('chatgpt provider exposes conversation_all', async () => {
  const original = conversations.getConversationHistory;
  let seen;
  conversations.getConversationHistory = async (args) => { seen = args; return { complete: true, pages: [] }; };
  try {
    const tool = chatgptProvider.listTools().find((item) => item.name === 'conversation_all');
    assert.ok(tool);
    assert.deepEqual(tool.inputSchema.required, ['conversation_id']);
    const result = await chatgptProvider.callTool('conversation_all', { conversation_id: 'c1', num_turns: 5, include_has_versions: false }, { token: 't', sessionHeaders: {} });
    assert.equal(seen.conversationId, 'c1');
    assert.equal(seen.numTurns, 5);
    assert.equal(seen.includeHasVersions, false);
    assert.equal(result.complete, true);
  } finally { conversations.getConversationHistory = original; }
});

test('zero chatgpt conversation get <id> all dispatches through provider and prints raw pages', async () => {
  const io = capture();
  let seen;
  const createHub = () => ({
    getProvider: (name) => name === 'chatgpt' ? { name, type: 'internal' } : null,
    callTool: async (provider, tool, args, context) => {
      seen = { provider, tool, args, context };
      return { conversation_id: 'c1', complete: true, direction: 'current_to_older', pages: [{ kind: 'current_window', messages: [{ id: 'm1' }] }] };
    },
    close: () => {}
  });  const result = await cli.run(['chatgpt', 'conversation', 'get', 'c1', 'all'], {
    ZERO_JOURNAL: 'off',
    ZERO_CHATGPT_ACCESS_TOKEN: makeJwt(),
    ZERO_CHATGPT_SESSION_FILE: 'unused.json'
  }, io.output, {
    createHub,
    loadSession: () => ({ status: 'READY', headers: { Cookie: 'a=b' } })
  });
  assert.equal(result.exitCode, 0);
  assert.equal(seen.provider, 'chatgpt');
  assert.equal(seen.tool, 'conversation_all');
  assert.equal(seen.args.conversation_id, 'c1');
  assert.match(io.text(), /"kind": "current_window"/);
  assert.match(io.text(), /"id": "m1"/);
});