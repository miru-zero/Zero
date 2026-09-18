const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const authLoader = require('../src/core/auth-loader');

test('prefers ZERO_CHATGPT_ACCESS_TOKEN from environment', () => {
  const result = authLoader.loadAccessToken({ ZERO_CHATGPT_ACCESS_TOKEN: 'abc.def.ghi' }, 'missing.json');
  assert.equal(result.token, 'abc.def.ghi');
  assert.equal(result.source, 'env');
});

test('loads accessToken and tokenName from auth-context.json', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-auth-'));
  const file = path.join(dir, 'auth-context.json');
  fs.writeFileSync(file, JSON.stringify({ tokenName: 'ZERO1', accessToken: 'file.token.value' }));
  const result = authLoader.loadAccessToken({}, file);
  assert.equal(result.token, 'file.token.value');
  assert.equal(result.tokenName, 'ZERO1');
  assert.equal(result.source, 'file');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('returns none when no accessToken source exists', () => {
  const result = authLoader.loadAccessToken({}, path.join(os.tmpdir(), 'definitely-missing-zero-auth.json'));
  assert.equal(result.token, null);
  assert.equal(result.source, 'none');
});