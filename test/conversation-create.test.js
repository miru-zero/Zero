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
