const test = require('node:test');
const assert = require('node:assert/strict');
const conversations = require('../src/providers/chatgpt/conversations');

test('sendConversation sends into existing conversation using current_node and project mode', async () => {
  const calls = [];
  const requestJson = async (target, token, headers, options = {}) => {
    calls.push({ target, options });
    if (target === '/backend-api/conversations/c-old') return { status: 200, json: { conversation_id: 'c-old', current_node: 'node-old', gizmo_id: 'g-p-1', messages: [] } };
    if (target === '/backend-api/f/conversation/prepare') return { status: 200, json: {}, headers: { 'x-conduit-token': 'ct' } };
    throw new Error('unexpected ' + target);
  };
  const requestText = async (target, token, headers, options = {}) => {
    calls.push({ target, options });
    return { status: 200, text: 'data: {"conversation_id":"c-old"}\n\n' };
  };
  await conversations.sendConversation({ conversationId: 'c-old', message: 'hello', transport: 'direct', token: 't', sessionHeaders: {}, requestJson, requestText });
  const send = calls.find((x) => x.target === '/backend-api/f/conversation');
  assert.equal(send.options.body.conversation_id, 'c-old');
  assert.equal(send.options.body.parent_message_id, 'node-old');
  assert.equal(send.options.body.model, 'gpt-5-6-thinking');
  assert.equal(send.options.body.thinking_effort, 'extended');
  assert.deepEqual(send.options.body.conversation_mode, { kind: 'gizmo_interaction', gizmo_id: 'g-p-1' });
});

test('sendConversation mirrors core ChatGPT Web protocol context on existing conversation', async () => {
  const calls = [];
  let getCount = 0;
  const requestJson = async (target, token, headers, options = {}) => {
    calls.push({ target, options });
    if (target === '/backend-api/conversations/c-old') {
      getCount += 1;
      return {
        status: 200,
        json: {
          conversation_id: 'c-old',
          current_node: getCount === 1 ? 'node-old' : 'node-new',
          gizmo_id: 'g-p-1',
          messages: []
        }
      };
    }
    if (target === '/backend-api/f/conversation/prepare') {
      return { status: 200, json: {}, headers: { 'x-conduit-token': 'ct' } };
    }
    throw new Error('unexpected ' + target);
  };
  const requestText = async (target, token, headers, options = {}) => {
    calls.push({ target, options });
    return { status: 200, text: 'data: {"conversation_id":"c-old"}\n\n' };
  };

  await conversations.sendConversation({
    conversationId: 'c-old',
    message: 'hello',
    localFunctionNames: ['local.example'],
    transport: 'direct',
    token: 't',
    sessionHeaders: {},
    requestJson,
    requestText
  });

  const prepares = calls.filter((x) => x.target === '/backend-api/f/conversation/prepare');
  const send = calls.find((x) => x.target === '/backend-api/f/conversation');

  assert.equal(prepares[0].options.body.client_prepare_state, 'none');
  assert.equal(prepares[0].options.body.client_prepare_dispatch, 'immediate');
  assert.equal(prepares[0].options.body.client_prepare_source, 'context_change');
  assert.deepEqual(prepares[0].options.body.local_function_names, ['local.example']);

  for (const body of [prepares[0].options.body, prepares[1].options.body, send.options.body]) {
    assert.equal(typeof body.timezone, 'string');
    assert.equal(typeof body.timezone_offset_min, 'number');
    assert.deepEqual(body.model_response_contracts, [{
      id: 'photo_upload_action.v1',
      protocol_version: 1,
      presets: ['cap:image', 'cap:file', 'placement:end']
    }]);
    assert.equal(body.client_contextual_info.app_name, 'chatgpt.com');
  }
  assert.equal(prepares[0].options.body.fork_from_shared_post, undefined);
  assert.equal(prepares[1].options.body.fork_from_shared_post, undefined);
  assert.equal(send.options.body.fork_from_shared_post, undefined);
  assert.equal(send.options.body.history_and_training_disabled, undefined);
  assert.equal(send.options.body.enable_message_followups, true);
  assert.equal(send.options.body.force_use_sse, undefined);
  assert.equal(send.options.body.force_use_search, undefined);
  assert.equal(send.options.body.force_paragen, undefined);
  assert.equal(send.options.body.is_onboarding_conversation, undefined);
  assert.equal(send.options.body.stream, undefined);
  assert.deepEqual(send.options.body.local_function_names, ['local.example']);
  assert.equal(prepares[0].options.body.force_parallel_switch, undefined);
  assert.equal(prepares[0].options.body.paragen_cot_summary_display_override, undefined);
  assert.equal(prepares[1].options.body.force_parallel_switch, undefined);
  assert.equal(prepares[1].options.body.paragen_cot_summary_display_override, undefined);
  assert.equal(send.options.body.force_parallel_switch, 'auto');
  assert.equal(send.options.body.paragen_cot_summary_display_override, 'allow');
  assert.equal(typeof send.options.body.messages[0].create_time, 'number');
  assert.deepEqual(send.options.body.messages[0].metadata.selected_sources, []);
  assert.equal(send.options.body.messages[0].metadata.submission_mode, 'manual_send');
  assert.equal(send.options.body.messages[0].metadata.gizmo_id, 'g-p-1');
});

test('sendConversation follows prepared browser handoff contract', async () => {
  const calls = [];
  const sessionHeaders = {
    'x-oai-is-client-observation': 'v1.r.p.old',
    'openai-sentinel-chat-requirements-token': 'req',
    'openai-sentinel-proof-token': 'proof',
    'openai-sentinel-turnstile-token': 'turn'
  };
  let getCount = 0;
  const requestJson = async (target, token, headers, options = {}) => {
    calls.push({ target, headers: { ...headers }, options });
    if (target === '/backend-api/conversations/c-old') {
      getCount += 1;
      return { status: 200, json: { conversation_id: 'c-old', current_node: getCount === 1 ? 'node-old' : 'node-new', gizmo_id: 'g-p-1', messages: [] } };
    }
    if (target === '/backend-api/f/conversation/prepare' && options.body.client_prepare_state === 'none')
      return { status: 200, json: {}, headers: { 'x-conduit-token': 'ct', 'x-oai-is-update': 'ois1.h.nonce1.payload' } };
    if (target === '/backend-api/f/conversation/prepare' && options.body.client_prepare_state === 'success')
      return { status: 200, json: {}, headers: { 'x-oai-is-update': 'ois1.h.nonce2.payload' } };
    throw new Error('unexpected ' + target);
  };  const requestText = async (target, token, headers, options = {}) => {
    calls.push({ target, headers: { ...headers }, options });
    return { status: 200, text: 'data: {"conversation_id":"c-old"}\n\n', headers: {} };
  };
  await conversations.sendConversation({ conversationId: 'c-old', message: 'hello', transport: 'direct', token: 't', sessionHeaders, requestJson, requestText });
  const prepares = calls.filter((x) => x.target === '/backend-api/f/conversation/prepare');
  assert.equal(prepares.length, 2);
  assert.equal(prepares[0].options.body.client_prepare_state, 'none');
  assert.equal(prepares[1].options.body.client_prepare_state, 'success');
  assert.equal(prepares[1].options.headers['x-conduit-token'], 'ct');
  assert.equal(prepares[1].options.headers['x-oai-is-client-observation'], 'v1.r.p.nonce1');
  const send = calls.find((x) => x.target === '/backend-api/f/conversation');
  assert.equal(send.options.headers['openai-sentinel-chat-requirements-token'], 'req');
  assert.equal(send.options.headers['openai-sentinel-proof-token'], 'proof');
  assert.equal(send.options.headers['openai-sentinel-turnstile-token'], 'turn');
  assert.equal(send.options.headers['x-conduit-token'], 'ct');
  assert.equal(send.options.headers['x-oai-is-client-observation'], 'v1.s.p.nonce2');
});

test('sendConversation uses browser bridge when transport=browser', async () => {
  let bridgeInput = null;
  const browserSend = async (input) => {
    bridgeInput = input;
    return {
      success: true,
      status: 'OK',
      conversationId: 'c-old',
      previousNode: 'node-old',
      currentNode: 'node-new'
    };
  };
  const requestJson = async () => { throw new Error('DIRECT_TRANSPORT_CALLED'); };
  const result = await conversations.sendConversation({
    conversationId: 'c-old',
    message: 'hello',
    transport: 'browser',
    browserSend,
    requestJson
  });
  assert.deepEqual(bridgeInput, { conversationId: 'c-old', message: 'hello', waitForFinal: false });
  assert.equal(result.conversation_id, 'c-old');
  assert.equal(result.current_node, 'node-new');
  assert.equal(result.previous_node, 'node-old');
});

test('sendConversation defaults to direct transport without touching browser', async () => {
  const requestJson = async (target) => {
    if (target === '/backend-api/conversations/c-old') return { status: 200, json: { conversation_id: 'c-old', current_node: 'node-old', messages: [] } };
    if (target === '/backend-api/f/conversation/prepare') return { status: 200, json: {}, headers: { 'x-conduit-token': 'ct' } };
    throw new Error('unexpected ' + target);
  };
  const requestText = async () => ({ status: 200, text: 'data: {"conversation_id":"c-old"}\n\n' });
  const browserSend = async () => { throw new Error('BROWSER_CALLED'); };
  const result = await conversations.sendConversation({
    conversationId: 'c-old',
    message: 'hello',
    browserSend,
    token: 't',
    sessionHeaders: {},
    requestJson,
    requestText
  });
  assert.equal(result.conversation_id, 'c-old');
});


test('sendConversation forwards Zero session headers to browser bridge', async () => {
  let bridgeInput = null;
  const sessionHeaders = { Cookie: 'session=a' };
  await conversations.sendConversation({
    conversationId: 'c-old',
    message: 'hello',
    transport: 'browser',
    sessionHeaders,
    browserSend: async (input) => {
      bridgeInput = input;
      return {
        success: true,
        status: 'OK',
        conversationId: 'c-old',
        previousNode: 'n1',
        currentNode: 'n2'
      };
    }
  });
  assert.equal(bridgeInput.sessionHeaders, sessionHeaders);
});

test('sendConversation forwards Zero access token to browser bridge', async () => {
  let bridgeInput = null;
  await conversations.sendConversation({
    conversationId: 'c-old',
    message: 'hello',
    transport: 'browser',
    token: 'token-fixture',
    browserSend: async (input) => {
      bridgeInput = input;
      return {
        success: true,
        status: 'OK',
        conversationId: 'c-old',
        previousNode: 'n1',
        currentNode: 'n2'
      };
    }
  });
  assert.equal(bridgeInput.token, 'token-fixture');
});
test('sendConversation targetedReply: user metadata + hidden system message ตาม spec เว็บ', async () => {
  const calls = [];
  const requestJson = async (target, token, headers, options = {}) => {
    calls.push({ target, options });
    if (target === '/backend-api/conversations/c-old') return { status: 200, json: { conversation_id: 'c-old', current_node: 'node-old', messages: [] } };
    if (target === '/backend-api/f/conversation/prepare') return { status: 200, json: {}, headers: { 'x-conduit-token': 'ct' } };
    throw new Error('unexpected ' + target);
  };
  const requestText = async (target, token, headers, options = {}) => {
    calls.push({ target, options });
    return { status: 200, text: 'data: {"conversation_id":"c-old"}\n\n' };
  };
  await conversations.sendConversation({
    conversationId: 'c-old', message: 'อันนี้หมายถึงอะไร', transport: 'direct',
    targetedReply: { text: 'QUOTE_ME_123', sourceMessageId: 'msg-src-1', sourceRange: { start: 0, end: 11 } },
    token: 't', sessionHeaders: {}, requestJson, requestText
  });
  const send = calls.find((x) => x.target === '/backend-api/f/conversation');
  const msgs = send.options.body.messages;
  assert.equal(msgs.length, 2);
  // user message แปะ targeted_reply metadata ครบ
  assert.equal(msgs[0].author.role, 'user');
  assert.equal(msgs[0].metadata.targeted_reply, 'QUOTE_ME_123');
  assert.equal(msgs[0].metadata.targeted_reply_label, 'QUOTE_ME_123');
  assert.equal(msgs[0].metadata.targeted_reply_source_message_id, 'msg-src-1');
  assert.deepEqual(msgs[0].metadata.targeted_reply_source_range, { start: 0, end: 11 });
  // hidden system message ตามหลัง ตรง capture จริง
  assert.equal(msgs[1].author.role, 'system');
  assert.equal(msgs[1].content.parts[0], 'The user is referring to this in particular:\nQUOTE_ME_123');
  assert.equal(msgs[1].metadata.exclude_after_next_user_message, true);
  assert.equal(msgs[1].metadata.is_visually_hidden_from_conversation, true);
});

test('sendConversation ไม่ส่ง targetedReply = messages ตัวเดียวเหมือนเดิม', async () => {
  const calls = [];
  const requestJson = async (target, token, headers, options = {}) => {
    calls.push({ target, options });
    if (target === '/backend-api/conversations/c-old') return { status: 200, json: { conversation_id: 'c-old', current_node: 'node-old', messages: [] } };
    if (target === '/backend-api/f/conversation/prepare') return { status: 200, json: {}, headers: { 'x-conduit-token': 'ct' } };
    throw new Error('unexpected ' + target);
  };
  const requestText = async (target, token, headers, options = {}) => {
    calls.push({ target, options });
    return { status: 200, text: 'data: {"conversation_id":"c-old"}\n\n' };
  };
  await conversations.sendConversation({ conversationId: 'c-old', message: 'hello', transport: 'direct', token: 't', sessionHeaders: {}, requestJson, requestText });
  const send = calls.find((x) => x.target === '/backend-api/f/conversation');
  assert.equal(send.options.body.messages.length, 1);
  assert.equal(send.options.body.messages[0].metadata.targeted_reply, undefined);
});


test('sendConversation auto-resolves @connector into system_hints for direct sends', async () => {
  const hint = 'plugin:asdk_app_6a057d268ebc81919918d37eec718425';
  const calls = [];
  const requestJson = async (target, token, headers, options = {}) => {
    calls.push({ target, options });
    if (target === '/backend-api/conversations/c-old') return { status: 200, json: { conversation_id: 'c-old', current_node: 'node-old', messages: [] } };
    if (target === '/backend-api/f/conversation/prepare') return { status: 200, json: {}, headers: { 'x-conduit-token': 'ct' } };
    throw new Error('unexpected ' + target);
  };
  const requestText = async (target, token, headers, options = {}) => {
    calls.push({ target, options });
    return { status: 200, text: 'data: {"conversation_id":"c-old"}\n\n' };
  };
  await conversations.sendConversation({
    conversationId: 'c-old', message: '@Remote Desktop Commander run list_devices', token: 't', sessionHeaders: {}, requestJson, requestText,
    listConnectors: async () => [{ id: 'plugin_asdk_app_6a057d268ebc81919918d37eec718425', displayName: 'Remote Desktop Commander', enabled: true }]
  });
  const prepares = calls.filter((x) => x.target === '/backend-api/f/conversation/prepare');
  const send = calls.find((x) => x.target === '/backend-api/f/conversation');
  assert.deepEqual(prepares[0].options.body.system_hints, [hint]);
  assert.deepEqual(send.options.body.system_hints, [hint]);
  assert.deepEqual(send.options.body.messages[0].metadata.system_hints, [hint]);
  assert.deepEqual(send.options.body.messages[0].metadata.serialization_metadata.custom_symbol_offsets, [{ id: hint, symbol: 'ecosystemMention', startIndex: 0, endIndex: 25 }]);
});

test('sendConversation direct forwards onChunk into conversation transport', async () => {
  const seen = [];
  let getCount = 0;
  const requestJson = async (target) => {
    if (target === '/backend-api/conversations/c-stream') {
      getCount += 1;
      return {
        status: 200,
        json: {
          conversation_id: 'c-stream',
          current_node: getCount === 1 ? 'node-before' : 'node-after',
          messages: []
        }
      };
    }
    if (target === '/backend-api/f/conversation/prepare') {
      return { status: 200, json: {}, headers: { 'x-conduit-token': 'ct' } };
    }
    throw new Error('unexpected ' + target);
  };
  const requestText = async (target, token, headers, options = {}) => {
    assert.equal(typeof options.onChunk, 'function');
    options.onChunk(Buffer.from('data: continuation\n\n'));
    return { status: 200, text: 'data: {"conversation_id":"c-stream"}\n\n' };
  };
  const result = await conversations.sendConversation({
    conversationId: 'c-stream',
    message: 'next turn',
    token: 't',
    sessionHeaders: {},
    requestJson,
    requestText,
    onChunk: (chunk) => seen.push(chunk.toString('utf8'))
  });

  assert.equal(result.conversation_id, 'c-stream');
  assert.equal(result.current_node, 'node-after');
  assert.deepEqual(seen, ['data: continuation\n\n']);
});


test('sendConversation can hide an internal trigger user message while carrying hidden system context', async () => {
  const calls = [];
  let getCount = 0;
  const requestJson = async (target, token, headers, options = {}) => {
    calls.push({ target, options });
    if (target === '/backend-api/conversations/c-hidden') {
      getCount += 1;
      return {
        status: 200,
        json: {
          conversation_id: 'c-hidden',
          current_node: getCount === 1 ? 'node-before' : 'node-after',
          messages: []
        }
      };
    }
    if (target === '/backend-api/f/conversation/prepare') {
      return { status: 200, json: {}, headers: { 'x-conduit-token': 'ct' } };
    }
    throw new Error('unexpected ' + target);
  };
  const requestText = async (target, token, headers, options = {}) => {
    calls.push({ target, options });
    return { status: 200, text: 'data: {"conversation_id":"c-hidden"}\n\n' };
  };

  await conversations.sendConversation({
    conversationId: 'c-hidden',
    message: 'INTERNAL_CONTINUE_TRIGGER',
    hideUserMessage: true,
    hiddenSystemMessages: ['TOOL_RESULT_CONTEXT'],
    token: 't',
    sessionHeaders: {},
    requestJson,
    requestText
  });

  const send = calls.find((item) => item.target === '/backend-api/f/conversation');
  assert.equal(send.options.body.messages[0].author.role, 'user');
  assert.equal(send.options.body.messages[0].content.parts[0], 'INTERNAL_CONTINUE_TRIGGER');
  assert.equal(send.options.body.messages[0].metadata.is_visually_hidden_from_conversation, true);
  assert.equal(send.options.body.messages[1].author.role, 'system');
  assert.equal(send.options.body.messages[1].content.parts[0], 'TOOL_RESULT_CONTEXT');
});
