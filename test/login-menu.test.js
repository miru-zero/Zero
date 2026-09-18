const test = require('node:test');
const assert = require('node:assert/strict');

const loadLoginMenu = () => {
  try {
    return require('../src/setup/login-menu');
  } catch (error) {
    if (error.code === 'MODULE_NOT_FOUND') {
      return { buildMenuText: () => 'NOT_IMPLEMENTED' };
    }
    throw error;
  }
};

const loginMenu = loadLoginMenu();

test('login menu shows the next authenticated actions', () => {
  const text = loginMenu.buildMenuText(false, 'ZERO1');
  assert.match(text, /Login Menu/);
  assert.match(text, /ZERO1/);
  assert.match(text, /1\. Login ChatGPT/);
  assert.match(text, /2\. Token Status/);
  assert.match(text, /3\. Replace Access Token/);
  assert.match(text, /0\. Exit/);
});