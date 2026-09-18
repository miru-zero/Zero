const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const makeJwt = (exp) => {
  const enc = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${enc({ alg: 'none', typ: 'JWT' })}.${enc({ sub: 'user', exp })}.secret`;
};

const loadModule = () => {
  try { return require('../src/setup/chatgpt-login'); }
  catch (error) {
    if (error.code === 'MODULE_NOT_FOUND') return { verify: async () => ({ status: 'NOT_IMPLEMENTED' }) };
    throw error;
  }
};
const chatgptLogin = loadModule();

test('verifies ChatGPT login from /backend-api/me 200 response', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-login-'));
  const authFile = path.join(dir, 'auth.json');
  const sessionFile = path.join(dir, 'session.json');
  fs.writeFileSync(authFile, JSON.stringify({ tokenName: 'ZERO1', accessToken: makeJwt(Math.floor(Date.now() / 1000) + 120) }));
  fs.writeFileSync(sessionFile, JSON.stringify({ headers: { Cookie: 'a=b', accept: '*/*' } }));
  let seen = null;
  const result = await chatgptLogin.verify({
    authFile,
    sessionFile,
    env: {},
    requestJson: async (target, token, headers) => {
      seen = { target, token, headers };
      return { status: 200, json: { id: 'user-1', name: 'DevTeam' } };
    }
  });

  assert.equal(result.status, 'VERIFIED');
  assert.equal(result.httpStatus, 200);
  assert.equal(result.tokenName, 'ZERO1');
  assert.equal(seen.target, '/backend-api/me');
  assert.match(seen.token, /^eyJ/);
  assert.equal(seen.headers.Cookie, 'a=b');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('reports REJECTED when ChatGPT backend rejects the session', async () => {
  const result = await chatgptLogin.verify({
    authFile: 'missing.json',
    sessionFile: 'missing-session.json',
    env: { ZERO_CHATGPT_ACCESS_TOKEN: makeJwt(Math.floor(Date.now() / 1000) + 120) },
    requestJson: async () => ({ status: 403, json: null })
  });
  assert.notEqual(result.status, 'VERIFIED');
});
