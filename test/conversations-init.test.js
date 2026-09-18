const test = require('node:test');
const assert = require('node:assert/strict');
const conversations = require('../src/providers/chatgpt/conversations');

test('initConversation: ยิง POST /backend-api/conversation/init ด้วย body ตรงสเปกเว็บจริง', async () => {
  let seen = null;
  const requestJson = async (target, token, sessionHeaders, options) => {
    seen = { target, token, sessionHeaders, options };
    return { status: 200, json: { type: 'conversation_detail_metadata', default_model_slug: 'gpt-5-6-thinking' } };
  };
  const result = await conversations.initConversation({
    conversationId: 'c-1',
    projectId: 'g-p-1',
    model: 'gpt-5-6-thinking',
    token: 'tok',
    sessionHeaders: { Cookie: 'a=b' },
    requestJson
  });
  assert.equal(seen.target, '/backend-api/conversation/init');
  assert.equal(seen.options.method, 'POST');
  const body = seen.options.body;
  assert.equal(body.gizmo_id, 'g-p-1');
  assert.equal(body.requested_default_model, 'gpt-5-6-thinking');
  assert.equal(body.conversation_id, 'c-1');
  assert.equal(body.conversation_origin, null);
  assert.equal(typeof body.timezone, 'string');
  assert.equal(typeof body.timezone_offset_min, 'number');
  // เครื่องนี้ Asia/Bangkok → getTimezoneOffset() = -420 ตรงกับ curl จริง
  assert.equal(body.timezone_offset_min, new Date().getTimezoneOffset());
  assert.equal(result.default_model_slug, 'gpt-5-6-thinking');
});

test('initConversation: ค่า default นอก project → gizmo_id/requested_default_model เป็น null', async () => {
  let seen = null;
  const requestJson = async (target, token, sessionHeaders, options) => {
    seen = options;
    return { status: 200, json: {} };
  };
  await conversations.initConversation({ conversationId: 'c-2', token: 'tok', sessionHeaders: {}, requestJson });
  assert.equal(seen.body.gizmo_id, null);
  assert.equal(seen.body.requested_default_model, null);
});

test('initConversation: response ไม่ 2xx → throw พร้อม status', async () => {
  const requestJson = async () => ({ status: 429, json: null });
  await assert.rejects(
    conversations.initConversation({ conversationId: 'c-3', token: 'tok', sessionHeaders: {}, requestJson }),
    (error) => error.status === 429 && /conversation\/init/.test(error.message)
  );
});

test('initConversation: ไม่ส่ง conversationId → throw ก่อนยิง request', async () => {
  const requestJson = async () => { throw new Error('must not be called'); };
  await assert.rejects(
    conversations.initConversation({ token: 'tok', sessionHeaders: {}, requestJson }),
    /conversationId is required/
  );
});
