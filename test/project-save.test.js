const test = require('node:test');
const assert = require('node:assert/strict');
const conversations = require('../src/providers/chatgpt/conversations');
const chatgptProvider = require('../src/providers/chatgpt');
const cli = require('../src/cli');

const makeJwt = () => {
  const enc = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${enc({ alg: 'none' })}.${enc({ exp: Math.floor(Date.now() / 1000) + 600 })}.x`;
};

const capture = () => {
  let text = '';
  return { output: { write(value) { text += value; return true; } }, text: () => text };
};

test('saveProjectMessage uses POST /projects/{project_id}/saves contract', async () => {
  assert.equal(typeof conversations.saveProjectMessage, 'function');
  let seen;
  const result = await conversations.saveProjectMessage({
    projectId: 'g-p-1', conversationId: 'c1', messageId: 'm1', token: 't', sessionHeaders: {},
    requestJson: async (target, token, headers, options) => {
      seen = { target, options };
      return { status: 200, json: { success: true } };
    }
  });
  assert.equal(seen.target, '/backend-api/projects/g-p-1/saves');
  assert.equal(seen.options.method, 'POST');
  assert.deepEqual(seen.options.body, { conversation_id: 'c1', message_id: 'm1' });
  assert.equal(seen.options.route, '/backend-api/projects/{project_id}/saves');
  assert.equal(seen.options.retry, false);
  assert.deepEqual(result, { success: true });
});

test('chatgpt provider exposes project_save and forwards args', async () => {
  const original = conversations.saveProjectMessage;
  let seen;
  conversations.saveProjectMessage = async (args) => { seen = args; return { saved: true }; };
  try {
    const names = chatgptProvider.listTools().map((tool) => tool.name);
    assert.ok(names.includes('project_save'));
    const result = await chatgptProvider.callTool('project_save', {
      project_id: 'g-p-1', conversation_id: 'c1', message_id: 'm1'
    }, { token: 't', sessionHeaders: { Cookie: 'x=y' } });
    assert.equal(seen.projectId, 'g-p-1');
    assert.equal(seen.conversationId, 'c1');
    assert.equal(seen.messageId, 'm1');
    assert.deepEqual(result, { saved: true });
  } finally {
    conversations.saveProjectMessage = original;
  }
});

test('CLI dispatches chatgpt project save through provider implementation', async () => {
  const io = capture();
  let seen;
  const result = await cli.run([
    'chatgpt', 'project', 'save', 'g-p-1', 'c1', 'm1'
  ], {
    ZERO_JOURNAL: 'off',
    ZERO_CHATGPT_ACCESS_TOKEN: makeJwt(),
    ZERO_CHATGPT_SESSION_FILE: 'unused.json'
  }, io.output, {
    loadSession: () => ({ status: 'READY', headers: {} }),
    saveProjectMessage: async (args) => { seen = args; return { success: true }; }
  });
  assert.equal(result.exitCode, 0);
  assert.equal(seen.projectId, 'g-p-1');
  assert.equal(seen.conversationId, 'c1');
  assert.equal(seen.messageId, 'm1');
  assert.match(io.text(), /project_id=g-p-1/);
  assert.match(io.text(), /conversation_id=c1/);
  assert.match(io.text(), /message_id=m1/);
});
