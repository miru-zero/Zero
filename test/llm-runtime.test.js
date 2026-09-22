const test = require('node:test');
const assert = require('node:assert/strict');

test('LLM runtime maps zero-auto to ChatGPT Web provider without spawning CLI', async () => {
  const runtime = require('../src/llm/chat-runtime');
  const calls = [];

  const result = await runtime.complete({
    model: 'zero-auto',
    messages: [
      { role: 'system', content: 'be concise' },
      { role: 'user', content: 'hello' }
    ],
    context: {
      token: 'token-fixture',
      sessionHeaders: { Cookie: 'session=fixture' }
    },
    createConversation: async (input) => {
      calls.push(input);
      return { conversation_id: 'c1', current_node: 'n1', messages: [] };
    }
  });

  assert.equal(result.conversation_id, 'c1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, 'auto');
  assert.equal(calls[0].token, 'token-fixture');
  assert.deepEqual(calls[0].sessionHeaders, { Cookie: 'session=fixture' });
  assert.equal(calls[0].message, 'hello');
  assert.ok(calls[0].hiddenSystemMessages.some((text) => text.includes('be concise')));
  assert.doesNotMatch(calls[0].message, /SYSTEM:|USER:/);
});

test('LLM runtime rejects unknown models', async () => {
  const runtime = require('../src/llm/chat-runtime');
  await assert.rejects(
    runtime.complete({
      model: 'missing-model',
      messages: [{ role: 'user', content: 'hello' }],
      context: {}
    }),
    (error) => {
      assert.equal(error.code, 'MODEL_NOT_FOUND');
      return true;
    }
  );
});

test('LLM runtime forwards onChunk to ChatGPT Web conversation transport', async () => {
  const runtime = require('../src/llm/chat-runtime');
  const chunks = [];
  let seenOnChunk = null;
  let seenRecoverStream = null;
  const onChunk = (chunk) => chunks.push(chunk.toString('utf8'));

  await runtime.complete({
    model: 'zero-auto',
    messages: [{ role: 'user', content: 'hello' }],
    context: { token: 't', sessionHeaders: {} },
    onChunk,
    createConversation: async (input) => {
      seenOnChunk = input.onChunk;
      seenRecoverStream = input.recoverStream;
      input.onChunk(Buffer.from('data: x\n\n'));
      return { conversation_id: 'c2', current_node: 'n2', messages: [] };
    }
  });

  assert.equal(seenOnChunk, onChunk);
  assert.equal(seenRecoverStream, true);
  assert.deepEqual(chunks, ['data: x\n\n']);
});

test('LLM runtime continues an existing conversation instead of creating a new one', async () => {
  const runtime = require('../src/llm/chat-runtime');
  const createCalls = [];
  const sendCalls = [];

  const result = await runtime.complete({
    model: 'zero-auto',
    conversationId: 'conv-existing',
    messages: [
      { role: 'system', content: 'original system' },
      { role: 'user', content: 'old turn' },
      { role: 'assistant', content: 'old answer' },
      { role: 'user', content: 'new turn only' }
    ],
    context: { token: 'token-fixture', sessionHeaders: { Cookie: 's=1' } },
    createConversation: async (input) => {
      createCalls.push(input);
      throw new Error('create should not be called');
    },
    sendConversation: async (input) => {
      sendCalls.push(input);
      return { conversation_id: 'conv-existing', current_node: 'node-next', messages: [] };
    }
  });

  assert.equal(result.conversation_id, 'conv-existing');
  assert.equal(createCalls.length, 0);
  assert.equal(sendCalls.length, 1);
  assert.equal(sendCalls[0].conversationId, 'conv-existing');
  assert.equal(sendCalls[0].message, 'new turn only');
  assert.equal(sendCalls[0].model, 'auto');
  assert.equal(sendCalls[0].token, 'token-fixture');
  assert.deepEqual(sendCalls[0].sessionHeaders, { Cookie: 's=1' });
});

test('LLM runtime requires a user turn when continuing an existing conversation', async () => {
  const runtime = require('../src/llm/chat-runtime');
  await assert.rejects(
    runtime.complete({
      model: 'zero-auto',
      conversationId: 'conv-existing',
      messages: [{ role: 'assistant', content: 'nothing new' }],
      context: {}
    }),
    (error) => {
      assert.equal(error.code, 'BAD_REQUEST');
      return true;
    }
  );
});

test('LLM runtime exposes nested OpenAI function tools through the client tool shim on new conversations', async () => {
  const runtime = require('../src/llm/chat-runtime');
  let seen = null;
  await runtime.complete({
    model: 'zero-auto',
    messages: [{ role: 'user', content: 'read a file' }],
    tools: [{
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Read a file',
        parameters: { type: 'object', properties: {} }
      }
    }],
    context: { token: 't', sessionHeaders: {} },
    createConversation: async (input) => {
      seen = input;
      return { conversation_id: 'c-tools', current_node: 'n-tools', messages: [] };
    }
  });
  assert.equal(seen.localFunctionNames, undefined);
  assert.equal(seen.message, 'read a file');
  assert.ok(seen.hiddenSystemMessages.some((text) => text.includes('ZERO_CLIENT_TOOLS_V1') && text.includes('read_file')));
});

test('LLM runtime exposes nested OpenAI function tools through the client tool shim on continuation', async () => {
  const runtime = require('../src/llm/chat-runtime');
  let seen = null;
  await runtime.complete({
    model: 'zero-auto',
    conversationId: 'c-tools',
    messages: [{ role: 'user', content: 'continue' }],
    tools: [{
      type: 'function',
      function: { name: 'ping', parameters: { type: 'object' } }
    }],
    context: { token: 't', sessionHeaders: {} },
    sendConversation: async (input) => {
      seen = input;
      return { conversation_id: 'c-tools', current_node: 'n-next', messages: [] };
    }
  });
  assert.equal(seen.localFunctionNames, undefined);
  assert.equal(seen.message, 'continue');
  assert.ok(seen.hiddenSystemMessages.some((text) => text.includes('ZERO_CLIENT_TOOLS_V1') && text.includes('ping')));
});

test('LLM runtime exposes arbitrary client tool schemas through the prompt shim instead of local_function_names', async () => {
  const runtime = require('../src/llm/chat-runtime');
  let seen = null;
  await runtime.complete({
    model: 'zero-auto',
    messages: [{ role: 'user', content: 'call zero_probe' }],
    tools: [{
      type: 'function',
      name: 'zero_probe',
      description: 'Probe',
      parameters: {
        type: 'object',
        properties: { message: { type: 'string' } },
        required: ['message']
      }
    }],
    context: { token: 't', sessionHeaders: {} },
    createConversation: async (input) => {
      seen = input;
      return { conversation_id: 'c-shim', current_node: 'n-shim', messages: [] };
    }
  });

  assert.equal(seen.localFunctionNames, undefined);
  assert.equal(seen.message, 'call zero_probe');
  assert.ok(seen.hiddenSystemMessages.some((text) => text.includes('ZERO_CLIENT_TOOLS_V1') && text.includes('zero_probe')));
  assert.doesNotMatch(seen.message, /ZERO_CLIENT_TOOLS_V1|USER:/);
});

test('LLM runtime lets a tool result continue an existing conversation through the client tool shim', async () => {
  const runtime = require('../src/llm/chat-runtime');
  let seen = null;
  await runtime.complete({
    model: 'zero-auto',
    conversationId: 'c-shim',
    messages: [{
      role: 'tool',
      tool_call_id: 'call_zero_client_node-shim',
      content: '{"ok":true,"result":"ZERO_PROBE_OK"}'
    }],
    tools: [{
      type: 'function',
      name: 'zero_probe',
      parameters: { type: 'object', properties: {} }
    }],
    context: { token: 't', sessionHeaders: {} },
    sendConversation: async (input) => {
      seen = input;
      return { conversation_id: 'c-shim', current_node: 'n-final', messages: [] };
    }
  });

  assert.equal(seen.localFunctionNames, undefined);
  assert.equal(seen.hideUserMessage, true);
  assert.doesNotMatch(seen.message, /ZERO_CLIENT_TOOLS_V1|call_zero_client_node-shim|ZERO_PROBE_OK/);
  assert.ok(seen.hiddenSystemMessages.some((text) => text.includes('call_zero_client_node-shim') && text.includes('ZERO_PROBE_OK')));
  assert.ok(seen.hiddenSystemMessages.some((text) => text.includes('ZERO_CLIENT_TOOLS_V1') && text.includes('zero_probe')));
});


test('LLM runtime keeps system context and client tools out of the visible user message', async () => {
  const runtime = require('../src/llm/chat-runtime');
  let seen = null;

  await runtime.complete({
    model: 'zero-auto',
    messages: [
      { role: 'system', content: 'SYSTEM_ONLY_MARKER' },
      { role: 'user', content: 'USER_ONLY_MARKER' }
    ],
    tools: [{
      type: 'function',
      name: 'zero_probe',
      description: 'Probe',
      parameters: { type: 'object', properties: {} }
    }],
    context: { token: 't', sessionHeaders: {} },
    createConversation: async (input) => {
      seen = input;
      return { conversation_id: 'c-role', current_node: 'n-role', messages: [] };
    }
  });

  assert.equal(seen.message, 'USER_ONLY_MARKER');
  assert.doesNotMatch(seen.message, /SYSTEM_ONLY_MARKER|ZERO_CLIENT_TOOLS_V1|zero_probe/);
  assert.ok(Array.isArray(seen.hiddenSystemMessages));
  assert.ok(seen.hiddenSystemMessages.some((text) => text.includes('SYSTEM_ONLY_MARKER')));
  assert.ok(seen.hiddenSystemMessages.some((text) => text.includes('ZERO_CLIENT_TOOLS_V1') && text.includes('zero_probe')));
});

test('LLM runtime keeps tool result out of visible user content on continuation', async () => {
  const runtime = require('../src/llm/chat-runtime');
  let seen = null;

  await runtime.complete({
    model: 'zero-auto',
    conversationId: 'c-role',
    messages: [{
      role: 'tool',
      tool_call_id: 'call_123',
      content: '{"ok":true,"value":"TOOL_ONLY_MARKER"}'
    }],
    tools: [{
      type: 'function',
      name: 'zero_probe',
      parameters: { type: 'object', properties: {} }
    }],
    context: { token: 't', sessionHeaders: {} },
    sendConversation: async (input) => {
      seen = input;
      return { conversation_id: 'c-role', current_node: 'n-role-2', messages: [] };
    }
  });

  assert.equal(seen.hideUserMessage, true);
  assert.doesNotMatch(seen.message, /TOOL_ONLY_MARKER|ZERO_CLIENT_TOOLS_V1/);
  assert.ok(seen.hiddenSystemMessages.some((text) => text.includes('TOOL_ONLY_MARKER')));
  assert.ok(seen.hiddenSystemMessages.some((text) => text.includes('ZERO_CLIENT_TOOLS_V1')));
});

test('LLM runtime reclassifies synthetic <system> user messages as hidden system context', async () => {
  const runtime = require('../src/llm/chat-runtime');
  let seen = null;

  await runtime.complete({
    model: 'zero-auto',
    messages: [
      { role: 'user', content: '<system>EXECUTION_POLICY_MARKER</system>' },
      { role: 'user', content: '<system>Editor context: TEST_AI.js:1.</system>' },
      { role: 'user', content: 'REAL_USER_MARKER' }
    ],
    context: { token: 't', sessionHeaders: {} },
    createConversation: async (input) => {
      seen = input;
      return { conversation_id: 'c-synthetic-system', current_node: 'n-synthetic-system', messages: [] };
    }
  });

  assert.equal(seen.message, 'REAL_USER_MARKER');
  assert.ok(seen.hiddenSystemMessages.some((text) => text.includes('EXECUTION_POLICY_MARKER')));
  assert.ok(seen.hiddenSystemMessages.some((text) => text.includes('Editor context: TEST_AI.js:1.')));
  assert.doesNotMatch(seen.message, /<system>|EXECUTION_POLICY_MARKER|Editor context/);
});
