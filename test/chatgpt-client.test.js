const test = require('node:test');
const assert = require('node:assert/strict');
const chatgptClient = require('../src/providers/chatgpt/chatgpt-client');

test('buildHeaders supports explicit dynamic target route', () => {
  const sessionHeaders = { Cookie: 'a=b', accept: '*/*' };
  const headers = chatgptClient.buildHeaders(
    'token-1',
    sessionHeaders,
    '/backend-api/gizmos/g-p-1/conversations?cursor=0',
    '/backend-api/gizmos/{gizmo_id}/conversations'
  );

  assert.equal(headers.Cookie, 'a=b');
  assert.equal(headers.authorization, 'Bearer token-1');
  assert.equal(headers['x-openai-target-path'], '/backend-api/gizmos/g-p-1/conversations');
  assert.equal(headers['x-openai-target-route'], '/backend-api/gizmos/{gizmo_id}/conversations');
  assert.deepEqual(sessionHeaders, { Cookie: 'a=b', accept: '*/*' });
});
const { EventEmitter } = require('node:events');
const https = require('node:https');

test('requestJson exposes response headers for conduit handoff', async () => {
  const original = https.request;
  https.request = (url, options, callback) => {
    const req = new EventEmitter(); req.write = () => {}; req.end = () => {};
    process.nextTick(() => {
      const res = new EventEmitter();
      res.statusCode = 200; res.headers = { 'content-type': 'application/json', 'x-conduit-token': 'ct' };
      callback(res); res.emit('data', Buffer.from('{}')); res.emit('end');
    });
    return req;
  };
  try {
    const result = await chatgptClient.requestJson('/backend-api/f/conversation/prepare', 't', {});
    assert.equal(result.headers['x-conduit-token'], 'ct');
  } finally { https.request = original; }
});
