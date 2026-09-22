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

test('requestText emits response chunks before end when onChunk is provided', async () => {
  const original = https.request;
  const seen = [];
  https.request = (url, options, callback) => {
    const req = new EventEmitter(); req.write = () => {}; req.end = () => {};
    process.nextTick(() => {
      const res = new EventEmitter();
      res.statusCode = 200;
      res.headers = { 'content-type': 'text/event-stream' };
      callback(res);
      res.emit('data', Buffer.from('data: one\n\n'));
      res.emit('data', Buffer.from('data: two\n\n'));
      res.emit('end');
    });
    return req;
  };
  try {
    const result = await chatgptClient.requestText('/backend-api/f/conversation', 't', {}, {
      onChunk: (chunk) => seen.push(chunk.toString('utf8'))
    });
    assert.deepEqual(seen, ['data: one\n\n', 'data: two\n\n']);
    assert.equal(result.text, 'data: one\n\ndata: two\n\n');
  } finally { https.request = original; }
});

test('requestText rejects when the upstream response aborts before end', async () => {
  const original = https.request;
  https.request = (_url, _options, callback) => {
    const req = new EventEmitter(); req.write = () => {}; req.end = () => {};
    process.nextTick(() => {
      const res = new EventEmitter();
      res.statusCode = 200;
      res.headers = { 'content-type': 'text/event-stream' };
      callback(res);
      res.emit('data', Buffer.from('data: partial\n\n'));
      res.emit('aborted');
    });
    return req;
  };
  try {
    const outcome = await Promise.race([
      chatgptClient.requestText('/backend-api/f/conversation', 't', {}, { retry: false })
        .then(() => 'resolved', (error) => error.code),
      new Promise((resolve) => setTimeout(() => resolve('timed-out'), 50))
    ]);
    assert.equal(outcome, 'UPSTREAM_ABORTED');
  } finally { https.request = original; }
});

test('requestText bounds an idle upstream stream without retrying the POST', async () => {
  const original = https.request;
  let requestCount = 0;
  https.request = () => {
    requestCount += 1;
    const req = new EventEmitter();
    req.write = () => {};
    req.end = () => {};
    req.setTimeout = (ms, onTimeout) => {
      assert.equal(ms, 60_000);
      process.nextTick(onTimeout);
    };
    req.destroy = (error) => process.nextTick(() => req.emit('error', error));
    return req;
  };
  try {
    const outcome = await Promise.race([
      chatgptClient.requestText('/backend-api/f/conversation', 't', {}, {
        method: 'POST', retry: false, idleTimeoutMs: 60_000
      }).then(() => 'resolved', (error) => error.code),
      new Promise((resolve) => setTimeout(() => resolve('timed-out'), 50))
    ]);
    assert.equal(outcome, 'UPSTREAM_IDLE_TIMEOUT');
    assert.equal(requestCount, 1);
  } finally { https.request = original; }
});
