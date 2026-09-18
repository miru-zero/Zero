const test = require('node:test');
const assert = require('node:assert/strict');
const conversations = require('../src/providers/chatgpt/conversations');
const chatgptProvider = require('../src/providers/chatgpt');

const ok = (json) => ({ status: 200, json });

test('getConversationMessagesPage uses verified /messages?before contract', async () => {
  let seen;
  const result = await conversations.getConversationMessagesPage({
    conversationId: 'c-1', before: 'cursor-a', numTurns: 10,
    includeHasVersions: true, token: 't', sessionHeaders: {},
    requestJson: async (target, token, headers, options) => {
      seen = { target, options };
      return ok({ messages: [{ id: 'm1' }], page_info: { has_previous_page: false } });
    }
  });
  const url = new URL(seen.target, 'https://chatgpt.com');
  assert.equal(url.pathname, '/backend-api/conversations/c-1/messages');
  assert.equal(url.searchParams.get('before'), 'cursor-a');
  assert.equal(url.searchParams.get('include_has_versions'), 'true');
  assert.equal(url.searchParams.get('num_turns'), '10');
  assert.equal(seen.options.route, '/backend-api/conversations/{conversation_id}/messages');
  assert.equal(result.messages[0].id, 'm1');
});
test('findConversationMessage returns current-window target without history fetch', async () => {
  let historyCalls = 0;
  const target = { id: 'm-target', author: { role: 'assistant' } };
  const result = await conversations.findConversationMessage({
    conversationId: 'c-1', messageId: 'm-target', token: 't', sessionHeaders: {},
    getConversation: async () => ({
      messages: [target],
      page_info: { start_cursor: 'cur0', has_previous_page: true }
    }),
    getMessagesPage: async () => { historyCalls += 1; throw new Error('should not fetch history'); }
  });
  assert.equal(result.found, true);
  assert.equal(result.source, 'current_window');
  assert.equal(result.message, target);
  assert.equal(result.pages_scanned, 1);
  assert.equal(historyCalls, 0);
});

test('findConversationMessage walks historical cursors until exact message id is found', async () => {
  const calls = [];
  const target = { id: 'm-target', author: { role: 'user' }, metadata: { raw: true } };
  const result = await conversations.findConversationMessage({
    conversationId: 'c-1', messageId: 'm-target', token: 't', sessionHeaders: {},
    getConversation: async () => ({ messages: [{ id: 'm-now' }], page_info: { start_cursor: 'cur0', has_previous_page: true } }),    getMessagesPage: async ({ before }) => {
      calls.push(before);
      if (before === 'cur0') return { messages: [{ id: 'm-old-1' }], page_info: { start_cursor: 'cur1', has_previous_page: true } };
      if (before === 'cur1') return { messages: [target], page_info: { start_cursor: 'cur2', has_previous_page: false } };
      throw new Error(`unexpected cursor ${before}`);
    }
  });
  assert.deepEqual(calls, ['cur0', 'cur1']);
  assert.equal(result.found, true);
  assert.equal(result.source, 'historical_page');
  assert.equal(result.before, 'cur1');
  assert.equal(result.message, target);
  assert.equal(result.pages_scanned, 3);
  assert.equal(result.nodes_scanned, 3);
});

test('chatgpt provider exposes history page and exact message lookup contracts', async () => {
  const tools = new Map(chatgptProvider.listTools().map((tool) => [tool.name, tool]));
  assert.deepEqual(tools.get('conversation_messages').inputSchema.required, ['conversation_id', 'before']);
  assert.deepEqual(tools.get('conversation_message_get').inputSchema.required, ['conversation_id', 'message_id']);

  const originalPage = conversations.getConversationMessagesPage;
  const originalGet = conversations.findConversationMessage;
  let pageArgs; let getArgs;
  conversations.getConversationMessagesPage = async (args) => { pageArgs = args; return { messages: [] }; };
  conversations.findConversationMessage = async (args) => { getArgs = args; return { found: true, message: { id: args.messageId } }; };  try {
    await chatgptProvider.callTool('conversation_messages', {
      conversation_id: 'c1', before: 'cur0', num_turns: 5, include_has_versions: false
    }, { token: 't', sessionHeaders: {} });
    await chatgptProvider.callTool('conversation_message_get', {
      conversation_id: 'c1', message_id: 'm9'
    }, { token: 't', sessionHeaders: {} });
    assert.equal(pageArgs.conversationId, 'c1');
    assert.equal(pageArgs.before, 'cur0');
    assert.equal(pageArgs.numTurns, 5);
    assert.equal(pageArgs.includeHasVersions, false);
    assert.equal(getArgs.conversationId, 'c1');
    assert.equal(getArgs.messageId, 'm9');
  } finally {
    conversations.getConversationMessagesPage = originalPage;
    conversations.findConversationMessage = originalGet;
  }
});