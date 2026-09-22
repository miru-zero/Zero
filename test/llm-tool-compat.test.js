const test = require('node:test');
const assert = require('node:assert/strict');

test('native api_tool.call_tool assistant message normalizes to OpenAI function call', () => {
  const compat = require('../src/llm/tool-compat');
  const message = {
    id: 'invoke-1',
    author: { role: 'assistant' },
    recipient: 'api_tool.call_tool',
    content: {
      content_type: 'code',
      language: 'python3',
      text: JSON.stringify({
        path: '/Remote Desktop Commander/link_x/read_file',
        args: { path: 'M:/Zero/test.txt', length: 20 }
      })
    },
    metadata: {
      connector_tool_payload: JSON.stringify({
        path: 'M:/Zero/test.txt',
        length: 20
      })
    }
  };

  const call = compat.nativeInvocationToFunctionCall(message);
  assert.equal(call.id, 'call_zero_invoke-1');
  assert.equal(call.type, 'function');
  assert.equal(call.function.name, 'read_file');
  assert.deepEqual(JSON.parse(call.function.arguments), {
    path: 'M:/Zero/test.txt',
    length: 20
  });
});

test('OpenAI function tools map to ChatGPT local function names', () => {
  const compat = require('../src/llm/tool-compat');
  const names = compat.toolsToLocalFunctionNames([
    {
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Read a file',
        parameters: { type: 'object', properties: {} }
      }
    },
    {
      type: 'function',
      function: { name: 'ping', parameters: { type: 'object' } }
    }
  ]);
  assert.deepEqual(names, ['read_file', 'ping']);
});

test('conversation native tool invocation becomes OpenAI tool_calls completion', () => {
  const compat = require('../src/llm/openai-compat');
  const conversation = {
    conversation_id: '55555555-5555-4555-8555-555555555555',
    current_node: 'invoke-1',
    messages: [{
      id: 'invoke-1',
      author: { role: 'assistant' },
      recipient: 'api_tool.call_tool',
      content: {
        content_type: 'code',
        text: JSON.stringify({
          path: '/Remote Desktop Commander/link_x/read_file',
          args: { path: 'M:/Zero/test.txt' }
        })
      },
      metadata: {
        connector_tool_payload: JSON.stringify({ path: 'M:/Zero/test.txt' })
      }
    }]
  };

  const result = compat.makeChatCompletion({ model: 'zero-auto', conversation });
  assert.equal(result.choices[0].finish_reason, 'tool_calls');
  assert.equal(result.choices[0].message.role, 'assistant');
  assert.equal(result.choices[0].message.content, null);
  assert.equal(result.choices[0].message.tool_calls.length, 1);
  assert.equal(result.choices[0].message.tool_calls[0].function.name, 'read_file');
  assert.deepEqual(
    JSON.parse(result.choices[0].message.tool_calls[0].function.arguments),
    { path: 'M:/Zero/test.txt' }
  );
});

test('client tools compile to a model-visible shim contract and parse back to OpenAI calls', () => {
  const compat = require('../src/llm/tool-compat');
  const tools = [{
    type: 'function',
    name: 'zero_probe',
    description: 'Probe',
    parameters: {
      type: 'object',
      properties: { message: { type: 'string' } },
      required: ['message']
    }
  }];

  const instructions = compat.clientToolInstructions(tools);
  assert.match(instructions, /ZERO_CLIENT_TOOLS_V1/);
  assert.match(instructions, /ZERO_CLIENT_TOOL_CALL/);
  assert.match(instructions, /zero_probe/);
  assert.match(instructions, /"message"/);

  const call = compat.clientToolCallFromText(
    '<ZERO_CLIENT_TOOL_CALL>{"name":"zero_probe","arguments":{"message":"PING"}}</ZERO_CLIENT_TOOL_CALL>',
    { tools, id: 'node-shim-1' }
  );

  assert.equal(call.id, 'call_zero_client_node-shim-1');
  assert.equal(call.type, 'function');
  assert.equal(call.function.name, 'zero_probe');
  assert.deepEqual(JSON.parse(call.function.arguments), { message: 'PING' });
});

test('client tool shim rejects calls to names not present in the request tool list', () => {
  const compat = require('../src/llm/tool-compat');
  const call = compat.clientToolCallFromText(
    '<ZERO_CLIENT_TOOL_CALL>{"name":"not_allowed","arguments":{}}</ZERO_CLIENT_TOOL_CALL>',
    {
      tools: [{
        type: 'function',
        name: 'zero_probe',
        parameters: { type: 'object', properties: {} }
      }],
      id: 'node-shim-2'
    }
  );
  assert.equal(call, null);
});
