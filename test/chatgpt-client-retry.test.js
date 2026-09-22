const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const https = require('node:https');
const chatgptClient = require('../src/providers/chatgpt/chatgpt-client');

const mockSequence = (steps) => {
  const calls = [];
  const original = https.request;
  https.request = (url, options, callback) => {
    const step = steps[Math.min(calls.length, steps.length - 1)];
    calls.push({ url, options });
    const req = new EventEmitter();
    req.write = () => {};
    req.end = () => {
      process.nextTick(() => {
        const res = new EventEmitter();
        res.statusCode = step.status;
        res.headers = step.headers || { 'content-type': 'application/json' };
        callback(res);
        res.emit('data', Buffer.from(step.body || '{}'));
        res.emit('end');
      });
    };
    return req;
  };
  return { calls, restore: () => { https.request = original; } };
};

const noSleep = () => Promise.resolve();

test('requestJson returns the first 429 without another request by default', async () => {
  const mock = mockSequence([{ status: 429 }, { status: 200 }]);
  try {
    const res = await chatgptClient.requestJson('/backend-api/x', 't', {});
    assert.equal(res.status, 429);
    assert.equal(mock.calls.length, 1);
  } finally { mock.restore(); }
});

test('requestText returns the first 429 without another request by default', async () => {
  const mock = mockSequence([{ status: 429 }, { status: 200 }]);
  try {
    const res = await chatgptClient.requestText('/backend-api/f/conversation', 't', {}, { method: 'POST' });
    assert.equal(res.status, 429);
    assert.equal(mock.calls.length, 1);
  } finally { mock.restore(); }
});

test('requestJson does not retry a POST after a server error by default', async () => {
  const mock = mockSequence([{ status: 503 }, { status: 200 }]);
  try {
    const res = await chatgptClient.requestJson('/backend-api/x', 't', {}, { method: 'POST', body: { message: 'once' } });
    assert.equal(res.status, 503);
    assert.equal(mock.calls.length, 1);
  } finally { mock.restore(); }
});

test('requestJson retries on 503 then succeeds', async () => {
  const mock = mockSequence([{ status: 503 }, { status: 200, body: '{"ok":true}' }]);
  try {
    const res = await chatgptClient.requestJson('/backend-api/x', 't', {}, { retry: { sleepImpl: noSleep } });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { ok: true });
    assert.equal(mock.calls.length, 2);
  } finally { mock.restore(); }
});

test('requestJson honors Retry-After seconds before retrying', async () => {
  const mock = mockSequence([{ status: 503, headers: { 'retry-after': '2' } }, { status: 200 }]);
  const waits = [];
  const captureSleep = (ms) => { waits.push(ms); return Promise.resolve(); };
  try {
    const res = await chatgptClient.requestJson('/backend-api/x', 't', {}, { retry: { sleepImpl: captureSleep } });
    assert.equal(res.status, 200);
    assert.deepEqual(waits, [2000]);
  } finally { mock.restore(); }
});

test('requestJson falls back to exponential backoff without Retry-After', async () => {
  const mock = mockSequence([{ status: 503 }, { status: 503 }, { status: 200 }]);
  const waits = [];
  const captureSleep = (ms) => { waits.push(ms); return Promise.resolve(); };
  try {
    const res = await chatgptClient.requestJson('/backend-api/x', 't', {}, { retry: { sleepImpl: captureSleep, baseMs: 500 } });
    assert.equal(res.status, 200);
    assert.deepEqual(waits, [500, 1000]);
  } finally { mock.restore(); }
});

test('requestJson gives up after maxRetries and returns last 503', async () => {
  const mock = mockSequence([{ status: 503 }]);
  try {
    const res = await chatgptClient.requestJson('/backend-api/x', 't', {}, { retry: { sleepImpl: noSleep, maxRetries: 2 } });
    assert.equal(res.status, 503);
    assert.equal(mock.calls.length, 3);
  } finally { mock.restore(); }
});

test('requestJson does not retry 403', async () => {
  const mock = mockSequence([{ status: 403 }, { status: 200 }]);
  try {
    const res = await chatgptClient.requestJson('/backend-api/x', 't', {}, { retry: { sleepImpl: noSleep } });
    assert.equal(res.status, 403);
    assert.equal(mock.calls.length, 1);
  } finally { mock.restore(); }
});

test('requestJson retry:false disables retry', async () => {
  const mock = mockSequence([{ status: 429 }, { status: 200 }]);
  try {
    const res = await chatgptClient.requestJson('/backend-api/x', 't', {}, { retry: false });
    assert.equal(res.status, 429);
    assert.equal(mock.calls.length, 1);
  } finally { mock.restore(); }
});

test('requestText retries on 503 then succeeds when explicitly requested', async () => {
  const mock = mockSequence([{ status: 503 }, { status: 200, body: 'data: [DONE]' }]);
  try {
    const res = await chatgptClient.requestText('/backend-api/f/conversation', 't', {}, { retry: { sleepImpl: noSleep } });
    assert.equal(res.status, 200);
    assert.equal(res.text, 'data: [DONE]');
    assert.equal(mock.calls.length, 2);
  } finally { mock.restore(); }
});

test('parseRetryAfterMs handles seconds, dates, caps, and junk', () => {
  assert.equal(chatgptClient.parseRetryAfterMs({ 'retry-after': '3' }), 3000);
  assert.equal(chatgptClient.parseRetryAfterMs({ 'retry-after': '999' }), 30000);
  assert.equal(chatgptClient.parseRetryAfterMs({ 'retry-after': new Date(Date.now() + 1500).toUTCString() }) <= 30000, true);
  assert.equal(chatgptClient.parseRetryAfterMs({ 'retry-after': 'garbage' }), null);
  assert.equal(chatgptClient.parseRetryAfterMs({}), null);
});
