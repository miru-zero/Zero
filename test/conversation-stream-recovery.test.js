const test = require('node:test');
const assert = require('node:assert/strict');

const conversations = require('../src/providers/chatgpt/conversations');
const chatgptProvider = require('../src/providers/chatgpt');

test('getConversationStreamStatus uses the verified stream_status route', async () => {
  let seen;
  const requestJson = async (target, token, headers, options = {}) => {
    seen = { target, token, headers, options };
    return { status: 200, json: { status: 'COMPLETE' } };
  };

  const result = await conversations.getConversationStreamStatus({
    conversationId: 'conv-1',
    token: 'token-1',
    sessionHeaders: { Cookie: 'a=b' },
    requestJson
  });

  assert.equal(seen.target, '/backend-api/conversation/conv-1/stream_status');
  assert.equal(seen.options.route, '/backend-api/conversation/{conversation_id}/stream_status');
  assert.deepEqual(result, { status: 'COMPLETE' });
});

test('resumeConversation sends offset and the current turn headers to the resume endpoint', async () => {
  let seen;
  const requestText = async (target, token, headers, options = {}) => {
    seen = { target, token, headers, options };
    return {
      status: 200,
      contentType: 'text/event-stream',
      text: 'data: {"type":"resume_conversation_token","conversation_id":"conv-1","token":"resume-1"}\n\ndata: [DONE]\n\n'
    };
  };

  const result = await conversations.resumeConversation({
    conversationId: 'conv-1',
    offset: 0,
    conduitToken: 'turn-token-fixture',
    turnTraceId: 'trace-fixture',
    token: 'token-1',
    sessionHeaders: { Cookie: 'a=b' },
    requestText
  });

  assert.equal(seen.target, '/backend-api/f/conversation/resume');
  assert.equal(seen.options.method, 'POST');
  assert.equal(seen.options.route, '/backend-api/f/conversation/resume');
  assert.deepEqual(seen.options.body, { conversation_id: 'conv-1', offset: 0 });
  assert.equal(seen.options.headers.accept, 'text/event-stream');
  assert.equal(seen.options.headers['x-conduit-token'], 'turn-token-fixture');
  assert.equal(seen.options.headers['x-oai-turn-trace-id'], 'trace-fixture');
  assert.equal(seen.options.headers.origin, 'https://chatgpt.com');
  assert.equal(seen.options.headers['x-openai-web-frontend'], 'core_web');
  assert.equal(seen.options.retry, false);
  assert.equal(result.conversation_id, 'conv-1');
  assert.equal(result.status, 200);
  assert.equal(result.content_type, 'text/event-stream');
  assert.match(result.text, /resume_conversation_token/);
});

test('provider exposes conversation_stream_status and conversation_resume', async () => {
  const tools = chatgptProvider.listTools();
  const statusTool = tools.find((item) => item.name === 'conversation_stream_status');
  const resumeTool = tools.find((item) => item.name === 'conversation_resume');

  assert.ok(statusTool);
  assert.ok(resumeTool);
  assert.deepEqual(statusTool.inputSchema.required, ['conversation_id']);
  assert.deepEqual(resumeTool.inputSchema.required, ['conversation_id']);

  const originalStatus = conversations.getConversationStreamStatus;
  const originalResume = conversations.resumeConversation;
  let statusSeen;
  let resumeSeen;
  conversations.getConversationStreamStatus = async (args) => { statusSeen = args; return { status: 'COMPLETE' }; };
  conversations.resumeConversation = async (args) => { resumeSeen = args; return { status: 200 }; };
  try {
    await chatgptProvider.callTool('conversation_stream_status', { conversation_id: 'conv-1' }, { token: 't', sessionHeaders: {} });
    await chatgptProvider.callTool('conversation_resume', { conversation_id: 'conv-1' }, { token: 't', sessionHeaders: {} });
    assert.equal(statusSeen.conversationId, 'conv-1');
    assert.equal(resumeSeen.conversationId, 'conv-1');
  } finally {
    conversations.getConversationStreamStatus = originalStatus;
    conversations.resumeConversation = originalResume;
  }
});

test('createConversation resumes the same turn once after its upstream stream breaks', async () => {
  const calls = [];
  const requestJson = async (target) => {
    if (target === '/backend-api/f/conversation/prepare') {
      return { status: 200, json: { conduit_token: 'prepare-token-fixture' }, headers: {} };
    }
    if (target === '/backend-api/conversations/conv-recover') {
      return { status: 200, json: { conversation_id: 'conv-recover', current_node: 'assistant-final', messages: [] } };
    }
    if (target === '/backend-api/conversation/init') return { status: 200, json: {} };
    throw new Error(`unexpected JSON request: ${target}`);
  };
  const requestText = async (target, _token, _headers, options) => {
    calls.push({ target, options });
    if (target === '/backend-api/f/conversation') {
      options.onChunk(Buffer.from(
        'data: {"type":"resume_conversation_token","conversation_id":"conv-recover","token":"stream-token-fixture"}\n\n'
      ));
      throw new Error('upstream socket closed');
    }
    if (target === '/backend-api/f/conversation/resume') {
      return { status: 200, contentType: 'text/event-stream', text: 'data: {"type":"message_stream_complete","conversation_id":"conv-recover"}\n\ndata: [DONE]\n\n' };
    }
    throw new Error(`unexpected text request: ${target}`);
  };

  const result = await conversations.createConversation({
    message: 'hello',
    recoverStream: true,
    systemHints: [],
    systemHintMentions: [],
    token: 'token-fixture',
    sessionHeaders: { Cookie: 'session=fixture' },
    requestJson,
    requestText
  });

  assert.equal(result.conversation_id, 'conv-recover');
  assert.deepEqual(calls.map((call) => call.target), [
    '/backend-api/f/conversation',
    '/backend-api/f/conversation/resume'
  ]);
  assert.equal(calls[1].options.body.conversation_id, 'conv-recover');
  assert.equal(calls[1].options.body.offset, 0);
  assert.equal(calls[0].options.idleTimeoutMs, 60_000);
  assert.equal(calls[1].options.idleTimeoutMs, 60_000);
  assert.equal(calls[1].options.headers['x-conduit-token'], 'stream-token-fixture');
  assert.equal(calls[1].options.headers['x-oai-turn-trace-id'], calls[0].options.headers['x-oai-turn-trace-id']);
});

test('sendConversation resumes an existing turn without sending the user message again', async () => {
  const calls = [];
  let getCount = 0;
  const requestJson = async (target) => {
    if (target === '/backend-api/conversations/conv-existing') {
      getCount += 1;
      return { status: 200, json: { conversation_id: 'conv-existing', current_node: getCount === 1 ? 'parent-node' : 'assistant-final', messages: [] } };
    }
    if (target === '/backend-api/f/conversation/prepare') {
      return { status: 200, json: { conduit_token: 'prepared-token-fixture' }, headers: {} };
    }
    throw new Error(`unexpected JSON request: ${target}`);
  };
  const requestText = async (target, _token, _headers, options) => {
    calls.push({ target, options });
    if (target === '/backend-api/f/conversation') {
      options.onChunk(Buffer.from('data: {"type":"resume_conversation_token","conversation_id":"conv-existing","token":"active-token-fixture"}\n\n'));
      throw new Error('upstream stream aborted');
    }
    if (target === '/backend-api/f/conversation/resume') {
      return { status: 200, text: 'data: [DONE]\n\n' };
    }
    throw new Error(`unexpected text request: ${target}`);
  };

  const result = await conversations.sendConversation({
    conversationId: 'conv-existing',
    message: 'next turn',
    recoverStream: true,
    systemHints: [],
    systemHintMentions: [],
    token: 'token-fixture',
    sessionHeaders: { Cookie: 'session=fixture' },
    requestJson,
    requestText
  });

  assert.equal(result.current_node, 'assistant-final');
  assert.deepEqual(calls.map((call) => call.target), [
    '/backend-api/f/conversation',
    '/backend-api/f/conversation/resume'
  ]);
  assert.equal(calls[1].options.headers['x-conduit-token'], 'active-token-fixture');
  assert.equal(calls[1].options.headers['x-oai-turn-trace-id'], calls[0].options.headers['x-oai-turn-trace-id']);
  assert.deepEqual(calls[1].options.body, { conversation_id: 'conv-existing', offset: 0 });
});

test('sendConversation forwards resumed stream chunks after upstream abort', async () => {
  const downstream = [];
  let getCount = 0;
  const requestJson = async (target) => {
    if (target === '/backend-api/conversations/conv-tail') {
      getCount += 1;
      return {
        status: 200,
        json: {
          conversation_id: 'conv-tail',
          current_node: getCount === 1 ? 'parent-node' : 'assistant-final',
          messages: []
        }
      };
    }
    if (target === '/backend-api/f/conversation/prepare') {
      return { status: 200, json: { conduit_token: 'prepared-token' }, headers: {} };
    }
    throw new Error('unexpected JSON request: ' + target);
  };

  const requestText = async (target, _token, _headers, options) => {
    if (target === '/backend-api/f/conversation') {
      options.onChunk(Buffer.from(
        'data: {"type":"resume_conversation_token","conversation_id":"conv-tail","token":"resume-token"}\n\n'
      ));
      options.onChunk(Buffer.from(
        'data: {"o":"patch","v":[{"p":"/message/content/parts/0","o":"append","v":"HELLO"}]}\n\n'
      ));
      const error = new Error('upstream aborted');
      error.code = 'UPSTREAM_ABORTED';
      throw error;
    }

    if (target === '/backend-api/f/conversation/resume') {
      assert.equal(typeof options.onChunk, 'function');
      options.onChunk(Buffer.from(
        'data: {"o":"patch","v":[{"p":"/message/content/parts/0","o":"append","v":"_WORLD"}]}\n\n'
      ));
      options.onChunk(Buffer.from(
        'data: {"type":"message_stream_complete","conversation_id":"conv-tail"}\n\ndata: [DONE]\n\n'
      ));
      return {
        status: 200,
        contentType: 'text/event-stream',
        text: ''
      };
    }

    throw new Error('unexpected text request: ' + target);
  };

  await conversations.sendConversation({
    conversationId: 'conv-tail',
    message: 'continue',
    recoverStream: true,
    systemHints: [],
    systemHintMentions: [],
    token: 'token-fixture',
    sessionHeaders: { Cookie: 'session=fixture' },
    requestJson,
    requestText,
    onChunk: (chunk) => downstream.push(chunk.toString('utf8'))
  });

  const combined = downstream.join('');
  assert.match(combined, /HELLO/);
  assert.match(combined, /_WORLD/);
  assert.match(combined, /\[DONE\]/);
});
