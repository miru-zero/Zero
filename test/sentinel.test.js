const test = require('node:test');
const assert = require('node:assert/strict');
const sentinel = require('../src/providers/chatgpt/sentinel');

test('requirements token has current legacy prefix and browser config', () => {
  const token = sentinel.buildRequirementsToken('UA-Test', ['https://chatgpt.com/backend-api/sentinel/sdk.js'], '');
  assert.match(token, /^gAAAAAC/);
  const config = JSON.parse(Buffer.from(token.slice(7), 'base64').toString('utf8'));
  assert.equal(config[4], 'UA-Test');
  assert.equal(config[5], 'https://chatgpt.com/backend-api/sentinel/sdk.js');
});

test('proof token solves an easy server challenge', () => {
  const token = sentinel.buildProofToken('seed', 'ff', 'UA-Test', ['https://chatgpt.com/backend-api/sentinel/sdk.js'], '');
  assert.match(token, /^gAAAAAB/);
});
