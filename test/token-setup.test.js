const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const loadTokenSetup = () => {
  try {
    return require('../src/setup/token-setup');
  } catch (error) {
    if (error.code === 'MODULE_NOT_FOUND') {
      return {
        buildSetupText: () => 'NOT_IMPLEMENTED',
        saveAccessToken: () => ({ saved: false })
      };
    }
    throw error;
  }
};

const tokenSetup = loadTokenSetup();

test('setup text contains token instructions', () => {
  const text = tokenSetup.buildSetupText();
  assert.match(text, /Token Setup/);
  assert.match(text, /Add New Access Token/);
  assert.match(text, /https:\/\/chatgpt\.com\/api\/auth\/session/);
});

test('saveAccessToken writes runtime auth context', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-token-setup-'));
  const authFile = path.join(dir, 'runtime', 'auth-context.json');

  const result = tokenSetup.saveAccessToken(authFile, 'A', 'abc.def.ghi');
  const saved = JSON.parse(fs.readFileSync(authFile, 'utf8'));

  assert.equal(result.saved, true);
  assert.equal(saved.tokenName, 'A');
  assert.equal(saved.accessToken, 'abc.def.ghi');

  fs.rmSync(dir, { recursive: true, force: true });
});
