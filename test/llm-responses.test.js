const test = require('node:test');
const assert = require('node:assert/strict');

test('Responses compat converts input string to a user message', () => {
  const compat = require('../src/llm/responses-compat');
  assert.deepEqual(
    compat.inputToMessages({ input: 'hello' }),
    [{ role: 'user', content: 'hello' }]
  );
});

test('Responses compat builds a completed response object', () => {
  const compat = require('../src/llm/responses-compat');
  const response = compat.makeResponse({
    model: 'zero-auto',
    conversation: {
      conversation_id: '11111111-1111-4111-8111-111111111111',
      current_node: 'node-r1',
      messages: [{
        id: 'assistant-r1',
        author: { role: 'assistant' },
        content: { parts: ['RESPONSES_OK'] }
      }]
    }
  });

  assert.equal(response.object, 'response');
  assert.equal(response.status, 'completed');
  assert.equal(response.model, 'zero-auto');
  assert.equal(compat.conversationIdFromResponseId(response.id), '11111111-1111-4111-8111-111111111111');
  assert.equal(response.output_text, 'RESPONSES_OK');
  assert.equal(response.output[0].type, 'message');
  assert.equal(response.output[0].role, 'assistant');
  assert.equal(response.output[0].content[0].type, 'output_text');
  assert.equal(response.output[0].content[0].text, 'RESPONSES_OK');
});

test('HTTP /v1/responses returns a completed response object', async (t) => {
  const api = require('../src/api/server');
  const calls = [];
  const server = api.createServer({
    completeChat: async (input) => {
      calls.push(input);
      return {
        conversation_id: '22222222-2222-4222-8222-222222222222',
        current_node: 'node-r-http',
        messages: [{
          id: 'assistant-r-http',
          author: { role: 'assistant' },
          content: { parts: ['RESPONSES_HTTP_OK'] }
        }]
      };
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();

  const response = await fetch(`http://127.0.0.1:${port}/v1/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'zero-auto',
      input: 'hello responses'
    })
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.object, 'response');
  assert.equal(body.status, 'completed');
  assert.equal(body.output_text, 'RESPONSES_HTTP_OK');
  const responsesCompat = require('../src/llm/responses-compat');
  assert.equal(responsesCompat.conversationIdFromResponseId(body.id), '22222222-2222-4222-8222-222222222222');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, 'zero-auto');
  assert.deepEqual(calls[0].messages, [{ role: 'user', content: 'hello responses' }]);
});

test('Responses previous_response_id continues the same Zero conversation', async (t) => {
  const api = require('../src/api/server');
  const responsesCompat = require('../src/llm/responses-compat');
  const conversationId = '33333333-3333-4333-8333-333333333333';
  const calls = [];
  const server = api.createServer({
    completeChat: async (input) => {
      calls.push(input);
      return {
        conversation_id: input.conversationId || conversationId,
        current_node: calls.length === 1 ? 'node-first' : 'node-second',
        messages: [{
          author: { role: 'assistant' },
          content: { parts: [calls.length === 1 ? 'FIRST_OK' : 'SECOND_OK'] }
        }]
      };
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();

  const first = await fetch(`http://127.0.0.1:${port}/v1/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'zero-auto', input: 'first' })
  });
  const firstBody = await first.json();
  assert.equal(firstBody.output_text, 'FIRST_OK');
  assert.equal(responsesCompat.conversationIdFromResponseId(firstBody.id), conversationId);

  const second = await fetch(`http://127.0.0.1:${port}/v1/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'zero-auto',
      previous_response_id: firstBody.id,
      input: 'second'
    })
  });
  const secondBody = await second.json();

  assert.equal(second.status, 200);
  assert.equal(secondBody.output_text, 'SECOND_OK');
  assert.equal(secondBody.previous_response_id, firstBody.id);
  assert.equal(calls[1].conversationId, conversationId);
});

test('Responses stream emits OpenAI Responses events and completed output', async (t) => {
  const api = require('../src/api/server');
  const server = api.createServer({
    completeChat: async (input) => {
      input.onChunk(Buffer.from(
        'data: {"type":"resume_conversation_token","conversation_id":"44444444-4444-4444-8444-444444444444"}\n\n'
      ));
      input.onChunk(Buffer.from(
        'data: {"o":"patch","v":[{"p":"/message/content/parts/0","o":"append","v":"RESP_STREAM_OK"}]}\n\n'
      ));
      input.onChunk(Buffer.from(
        'data: {"type":"message_stream_complete","conversation_id":"44444444-4444-4444-8444-444444444444"}\n\ndata: [DONE]\n\n'
      ));
      return {
        conversation_id: '44444444-4444-4444-8444-444444444444',
        current_node: 'node-stream-r',
        messages: [{
          author: { role: 'assistant' },
          content: { parts: ['RESP_STREAM_OK'] }
        }]
      };
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();

  const response = await fetch(`http://127.0.0.1:${port}/v1/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'zero-auto',
      input: 'stream please',
      stream: true
    })
  });

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/event-stream/);
  const text = await response.text();
  assert.match(text, /event: response\.created/);
  assert.match(text, /event: response\.output_text\.delta/);
  assert.match(text, /"delta":"RESP_STREAM_OK"/);
  assert.match(text, /event: response\.completed/);
  assert.match(text, /"output_text":"RESP_STREAM_OK"/);
});

test('Responses flat function tools map to local function names', () => {
  const compat = require('../src/llm/tool-compat');
  assert.deepEqual(
    compat.toolsToLocalFunctionNames([
      {
        type: 'function',
        name: 'read_file',
        description: 'Read a file',
        parameters: { type: 'object', properties: {} },
        strict: true
      }
    ]),
    ['read_file']
  );
});

test('Responses compat converts native tool invocation to function_call output item', () => {
  const compat = require('../src/llm/responses-compat');
  const response = compat.makeResponse({
    model: 'zero-auto',
    tools: [{
      type: 'function',
      name: 'read_file',
      parameters: { type: 'object', properties: {} }
    }],
    conversation: {
      conversation_id: '55555555-5555-4555-8555-555555555555',
      current_node: 'invoke-resp-1',
      messages: [{
        id: 'invoke-resp-1',
        author: { role: 'assistant' },
        recipient: 'api_tool.call_tool',
        content: {
          content_type: 'code',
          text: JSON.stringify({
            path: '/Remote Desktop Commander/link_x/read_file',
            args: { path: 'M:/Zero/a.txt' }
          })
        },
        metadata: {
          connector_tool_payload: JSON.stringify({ path: 'M:/Zero/a.txt' })
        }
      }]
    }
  });

  assert.equal(response.output_text, '');
  assert.equal(response.output.length, 1);
  assert.equal(response.output[0].type, 'function_call');
  assert.equal(response.output[0].status, 'completed');
  assert.equal(response.output[0].name, 'read_file');
  assert.deepEqual(JSON.parse(response.output[0].arguments), { path: 'M:/Zero/a.txt' });
  assert.match(response.output[0].id, /^fc_zero_/);
  assert.match(response.output[0].call_id, /^call_zero_/);
  assert.equal(response.tools[0].name, 'read_file');
});

test('Responses compat preserves function_call_output as a tool continuation message', () => {
  const compat = require('../src/llm/responses-compat');
  const messages = compat.inputToMessages({
    input: [{
      type: 'function_call_output',
      call_id: 'call_zero_invoke-resp-1',
      output: 'FILE_CONTENTS'
    }]
  });

  assert.equal(messages.length, 1);
  assert.equal(messages[0].role, 'tool');
  assert.equal(messages[0].tool_call_id, 'call_zero_invoke-resp-1');
  assert.equal(messages[0].content, 'FILE_CONTENTS');
});

test('HTTP Responses forwards flat tools and returns function_call output', async (t) => {
  const api = require('../src/api/server');
  const calls = [];
  const tools = [{
    type: 'function',
    name: 'read_file',
    description: 'Read a file',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
      additionalProperties: false
    },
    strict: true
  }];

  const server = api.createServer({
    completeChat: async (input) => {
      calls.push(input);
      return {
        conversation_id: '66666666-6666-4666-8666-666666666666',
        current_node: 'invoke-resp-http',
        messages: [{
          id: 'invoke-resp-http',
          author: { role: 'assistant' },
          recipient: 'api_tool.call_tool',
          content: {
            content_type: 'code',
            text: JSON.stringify({
              path: '/Remote Desktop Commander/link_x/read_file',
              args: { path: 'M:/Zero/a.txt' }
            })
          },
          metadata: {
            connector_tool_payload: JSON.stringify({ path: 'M:/Zero/a.txt' })
          }
        }]
      };
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();

  const response = await fetch(`http://127.0.0.1:${port}/v1/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'zero-auto',
      input: 'Read M:/Zero/a.txt',
      tools
    })
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(calls[0].tools, tools);
  assert.equal(body.output[0].type, 'function_call');
  assert.equal(body.output[0].name, 'read_file');
});

test('HTTP Responses accepts function_call_output with previous_response_id', async (t) => {
  const api = require('../src/api/server');
  const responsesCompat = require('../src/llm/responses-compat');
  const calls = [];
  const conversationId = '77777777-7777-4777-8777-777777777777';
  const previousResponseId = responsesCompat.makeResponseId({
    conversationId,
    currentNode: 'invoke-prev'
  });

  const server = api.createServer({
    completeChat: async (input) => {
      calls.push(input);
      return {
        conversation_id: conversationId,
        current_node: 'final-node',
        messages: [{
          id: 'final-node',
          author: { role: 'assistant' },
          content: { parts: ['FINAL_FROM_TOOL_RESULT'] }
        }]
      };
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();

  const response = await fetch(`http://127.0.0.1:${port}/v1/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'zero-auto',
      previous_response_id: previousResponseId,
      input: [{
        type: 'function_call_output',
        call_id: 'call_zero_invoke-prev',
        output: 'TOOL_OK'
      }],
      tools: [{
        type: 'function',
        name: 'zero_probe',
        parameters: { type: 'object', properties: {} }
      }]
    })
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.output_text, 'FINAL_FROM_TOOL_RESULT');
  assert.equal(calls[0].conversationId, conversationId);
  assert.equal(calls[0].tools[0].name, 'zero_probe');
  assert.equal(calls[0].messages.length, 1);
  assert.match(calls[0].messages[0].content, /TOOL_OK/);
});

test('Responses stream emits function call events for tool invocation', async (t) => {
  const api = require('../src/api/server');
  const server = api.createServer({
    completeChat: async (input) => {
      input.onChunk(Buffer.from(
        'data: {"type":"resume_conversation_token","conversation_id":"88888888-8888-4888-8888-888888888888"}\n\n'
      ));
      input.onChunk(Buffer.from(
        'data: {"type":"message_stream_complete","conversation_id":"88888888-8888-4888-8888-888888888888"}\n\ndata: [DONE]\n\n'
      ));
      return {
        conversation_id: '88888888-8888-4888-8888-888888888888',
        current_node: 'invoke-stream-r',
        messages: [{
          id: 'invoke-stream-r',
          author: { role: 'assistant' },
          recipient: 'api_tool.call_tool',
          content: {
            content_type: 'code',
            text: JSON.stringify({
              path: '/Remote Desktop Commander/link_x/read_file',
              args: { path: 'M:/Zero/stream.txt' }
            })
          },
          metadata: {
            connector_tool_payload: JSON.stringify({ path: 'M:/Zero/stream.txt' })
          }
        }]
      };
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();

  const response = await fetch(`http://127.0.0.1:${port}/v1/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'zero-auto',
      input: 'read stream file',
      stream: true,
      tools: [{
        type: 'function',
        name: 'read_file',
        parameters: { type: 'object', properties: {} }
      }]
    })
  });

  assert.equal(response.status, 200);
  const text = await response.text();
  assert.match(text, /event: response\.output_item\.added/);
  assert.match(text, /"type":"function_call"/);
  assert.match(text, /event: response\.function_call_arguments\.delta/);
  assert.match(text, /event: response\.function_call_arguments\.done/);
  assert.match(text, /event: response\.output_item\.done/);
  assert.match(text, /event: response\.completed/);
});

test('Responses stream uses real SSE line breaks for OpenAI SDK compatibility', async (t) => {
  const api = require('../src/api/server');
  const server = api.createServer({
    completeChat: async (input) => {
      input.onChunk(Buffer.from(
        'data: {"type":"resume_conversation_token","conversation_id":"99999999-9999-4999-8999-999999999999"}\n\n'
      ));
      input.onChunk(Buffer.from(
        'data: {"type":"message_stream_complete","conversation_id":"99999999-9999-4999-8999-999999999999"}\n\ndata: [DONE]\n\n'
      ));
      return {
        conversation_id: '99999999-9999-4999-8999-999999999999',
        current_node: 'node-sse-lines',
        messages: [{
          id: 'node-sse-lines',
          author: { role: 'assistant' },
          content: { parts: ['SSE_LINES_OK'] }
        }]
      };
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();

  const response = await fetch(`http://127.0.0.1:${port}/v1/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'zero-auto',
      input: 'stream',
      stream: true
    })
  });

  assert.equal(response.status, 200);
  const text = await response.text();
  assert.match(text, /event: response\.created\ndata: \{/);
  assert.doesNotMatch(text, /event: response\.created\\ndata:/);
});

test('Responses compat converts client tool shim text into function_call output', () => {
  const compat = require('../src/llm/responses-compat');
  const response = compat.makeResponse({
    model: 'zero-auto',
    tools: [{
      type: 'function',
      name: 'zero_probe',
      parameters: { type: 'object', properties: {} }
    }],
    conversation: {
      conversation_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      current_node: 'shim-resp-node',
      messages: [{
        id: 'shim-resp-node',
        author: { role: 'assistant' },
        content: {
          parts: ['<ZERO_CLIENT_TOOL_CALL>{"name":"zero_probe","arguments":{"message":"PING"}}</ZERO_CLIENT_TOOL_CALL>']
        }
      }]
    }
  });

  assert.equal(response.output_text, '');
  assert.equal(response.output[0].type, 'function_call');
  assert.equal(response.output[0].name, 'zero_probe');
  assert.deepEqual(JSON.parse(response.output[0].arguments), { message: 'PING' });
  assert.equal(response.output[0].call_id, 'call_zero_client_shim-resp-node');
});

test('Responses stream buffers client tool shim marker and emits only function-call events', async (t) => {
  const api = require('../src/api/server');
  const marker = '<ZERO_CLIENT_TOOL_CALL>{"name":"zero_probe","arguments":{"message":"PING"}}</ZERO_CLIENT_TOOL_CALL>';
  const server = api.createServer({
    completeChat: async (input) => {
      input.onChunk(Buffer.from(
        'data: {"type":"resume_conversation_token","conversation_id":"dddddddd-dddd-4ddd-8ddd-dddddddddddd"}\n\n'
      ));
      input.onChunk(Buffer.from(
        'data: {"v":{"message":{"id":"shim-resp-stream","author":{"role":"assistant"},"content":{"content_type":"text","parts":[' +
        JSON.stringify(marker) +
        ']},"channel":"final"}}}\n\n'
      ));
      input.onChunk(Buffer.from(
        'data: {"type":"message_stream_complete","conversation_id":"dddddddd-dddd-4ddd-8ddd-dddddddddddd"}\n\ndata: [DONE]\n\n'
      ));
      return {
        conversation_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        current_node: 'shim-resp-stream',
        messages: [{
          id: 'shim-resp-stream',
          author: { role: 'assistant' },
          content: { parts: [marker] }
        }]
      };
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();

  const response = await fetch(`http://127.0.0.1:${port}/v1/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'zero-auto',
      input: 'call zero_probe',
      stream: true,
      tools: [{
        type: 'function',
        name: 'zero_probe',
        parameters: { type: 'object', properties: {} }
      }]
    })
  });

  assert.equal(response.status, 200);
  const text = await response.text();
  assert.doesNotMatch(text, /response\.output_text\.delta[\s\S]*ZERO_CLIENT_TOOL_CALL/);
  assert.match(text, /event: response\.function_call_arguments\.done/);
  assert.match(text, /"name":"zero_probe"/);
  assert.match(text, /event: response\.completed/);
});


test('Responses compat preserves function_call_output as an internal tool message', () => {
  const compat = require('../src/llm/responses-compat');
  const messages = compat.inputToMessages({
    input: [{
      type: 'function_call_output',
      call_id: 'call_role_1',
      output: 'TOOL_RESULT_ROLE_OK'
    }]
  });

  assert.deepEqual(messages, [{
    role: 'tool',
    tool_call_id: 'call_role_1',
    content: 'TOOL_RESULT_ROLE_OK'
  }]);
});

test('Responses compat preserves prior function_call as assistant tool-call history', () => {
  const compat = require('../src/llm/responses-compat');
  const messages = compat.inputToMessages({
    input: [{
      type: 'function_call',
      call_id: 'call_role_2',
      name: 'zero_probe',
      arguments: '{"message":"PING"}'
    }]
  });

  assert.equal(messages.length, 1);
  assert.equal(messages[0].role, 'assistant');
  assert.equal(messages[0].content, '');
  assert.equal(messages[0].tool_calls[0].id, 'call_role_2');
  assert.equal(messages[0].tool_calls[0].function.name, 'zero_probe');
  assert.equal(messages[0].tool_calls[0].function.arguments, '{"message":"PING"}');
});

test('HTTP /v1/responses continues the explicit conversation_id instead of creating a new conversation', async (t) => {
  const api = require('../src/api/server');
  const calls = [];
  const conversationId = '6aafb07b-142c-83ec-a28e-1dbd99b63e27';
  const server = api.createServer({
    completeChat: async (input) => {
      calls.push(input);
      return { conversation_id: conversationId, current_node: 'node-next', messages: [] };
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();

  const response = await fetch(`http://127.0.0.1:${port}/v1/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'zero-auto', input: 'continue same room', conversation_id: conversationId })
  });

  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].conversationId, conversationId);
});
