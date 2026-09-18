const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const authRefresh = require('../src/core/auth-refresh');

const setup = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-auth-refresh-'));
  const authFile = path.join(dir, 'auth-context.json');
  const sessionFile = path.join(dir, 'session-context.json');
  fs.writeFileSync(authFile, JSON.stringify({ tokenName: 'ZERO1', accessToken: 'old.token', updatedAt: '2026-01-01T00:00:00.000Z' }));
  fs.writeFileSync(sessionFile, JSON.stringify({
    headers: { 'user-agent': 'zero-test-agent', Cookie: '__Secure-next-auth.session-token=abc; oai-did=dev1' }
  }));
  return { dir, authFile, sessionFile };
};

const okResponse = (extra = {}) => ({
  status: 200,
  json: { accessToken: 'new.token.value', expires: '2026-09-18T00:00:00.000Z', user: { name: 'Tester' } },
  headers: {},
  ...extra
});

test('REFRESHED: เขียน token ใหม่ทับ auth file คง tokenName เดิม', async () => {
  const { authFile, sessionFile } = setup();
  const result = await authRefresh.refreshAccessToken({
    authFile,
    sessionFile,
    requestImpl: async () => okResponse(),
    nowIso: () => '2026-09-17T01:00:00.000Z'
  });
  assert.equal(result.status, 'REFRESHED');
  assert.equal(result.token, 'new.token.value');
  const saved = JSON.parse(fs.readFileSync(authFile, 'utf8'));
  assert.equal(saved.accessToken, 'new.token.value');
  assert.equal(saved.tokenName, 'ZERO1');
  assert.equal(saved.updatedAt, '2026-09-17T01:00:00.000Z');
});

test('ส่ง Cookie header จาก session-context ไปที่ session endpoint', async () => {
  const { authFile, sessionFile } = setup();
  let seen = null;
  await authRefresh.refreshAccessToken({
    authFile,
    sessionFile,
    requestImpl: async (url, headers) => { seen = { url, headers }; return okResponse(); }
  });
  assert.equal(seen.url, 'https://chatgpt.com/api/auth/session');
  assert.equal(seen.headers.Cookie, '__Secure-next-auth.session-token=abc; oai-did=dev1');
  assert.equal(seen.headers['user-agent'], 'zero-test-agent');
});

test('401/403 = SESSION_DEAD และไม่แตะ auth file', async () => {
  const { authFile, sessionFile } = setup();
  const result = await authRefresh.refreshAccessToken({
    authFile,
    sessionFile,
    requestImpl: async () => ({ status: 401, json: null, headers: {} })
  });
  assert.equal(result.status, 'SESSION_DEAD');
  assert.equal(result.httpStatus, 401);
  const saved = JSON.parse(fs.readFileSync(authFile, 'utf8'));
  assert.equal(saved.accessToken, 'old.token');
});

test('session ไม่ READY = NO_SESSION ไม่ยิง request', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-auth-refresh-'));
  const authFile = path.join(dir, 'auth-context.json');
  const missingSession = path.join(dir, 'no-session.json');
  fs.writeFileSync(authFile, '{}');
  let called = false;
  const result = await authRefresh.refreshAccessToken({
    authFile,
    sessionFile: missingSession,
    requestImpl: async () => { called = true; return okResponse(); }
  });
  assert.equal(result.status, 'NO_SESSION');
  assert.equal(called, false);
});

test('network error = ERROR และไม่แตะ auth file', async () => {
  const { authFile, sessionFile } = setup();
  const result = await authRefresh.refreshAccessToken({
    authFile,
    sessionFile,
    requestImpl: async () => { throw new Error('ECONNRESET'); }
  });
  assert.equal(result.status, 'ERROR');
  assert.equal(result.error, 'ECONNRESET');
});

test('200 แต่ไม่มี accessToken = FAILED', async () => {
  const { authFile, sessionFile } = setup();
  const result = await authRefresh.refreshAccessToken({
    authFile,
    sessionFile,
    requestImpl: async () => ({ status: 200, json: { user: {} }, headers: {} })
  });
  assert.equal(result.status, 'FAILED');
});

test('set-cookie ใหม่ถูก merge กลับ session file', async () => {
  const { authFile, sessionFile } = setup();
  const result = await authRefresh.refreshAccessToken({
    authFile,
    sessionFile,
    requestImpl: async () => okResponse({
      headers: { 'set-cookie': ['__Secure-next-auth.session-token=rotated; Path=/; HttpOnly', 'oai-did=dev1; Path=/'] }
    })
  });
  assert.equal(result.status, 'REFRESHED');
  assert.equal(result.cookieRotated, true);
  const saved = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
  assert.equal(saved.headers.Cookie, '__Secure-next-auth.session-token=rotated; oai-did=dev1');
});

test('set-cookie เหมือนเดิม = ไม่เขียน session file (cookieRotated=false)', async () => {
  const { authFile, sessionFile } = setup();
  const result = await authRefresh.refreshAccessToken({
    authFile,
    sessionFile,
    requestImpl: async () => okResponse({
      headers: { 'set-cookie': ['__Secure-next-auth.session-token=abc; Path=/'] }
    })
  });
  assert.equal(result.status, 'REFRESHED');
  assert.equal(result.cookieRotated, false);
});

test('mergeSetCookies อัปเดตค่าเดิมและเพิ่มค่าใหม่', () => {
  const merged = authRefresh.mergeSetCookies('a=1; b=2', ['b=3; Path=/', 'c=4; HttpOnly']);
  assert.equal(merged.changed, true);
  assert.equal(merged.cookie, 'a=1; b=3; c=4');
});

test('CLI: zero auth refresh เรียก refresh ที่ inject และ exit 0', async () => {
  const cli = require('../src/cli');
  const { authFile, sessionFile } = setup();
  const out = { text: '', write(s) { this.text += s; } };
  let seenOptions = null;
  const result = await cli.run(['auth', 'refresh'], {
    ZERO_CHATGPT_AUTH_FILE: authFile,
    ZERO_CHATGPT_SESSION_FILE: sessionFile
  }, out, {
    refreshAccessToken: async (options) => { seenOptions = options; return { status: 'REFRESHED', cookieRotated: false }; }
  });
  assert.equal(result.exitCode, 0);
  assert.match(out.text, /refresh=REFRESHED/);
  assert.equal(seenOptions.authFile, authFile);
  assert.equal(seenOptions.sessionFile, sessionFile);
});

test('CLI: zero auth refresh เจอ SESSION_DEAD → exit 3 พร้อมคำแนะนำ', async () => {
  const cli = require('../src/cli');
  const { authFile, sessionFile } = setup();
  const out = { text: '', write(s) { this.text += s; } };
  const result = await cli.run(['auth', 'refresh'], {
    ZERO_CHATGPT_AUTH_FILE: authFile,
    ZERO_CHATGPT_SESSION_FILE: sessionFile
  }, out, {
    refreshAccessToken: async () => ({ status: 'SESSION_DEAD', httpStatus: 401 })
  });
  assert.equal(result.exitCode, 3);
  assert.match(out.text, /refresh=SESSION_DEAD http=401/);
  assert.match(out.text, /login ใหม่/);
});
