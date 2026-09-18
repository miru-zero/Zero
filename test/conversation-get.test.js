const test = require('node:test');
const assert = require('node:assert/strict');

const conversations = require('../src/providers/chatgpt/conversations');

const response = (json) => ({ status: 200, json });

test('getConversation fetches detail with dynamic conversation route', async () => {
  let seen = null;
  const requestJson = async (target, token, headers, options = {}) => {
    seen = { target, token, headers, options };
    return response({
      conversation_id: 'conv-1',
      title: 'Conversation One',
      current_node: 'node-1',
      gizmo_id: 'g-p-1',
      messages: [{ id: 'msg-1' }]
    });
  };

  const result = await conversations.getConversation({
    conversationId: 'conv-1',
    token: 'token-1',
    sessionHeaders: { Cookie: 'a=b' },
    requestJson
  });

  assert.equal(seen.target, '/backend-api/conversations/conv-1');
  assert.equal(seen.options.route, '/backend-api/conversations/{conversation_id}');
  assert.equal(result.conversation_id, 'conv-1');
  assert.equal(result.current_node, 'node-1');
  assert.equal(result.gizmo_id, 'g-p-1');
  assert.equal(result.messages.length, 1);
});
