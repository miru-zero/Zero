const test = require('node:test');
const assert = require('node:assert/strict');
const conversations = require('../src/providers/chatgpt/conversations');
const chatgptProvider = require('../src/providers/chatgpt');

test('conversation_send provider schema exposes targeted reply fields for interactive CLI', () => {
  const tool = chatgptProvider.listTools().find((item) => item.name === 'conversation_send');
  const props = tool.inputSchema.properties;
  assert.equal(props.targeted_reply_text.type, 'string');
  assert.equal(props.targeted_reply_source_message_id.type, 'string');
  assert.equal(props.targeted_reply_start.type, 'integer');
  assert.equal(props.targeted_reply_end.type, 'integer');
});

test('conversation_send provider maps targeted reply fields to low-level targetedReply', async () => {
  const original = conversations.sendConversation;
  let seen;
  conversations.sendConversation = async (args) => { seen = args; return { conversation_id: 'c1' }; };
  try {
    await chatgptProvider.callTool('conversation_send', {
      conversation_id: 'c1', message: 'อันนี้หมายถึงอะไร',
      targeted_reply_text: 'QUOTE_ME_123',
      targeted_reply_source_message_id: 'm-src',
      targeted_reply_start: 0,
      targeted_reply_end: 11
    }, { token: 't', sessionHeaders: {} });
    assert.deepEqual(seen.targetedReply, {
      text: 'QUOTE_ME_123', sourceMessageId: 'm-src', sourceRange: { start: 0, end: 11 }
    });
  } finally { conversations.sendConversation = original; }
});
test('conversation_send rejects incomplete targeted reply metadata', () => {
  assert.throws(
    () => chatgptProvider.callTool('conversation_send', {
      conversation_id: 'c1', message: 'hello', targeted_reply_text: 'quote'
    }, { token: 't', sessionHeaders: {} }),
    (error) => error?.code === 'BAD_ARGS'
  );
});

test('conversation_send without targeted reply keeps targetedReply absent', async () => {
  const original = conversations.sendConversation;
  let seen;
  conversations.sendConversation = async (args) => { seen = args; return { conversation_id: 'c1' }; };
  try {
    await chatgptProvider.callTool('conversation_send', {
      conversation_id: 'c1', message: 'hello'
    }, { token: 't', sessionHeaders: {} });
    assert.equal(seen.targetedReply, null);
  } finally { conversations.sendConversation = original; }
});