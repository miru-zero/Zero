const test = require('node:test');
const assert = require('node:assert/strict');
const sentinel = require('../src/providers/chatgpt/sentinel');
const conversations = require('../src/providers/chatgpt/conversations');

test('fetchChatRequirements posts prepare then finalize and returns final token', async () => {
  const calls = [];
  const requestJson = async (target, token, headers, options = {}) => {
    calls.push({ target, body: options.body });
    if (target === '/backend-api/sentinel/chat-requirements/prepare') {
      return { status: 200, json: { persona: 'chatgpt-paid', prepare_token: 'prep-tok' } };
    }
    if (target === '/backend-api/sentinel/chat-requirements/finalize') {
      return { status: 200, json: { persona: 'chatgpt-paid', token: 'final-tok' } };
    }
    throw new Error('unexpected ' + target);
  };
  const result = await sentinel.fetchChatRequirements({ token: 't', sessionHeaders: { 'user-agent': 'ua-test' }, requestJson });
  assert.equal(calls.length, 2);
  assert.match(calls[0].body.p, /^gAAAAAC/);
  assert.deepEqual(calls[1].body, { prepare_token: 'prep-tok' });
  assert.equal(result.token, 'final-tok');
  assert.equal(result.persona, 'chatgpt-paid');
});

test('fetchChatRequirements throws with status when prepare fails', async () => {
  const requestJson = async () => ({ status: 403, json: null });
  await assert.rejects(
    sentinel.fetchChatRequirements({ token: 't', sessionHeaders: {}, requestJson }),
    (error) => error.status === 403 && /prepare failed/.test(error.message)
  );
});

test('sendConversation direct uses fresh sentinel token when fetch succeeds', async () => {
  const calls = [];
  const requestJson = async (target, token, headers, options = {}) => {
    calls.push({ target, options });
    if (target === '/backend-api/conversations/c-old') return { status: 200, json: { conversation_id: 'c-old', current_node: 'node-old', messages: [] } };
    if (target === '/backend-api/sentinel/chat-requirements/prepare') return { status: 200, json: { prepare_token: 'prep-tok', proofofwork: { required: true, seed: '0.5', difficulty: '00' } } };
    if (target === '/backend-api/sentinel/chat-requirements/finalize') return { status: 200, json: { token: 'fresh-tok' } };
    if (target === '/backend-api/f/conversation/prepare') return { status: 200, json: {}, headers: { 'x-conduit-token': 'ct' } };
    throw new Error('unexpected ' + target);
  };
  const requestText = async (target, token, headers, options = {}) => {
    calls.push({ target, options });
    return { status: 200, text: 'data: {"conversation_id":"c-old"}\n\n' };
  };
  await conversations.sendConversation({ conversationId: 'c-old', message: 'hello', transport: 'direct', token: 't', sessionHeaders: { 'user-agent': 'ua-test' }, requestJson, requestText });
  const send = calls.find((x) => x.target === '/backend-api/f/conversation');
  assert.equal(send.options.headers['openai-sentinel-chat-requirements-token'], 'fresh-tok');
  assert.match(send.options.headers['openai-sentinel-proof-token'], /^gAAAAAB/);
});

test('sendConversation direct falls back to session sentinel when fetch fails', async () => {
  const calls = [];
  const requestJson = async (target, token, headers, options = {}) => {
    calls.push({ target, options });
    if (target === '/backend-api/conversations/c-old') return { status: 200, json: { conversation_id: 'c-old', current_node: 'node-old', messages: [] } };
    if (target === '/backend-api/sentinel/chat-requirements/prepare') return { status: 403, json: null };
    if (target === '/backend-api/f/conversation/prepare') return { status: 200, json: {}, headers: { 'x-conduit-token': 'ct' } };
    throw new Error('unexpected ' + target);
  };
  const requestText = async (target, token, headers, options = {}) => {
    calls.push({ target, options });
    return { status: 200, text: 'data: {"conversation_id":"c-old"}\n\n' };
  };
  await conversations.sendConversation({
    conversationId: 'c-old', message: 'hello', transport: 'direct', token: 't',
    sessionHeaders: { 'openai-sentinel-chat-requirements-token': 'session-tok' },
    requestJson, requestText
  });
  const send = calls.find((x) => x.target === '/backend-api/f/conversation');
  assert.equal(send.options.headers['openai-sentinel-chat-requirements-token'], 'session-tok');
});
