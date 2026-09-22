const test = require('node:test');
const assert = require('node:assert/strict');

test('runtime API loads Zero auth/session into LLM context', () => {
  const runtimeApi = require('../src/api/runtime');
  const context = runtimeApi.loadContext({
    env: {},
    authFile: 'auth.json',
    sessionFile: 'session.json',
    loadAccessToken: () => ({ token: 'token-fixture', source: 'file' }),
    inspectAccessToken: () => ({ status: 'VALID' }),
    readSession: () => ({
      status: 'READY',
      headers: { Cookie: 'session=fixture' }
    })
  });

  assert.equal(context.token, 'token-fixture');
  assert.deepEqual(context.sessionHeaders, { Cookie: 'session=fixture' });
});

test('runtime API rejects invalid auth before provider call', () => {
  const runtimeApi = require('../src/api/runtime');
  assert.throws(() => runtimeApi.loadContext({
    env: {},
    authFile: 'auth.json',
    sessionFile: 'session.json',
    loadAccessToken: () => ({ token: null, source: 'none' }),
    inspectAccessToken: () => ({ status: 'MISSING' }),
    readSession: () => ({ status: 'READY', headers: {} })
  }), (error) => {
    assert.equal(error.code, 'AUTH_NOT_READY');
    return true;
  });
});

test('runtime API injects loaded context into chat runtime', async () => {
  const runtimeApi = require('../src/api/runtime');
  let seen = null;
  const completeChat = runtimeApi.createCompleteChat({
    loadContext: () => ({
      token: 'token-fixture',
      sessionHeaders: { Cookie: 'session=fixture' }
    }),
    complete: async (input) => {
      seen = input;
      return { conversation_id: 'c-live', current_node: 'n-live', messages: [] };
    }
  });
  const result = await completeChat({
    model: 'zero-auto',
    messages: [{ role: 'user', content: 'hello' }]
  });

  assert.equal(result.conversation_id, 'c-live');
  assert.equal(seen.model, 'zero-auto');
  assert.equal(seen.context.token, 'token-fixture');
  assert.deepEqual(seen.context.sessionHeaders, { Cookie: 'session=fixture' });
});

test('runtime API forwards onChunk into chat runtime', async () => {
  const runtimeApi = require('../src/api/runtime');
  const onChunk = () => {};
  let seen = null;
  const completeChat = runtimeApi.createCompleteChat({
    loadContext: () => ({ token: 't', sessionHeaders: {} }),
    complete: async (input) => {
      seen = input;
      return { conversation_id: 'c-stream', current_node: 'n-stream', messages: [] };
    }
  });

  await completeChat({
    model: 'zero-auto',
    messages: [{ role: 'user', content: 'hello' }],
    onChunk
  });

  assert.equal(seen.onChunk, onChunk);
});

test('runtime API forwards conversationId into chat runtime', async () => {
  const runtimeApi = require('../src/api/runtime');
  let seen = null;
  const completeChat = runtimeApi.createCompleteChat({
    loadContext: () => ({ token: 't', sessionHeaders: {} }),
    complete: async (input) => {
      seen = input;
      return { conversation_id: 'conv-existing', current_node: 'n2', messages: [] };
    }
  });

  await completeChat({
    model: 'zero-auto',
    conversationId: 'conv-existing',
    messages: [{ role: 'user', content: 'next' }]
  });

  assert.equal(seen.conversationId, 'conv-existing');
});

test('runtime API forwards tools into chat runtime', async () => {
  const runtimeApi = require('../src/api/runtime');
  let seen = null;
  const tools = [{
    type: 'function',
    function: {
      name: 'zero_probe',
      parameters: {
        type: 'object',
        properties: { message: { type: 'string' } }
      }
    }
  }];

  const completeChat = runtimeApi.createCompleteChat({
    loadContext: () => ({ token: 't', sessionHeaders: {} }),
    complete: async (input) => {
      seen = input;
      return { conversation_id: 'c-tools', current_node: 'n-tools', messages: [] };
    }
  });

  await completeChat({
    model: 'zero-auto',
    messages: [{ role: 'user', content: 'call zero_probe' }],
    tools
  });

  assert.deepEqual(seen.tools, tools);
});
