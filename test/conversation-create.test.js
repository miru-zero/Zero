const test = require('node:test');
const assert = require('node:assert/strict');
const conversations = require('../src/providers/chatgpt/conversations');

test('createConversation prepares, uses returned conduit, sends, then fetches detail', async () => {
  const calls=[];
  const requestJson=async (target, token, headers, options={}) => {
    calls.push({target,options});
    if(target.endsWith('/f/conversation/prepare')) return {status:200,json:{},headers:{'x-conduit-token':'ct'}};
    if(target.startsWith('/backend-api/conversations/')) return {status:200,json:{conversation_id:'conv-new',current_node:'node-new',messages:[]}};
    throw new Error('unexpected '+target);
  };
  const requestText=async (target, token, headers, options={}) => { calls.push({target,options}); return {status:200,text:'data: {"conversation_id":"conv-new"}\n\n'}; };
  const result=await conversations.createConversation({message:'hello',token:'t',sessionHeaders:{'user-agent':'UA'},requestJson,requestText});
  const send=calls.find(x=>x.target==='/backend-api/f/conversation');
  assert.equal(result.conversation_id,'conv-new');
  assert.equal(result.current_node,'node-new');
  assert.equal(send.options.body.conversation_mode.kind,'primary_assistant');
  assert.equal(send.options.body.conversation_id,undefined);
  assert.equal(send.options.headers['x-conduit-token'],'ct');
});

test('createConversation mirrors core ChatGPT Web protocol context', async () => {
  let prepareBody = null;
  let sendBody = null;
  const requestJson = async (target, token, headers, options = {}) => {
    if (target.endsWith('/f/conversation/prepare')) {
      prepareBody = options.body;
      return { status: 200, json: {}, headers: { 'x-conduit-token': 'ct' } };
    }
    if (target.startsWith('/backend-api/conversations/')) {
      return { status: 200, json: { conversation_id: 'conv-web', current_node: 'node-web', messages: [] } };
    }
    if (target === '/backend-api/conversation/init') return { status: 200, json: {} };
    throw new Error('unexpected ' + target);
  };
  const requestText = async (target, token, headers, options = {}) => {
    sendBody = options.body;
    return { status: 200, text: 'data: {"conversation_id":"conv-web"}\n\n' };
  };

  await conversations.createConversation({
    message: 'hello',
    token: 't',
    sessionHeaders: {},
    requestJson,
    requestText
  });

  for (const body of [prepareBody, sendBody]) {
    assert.equal(typeof body.timezone, 'string');
    assert.equal(typeof body.timezone_offset_min, 'number');
    assert.deepEqual(body.model_response_contracts, [{
      id: 'photo_upload_action.v1',
      protocol_version: 1,
      presets: ['cap:image', 'cap:file', 'placement:end']
    }]);
    assert.equal(body.client_contextual_info.app_name, 'chatgpt.com');
  }
  assert.equal(sendBody.enable_message_followups, true);
  assert.equal(prepareBody.fork_from_shared_post, undefined);
  assert.equal(sendBody.fork_from_shared_post, undefined);
  assert.equal(sendBody.history_and_training_disabled, undefined);
  assert.equal(sendBody.force_use_sse, undefined);
  assert.equal(sendBody.force_use_search, undefined);
  assert.equal(sendBody.force_paragen, undefined);
  assert.equal(sendBody.is_onboarding_conversation, undefined);
  assert.equal(sendBody.stream, undefined);
  assert.equal(sendBody.force_parallel_switch, 'auto');
  assert.equal(sendBody.paragen_cot_summary_display_override, 'allow');
  assert.equal(prepareBody.local_function_names, undefined);
  assert.equal(sendBody.local_function_names, undefined);
  assert.equal(typeof sendBody.messages[0].create_time, 'number');
  assert.deepEqual(sendBody.messages[0].metadata.selected_sources, []);
  assert.deepEqual(sendBody.messages[0].metadata.serialization_metadata, { custom_symbol_offsets: [] });
  assert.equal(sendBody.messages[0].metadata.submission_mode, 'manual_send');
});

test('createConversation can serialize explicit local function names without defaulting Work', async () => {
  let prepareBody = null;
  const requestJson = async (target, token, headers, options = {}) => {
    if (target.endsWith('/f/conversation/prepare')) {
      prepareBody = options.body;
      return { status: 200, json: {}, headers: { 'x-conduit-token': 'ct' } };
    }
    if (target.startsWith('/backend-api/conversations/')) {
      return { status: 200, json: { conversation_id: 'conv-local', current_node: 'node-local', messages: [] } };
    }
    if (target === '/backend-api/conversation/init') return { status: 200, json: {} };
    throw new Error('unexpected ' + target);
  };
  const requestText = async () => ({ status: 200, text: 'data: {"conversation_id":"conv-local"}\n\n' });

  await conversations.createConversation({
    message: 'hello',
    localFunctionNames: ['local.example'],
    token: 't',
    sessionHeaders: {},
    requestJson,
    requestText
  });

  assert.deepEqual(prepareBody.local_function_names, ['local.example']);
});

test('createConversation in project sends gizmo interaction mode', async () => {
  let sendBody=null;
  const requestJson=async (target, token, headers, options={}) => {
    if(target.endsWith('/f/conversation/prepare')) return {status:200,json:{},headers:{'x-conduit-token':'ct'}};
    if(target.startsWith('/backend-api/conversations/')) return {status:200,json:{conversation_id:'conv-p',current_node:'node-p',messages:[]}};
    throw new Error('unexpected '+target);
  };
  const requestText=async (target, token, headers, options={}) => { sendBody=options.body; return {status:200,text:'data: {"conversation_id":"conv-p"}\n\n'}; };
  await conversations.createConversation({message:'hello',projectId:'g-p-1',token:'t',sessionHeaders:{'user-agent':'UA'},requestJson,requestText});
  assert.deepEqual(sendBody.conversation_mode,{kind:'gizmo_interaction',gizmo_id:'g-p-1'});
});

test('createConversation ไม่ใส่ model: default สูงสุดตามเว็บ (gpt-5-6-thinking + thinking_effort extended)', async () => {
  let prepareBody=null; let sendBody=null;
  const requestJson=async (target, token, headers, options={}) => {
    if(target.endsWith('/f/conversation/prepare')) { prepareBody=options.body; return {status:200,json:{},headers:{'x-conduit-token':'ct'}}; }
    if(target.startsWith('/backend-api/conversations/')) return {status:200,json:{conversation_id:'conv-d',current_node:'node-d',messages:[]}};
    throw new Error('unexpected '+target);
  };
  const requestText=async (target, token, headers, options={}) => { sendBody=options.body; return {status:200,text:'data: {"conversation_id":"conv-d"}\n\n'}; };
  await conversations.createConversation({message:'hello',token:'t',sessionHeaders:{'user-agent':'UA'},requestJson,requestText});
  for (const body of [prepareBody, sendBody]) {
    assert.equal(body.model,'gpt-5-6-thinking');
    assert.equal(body.thinking_effort,'extended');
  }
});

test('createConversation ใส่ model/thinkingEffort เอง: ใช้ค่าที่ส่ง ไม่โดน default ทับ', async () => {
  let sendBody=null;
  const requestJson=async (target, token, headers, options={}) => {
    if(target.endsWith('/f/conversation/prepare')) return {status:200,json:{},headers:{'x-conduit-token':'ct'}};
    if(target.startsWith('/backend-api/conversations/')) return {status:200,json:{conversation_id:'conv-o',current_node:'node-o',messages:[]}};
    throw new Error('unexpected '+target);
  };
  const requestText=async (target, token, headers, options={}) => { sendBody=options.body; return {status:200,text:'data: {"conversation_id":"conv-o"}\n\n'}; };
  await conversations.createConversation({message:'hello',model:'gpt-5.6-sol-wm',thinkingEffort:'min',token:'t',sessionHeaders:{'user-agent':'UA'},requestJson,requestText});
  assert.equal(sendBody.model,'gpt-5.6-sol-wm');
  assert.equal(sendBody.thinking_effort,'min');
});


test('createConversation propagates structured plugin selection like ChatGPT Web', async () => {
  const hint = 'plugin:asdk_app_6a057d268ebc81919918d37eec718425';
  const message = '@Remote Desktop Commander hello';
  let prepareBody = null; let sendBody = null;
  const requestJson = async (target, token, headers, options = {}) => {
    if (target.endsWith('/f/conversation/prepare')) { prepareBody = options.body; return { status: 200, json: {}, headers: { 'x-conduit-token': 'ct' } }; }
    if (target.startsWith('/backend-api/conversations/')) return { status: 200, json: { conversation_id: 'conv-h', current_node: 'node-h', messages: [] } };
    throw new Error('unexpected ' + target);
  };
  const requestText = async (target, token, headers, options = {}) => { sendBody = options.body; return { status: 200, text: 'data: {"conversation_id":"conv-h"}\n\n' }; };
  await conversations.createConversation({ message, systemHints: [hint], systemHintMentions: [{ id: hint, startIndex: 0, endIndex: 25 }], token: 't', sessionHeaders: {}, requestJson, requestText });
  assert.deepEqual(prepareBody.system_hints, [hint]);
  assert.deepEqual(sendBody.system_hints, [hint]);
  assert.deepEqual(sendBody.messages[0].metadata.system_hints, [hint]);
  assert.deepEqual(sendBody.messages[0].metadata.serialization_metadata.custom_symbol_offsets, [{ id: hint, symbol: 'ecosystemMention', startIndex: 0, endIndex: 25 }]);
});


test('createConversation auto-resolves @connector without CLI preprocessing', async () => {
  const hint = 'plugin:asdk_app_6a057d268ebc81919918d37eec718425';
  let prepareBody = null; let sendBody = null;
  const requestJson = async (target, token, headers, options = {}) => {
    if (target.endsWith('/f/conversation/prepare')) { prepareBody = options.body; return { status: 200, json: {}, headers: { 'x-conduit-token': 'ct' } }; }
    if (target.startsWith('/backend-api/conversations/')) return { status: 200, json: { conversation_id: 'conv-auto', current_node: 'node-auto', messages: [] } };
    throw new Error('unexpected ' + target);
  };
  const requestText = async (target, token, headers, options = {}) => {
    sendBody = options.body;
    return { status: 200, text: 'data: {"conversation_id":"conv-auto"}\n\n' };
  };
  await conversations.createConversation({
    message: '@Remote Desktop Commander hello', token: 't', sessionHeaders: {}, requestJson, requestText,
    listConnectors: async () => [{ id: 'plugin_asdk_app_6a057d268ebc81919918d37eec718425', displayName: 'Remote Desktop Commander', enabled: true }]
  });
  assert.deepEqual(prepareBody.system_hints, [hint]);
  assert.deepEqual(sendBody.system_hints, [hint]);
  assert.deepEqual(sendBody.messages[0].metadata.system_hints, [hint]);
});

test('createConversation forwards onChunk into conversation transport', async () => {
  const seen = [];
  const requestJson = async (target) => {
    if (target.endsWith('/f/conversation/prepare')) {
      return { status: 200, json: {}, headers: { 'x-conduit-token': 'ct' } };
    }
    if (target.startsWith('/backend-api/conversations/')) {
      return { status: 200, json: { conversation_id: 'conv-stream', current_node: 'node-stream', messages: [] } };
    }
    throw new Error('unexpected ' + target);
  };
  const requestText = async (target, token, headers, options = {}) => {
    assert.equal(typeof options.onChunk, 'function');
    options.onChunk(Buffer.from('data: stream-part\n\n'));
    return { status: 200, text: 'data: {"conversation_id":"conv-stream"}\n\n' };
  };
  await conversations.createConversation({
    message: 'hello', token: 't', sessionHeaders: {}, requestJson, requestText,
    onChunk: (chunk) => seen.push(chunk.toString('utf8'))
  });
  assert.deepEqual(seen, ['data: stream-part\n\n']);
});


test('createConversation sends visible user text separately from hidden system context', async () => {
  let sendBody = null;
  const requestJson = async (target) => {
    if (target.endsWith('/f/conversation/prepare')) {
      return { status: 200, json: {}, headers: { 'x-conduit-token': 'ct' } };
    }
    if (target.startsWith('/backend-api/conversations/')) {
      return { status: 200, json: { conversation_id: 'conv-role', current_node: 'node-role', messages: [] } };
    }
    if (target === '/backend-api/conversation/init') return { status: 200, json: {} };
    throw new Error('unexpected ' + target);
  };
  const requestText = async (target, token, headers, options = {}) => {
    sendBody = options.body;
    return { status: 200, text: 'data: {"conversation_id":"conv-role"}\n\n' };
  };

  await conversations.createConversation({
    message: 'VISIBLE_USER_ONLY',
    hiddenSystemMessages: ['HIDDEN_SYSTEM_ONLY', 'HIDDEN_TOOL_SCHEMA'],
    token: 't',
    sessionHeaders: {},
    requestJson,
    requestText
  });

  assert.equal(sendBody.messages[0].author.role, 'user');
  assert.equal(sendBody.messages[0].content.parts[0], 'VISIBLE_USER_ONLY');
  assert.equal(sendBody.messages[1].author.role, 'system');
  assert.equal(sendBody.messages[1].content.parts[0], 'HIDDEN_SYSTEM_ONLY');
  assert.equal(sendBody.messages[2].author.role, 'system');
  assert.equal(sendBody.messages[2].content.parts[0], 'HIDDEN_TOOL_SCHEMA');
  assert.equal(sendBody.messages[1].metadata.is_visually_hidden_from_conversation, true);
  assert.equal(sendBody.messages[2].metadata.is_visually_hidden_from_conversation, true);
});
