const test = require('node:test');
const assert = require('node:assert/strict');

test('model registry exposes zero-auto as OpenAI model data', () => {
  const registry = require('../src/llm/model-registry');
  const model = registry.get('zero-auto');
  assert.equal(model.id, 'zero-auto');
  assert.equal(model.provider, 'chatgpt-web');
  assert.equal(model.backendModel, 'auto');
  assert.equal(model.capabilities.stream, true);
  assert.equal(model.capabilities.tools, true);
  assert.equal(registry.get('missing-model'), null);
});

test('OpenAI compatibility extracts final assistant text', () => {
  const compat = require('../src/llm/openai-compat');
  const text = compat.extractAssistantText({
    messages: [
      { author: { role: 'user' }, content: { parts: ['hello'] } },
      { author: { role: 'assistant' }, content: { parts: ['hi', ' there'] } }
    ]
  });
  assert.equal(text, 'hi there');
});

test('HTTP API serves health, models and chat completions', async (t) => {
  const api = require('../src/api/server');
  const calls = [];
  const server = api.createServer({
    completeChat: async (input) => {
      calls.push(input);
      return {
        conversation_id: 'conv-test',
        current_node: 'node-test',
        messages: [{
          id: 'assistant-test',
          author: { role: 'assistant' },
          content: { parts: ['ZERO_OK'] }
        }]
      };
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  const health = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true, service: 'zero-llm' });

  const models = await fetch(`http://127.0.0.1:${port}/v1/models`);
  assert.equal(models.status, 200);
  const modelsBody = await models.json();
  assert.equal(modelsBody.object, 'list');
  assert.ok(modelsBody.data.some((item) => item.id === 'zero-auto'));

  const chat = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'zero-auto',
      messages: [{ role: 'user', content: 'say ZERO_OK' }]
    })
  });
  assert.equal(chat.status, 200);
  const body = await chat.json();
  assert.equal(body.object, 'chat.completion');
  assert.equal(body.model, 'zero-auto');
  assert.equal(body.choices[0].message.role, 'assistant');
  assert.equal(body.choices[0].message.content, 'ZERO_OK');
  assert.equal(body.choices[0].finish_reason, 'stop');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, 'zero-auto');
  assert.deepEqual(calls[0].messages, [{ role: 'user', content: 'say ZERO_OK' }]);
});

test('HTTP API streams OpenAI chat completion chunks when stream=true', async (t) => {
  const api = require('../src/api/server');
  const server = api.createServer({
    completeChat: async (input) => {
      input.onChunk(Buffer.from('data: {"o":"patch","v":[{"p":"/message/content/parts/0","o":"append","v":"Hello"}]}\n\n'));
      input.onChunk(Buffer.from('data: {"type":"message_stream_complete","conversation_id":"c1"}\n\ndata: [DONE]\n\n'));
      return { conversation_id: 'c1', current_node: 'n1', messages: [] };
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();

  const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'zero-auto',
      stream: true,
      messages: [{ role: 'user', content: 'hello' }]
    })
  });

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/event-stream/);
  const text = await response.text();
  assert.match(text, /chat\.completion\.chunk/);
  assert.match(text, /"content":"Hello"/);
  assert.match(text, /"finish_reason":"stop"/);
  assert.match(text, /"conversation_id":"c1"/);
  assert.match(text, /data: \[DONE\]/);
});

test('HTTP chat completions returns and accepts conversation_id for continuity', async (t) => {
  const api = require('../src/api/server');
  const calls = [];
  const server = api.createServer({
    completeChat: async (input) => {
      calls.push(input);
      return {
        conversation_id: input.conversationId || 'conv-created',
        current_node: 'node-continuity',
        messages: [{
          author: { role: 'assistant' },
          content: { parts: ['CONTINUITY_OK'] }
        }]
      };
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();

  const first = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'zero-auto',
      messages: [{ role: 'user', content: 'first' }]
    })
  });
  const firstBody = await first.json();
  assert.equal(firstBody.conversation_id, 'conv-created');

  const second = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'zero-auto',
      conversation_id: firstBody.conversation_id,
      messages: [{ role: 'user', content: 'second' }]
    })
  });
  const secondBody = await second.json();

  assert.equal(second.status, 200);
  assert.equal(secondBody.conversation_id, 'conv-created');
  assert.equal(secondBody.choices[0].message.content, 'CONTINUITY_OK');
  assert.equal(calls[0].conversationId, undefined);
  assert.equal(calls[1].conversationId, 'conv-created');
});

test('HTTP chat completions forwards tools and returns OpenAI tool_calls', async (t) => {
  const api = require('../src/api/server');
  const calls = [];
  const server = api.createServer({
    completeChat: async (input) => {
      calls.push(input);
      return {
        conversation_id: '66666666-6666-4666-8666-666666666666',
        current_node: 'invoke-http-1',
        messages: [{
          id: 'invoke-http-1',
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

  const tools = [{
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a file',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path']
      }
    }
  }];

  const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'zero-auto',
      messages: [{ role: 'user', content: 'read M:/Zero/a.txt' }],
      tools
    })
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(calls[0].tools, tools);
  assert.equal(body.choices[0].finish_reason, 'tool_calls');
  assert.equal(body.choices[0].message.tool_calls[0].function.name, 'read_file');
  assert.deepEqual(
    JSON.parse(body.choices[0].message.tool_calls[0].function.arguments),
    { path: 'M:/Zero/a.txt' }
  );
});

test('client disconnect does not abort an active upstream completion', async (t) => {
  const http = require('node:http');
  const api = require('../src/api/server');
  let completeCalls = 0;
  let upstreamCompleted = false;
  let finishUpstream;
  const upstreamDone = new Promise((resolve) => { finishUpstream = resolve; });

  const server = api.createServer({
    completeChat: async (input) => {
      completeCalls += 1;
      input.onChunk(Buffer.from(
        'data: {"type":"resume_conversation_token","conversation_id":"77777777-7777-4777-8777-777777777777"}\n\n' +
        'data: {"o":"patch","v":[{"p":"/message/content/parts/0","o":"append","v":"HELLO"}]}\n\n'
      ));
      await new Promise((resolve) => setTimeout(resolve, 40));
      input.onChunk(Buffer.from(
        'data: {"o":"patch","v":[{"p":"/message/content/parts/0","o":"append","v":"_WORLD"}]}\n\n' +
        'data: {"type":"message_stream_complete","conversation_id":"77777777-7777-4777-8777-777777777777"}\n\ndata: [DONE]\n\n'
      ));
      upstreamCompleted = true;
      finishUpstream();
      return {
        conversation_id: '77777777-7777-4777-8777-777777777777',
        current_node: 'node-disconnect',
        messages: [{
          author: { role: 'assistant' },
          content: { parts: ['HELLO_WORLD'] }
        }]
      };
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();

  const disconnected = new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: '/v1/chat/completions',
      method: 'POST',
      headers: { 'content-type': 'application/json' }
    }, (res) => {
      let closed = false;
      res.on('data', () => {
        if (closed) return;
        closed = true;
        res.destroy();
        req.destroy();
        resolve();
      });
      res.on('error', () => {});
    });
    req.on('error', (error) => {
      if (error.code === 'ECONNRESET') return resolve();
      reject(error);
    });
    req.end(JSON.stringify({
      model: 'zero-auto',
      stream: true,
      messages: [{ role: 'user', content: 'disconnect test' }]
    }));
  });

  await disconnected;
  await Promise.race([
    upstreamDone,
    new Promise((_, reject) => setTimeout(
      () => reject(new Error('upstream did not finish after client disconnect')),
      1000
    ))
  ]);
  assert.equal(upstreamCompleted, true);
  assert.equal(completeCalls, 1);
});

test('HTTP chat completions converts client tool shim text into OpenAI tool_calls', async (t) => {
  const api = require('../src/api/server');
  const server = api.createServer({
    completeChat: async () => ({
      conversation_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      current_node: 'shim-chat-node',
      messages: [{
        id: 'shim-chat-node',
        author: { role: 'assistant' },
        content: {
          parts: ['<ZERO_CLIENT_TOOL_CALL>{"name":"zero_probe","arguments":{"message":"PING"}}</ZERO_CLIENT_TOOL_CALL>']
        }
      }]
    })
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();

  const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'zero-auto',
      messages: [{ role: 'user', content: 'call zero_probe' }],
      tools: [{
        type: 'function',
        function: {
          name: 'zero_probe',
          parameters: { type: 'object', properties: {} }
        }
      }]
    })
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.choices[0].finish_reason, 'tool_calls');
  assert.equal(body.choices[0].message.content, null);
  assert.equal(body.choices[0].message.tool_calls[0].function.name, 'zero_probe');
  assert.deepEqual(
    JSON.parse(body.choices[0].message.tool_calls[0].function.arguments),
    { message: 'PING' }
  );
});

test('HTTP chat completions stream buffers client tool marker and emits tool_calls chunks', async (t) => {
  const api = require('../src/api/server');
  const marker = '<ZERO_CLIENT_TOOL_CALL>{"name":"zero_probe","arguments":{"message":"PING"}}</ZERO_CLIENT_TOOL_CALL>';
  const server = api.createServer({
    completeChat: async (input) => {
      input.onChunk(Buffer.from(
        'data: {"type":"resume_conversation_token","conversation_id":"cccccccc-cccc-4ccc-8ccc-cccccccccccc"}\n\n'
      ));
      input.onChunk(Buffer.from(
        'data: {"v":{"message":{"id":"shim-chat-stream","author":{"role":"assistant"},"content":{"content_type":"text","parts":[' +
        JSON.stringify(marker) +
        ']},"channel":"final"}}}\n\n'
      ));
      input.onChunk(Buffer.from(
        'data: {"type":"message_stream_complete","conversation_id":"cccccccc-cccc-4ccc-8ccc-cccccccccccc"}\n\ndata: [DONE]\n\n'
      ));
      return {
        conversation_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        current_node: 'shim-chat-stream',
        messages: [{
          id: 'shim-chat-stream',
          author: { role: 'assistant' },
          content: { parts: [marker] }
        }]
      };
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();

  const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'zero-auto',
      stream: true,
      messages: [{ role: 'user', content: 'call zero_probe' }],
      tools: [{
        type: 'function',
        function: {
          name: 'zero_probe',
          parameters: { type: 'object', properties: {} }
        }
      }]
    })
  });

  assert.equal(response.status, 200);
  const text = await response.text();
  assert.doesNotMatch(text, /ZERO_CLIENT_TOOL_CALL/);
  assert.match(text, /"tool_calls"/);
  assert.match(text, /"name":"zero_probe"/);
  assert.match(text, /"finish_reason":"tool_calls"/);
  assert.match(text, /data: \[DONE\]/);
});
