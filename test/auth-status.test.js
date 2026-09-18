const test = require('node:test');
const assert = require('node:assert/strict');

const loadModule = () => {
  try {
    return require('../src/core/auth-status');
  } catch (error) {
    if (error.code === 'MODULE_NOT_FOUND') {
      return { inspectAccessToken: () => ({ status: 'NOT_IMPLEMENTED' }) };
    }
    throw error;
  }
};

const makeJwt = (payload) => {
  const enc = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${enc({ alg: 'none', typ: 'JWT' })}.${enc(payload)}.x`;
};

const authStatus = loadModule();

test('returns MISSING when accessToken is absent', () => {
  assert.equal(authStatus.inspectAccessToken(null, 1_000).status, 'MISSING');
});

test('returns VALID for an unexpired JWT accessToken', () => {
  const token = makeJwt({ sub: 'user', exp: 1_120 });
  const result = authStatus.inspectAccessToken(token, 1_000);
  assert.equal(result.status, 'VALID');
  assert.equal(result.remainingSeconds, 120);
  assert.equal(result.expiresAt, 1_120);
});

test('returns EXPIRED for an expired JWT accessToken', () => {
  const token = makeJwt({ sub: 'user', exp: 999 });
  const result = authStatus.inspectAccessToken(token, 1_000);
  assert.equal(result.status, 'EXPIRED');
  assert.equal(result.remainingSeconds, -1);
});

test('returns INVALID for malformed accessToken', () => {
  const result = authStatus.inspectAccessToken('not-a-jwt', 1_000);
  assert.equal(result.status, 'INVALID');
  assert.equal(result.reason, 'MALFORMED_JWT');
});

test('returns INVALID when JWT has no exp claim', () => {
  const token = makeJwt({ sub: 'user' });
  const result = authStatus.inspectAccessToken(token, 1_000);
  assert.equal(result.status, 'INVALID');
  assert.equal(result.reason, 'MISSING_EXP');
});
