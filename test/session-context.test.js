const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sessionContext = require('../src/core/session-context');

const withSessionFile = (data, callback) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-session-'));
  const file = path.join(dir, 'session-context.json');
  fs.writeFileSync(file, JSON.stringify(data));
  try {
    return callback(file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

test('loads top-level cookie browser session context', () => {
  withSessionFile({ cookie: 'a=b', headers: { 'oai-session-id': 'S1' } }, (file) => {
    const result = sessionContext.loadSessionContext({}, file);
    assert.equal(result.status, 'READY');
    assert.equal(result.cookie, 'a=b');
    assert.equal(result.headers.Cookie, 'a=b');
    assert.equal(result.headers['oai-session-id'], 'S1');
  });
});

test('load supports Cookie stored inside headers', () => {
  withSessionFile({ headers: { Cookie: 'c=d', accept: '*/*' } }, (file) => {
    const result = sessionContext.load(file);
    assert.equal(result.status, 'READY');
    assert.equal(result.cookie, 'c=d');
    assert.equal(result.headers.Cookie, 'c=d');
    assert.equal(result.headers.accept, '*/*');
  });
});