const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cli = require('../src/cli');

const makeJwt = (exp) => {
  const enc = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${enc({ alg: 'none' })}.${enc({ exp })}.secret`;
};

const setup = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-limit-'));
  const sessionFile = path.join(dir, 'session.json');
  fs.writeFileSync(sessionFile, JSON.stringify({ headers: { Cookie: 'a=b' } }));
  return {
    dir,
    env: { ZERO_CHATGPT_ACCESS_TOKEN: makeJwt(Math.floor(Date.now() / 1000) + 120), ZERO_CHATGPT_SESSION_FILE: sessionFile },
    output: { text: '', write(value) { this.text += value; } }
  };
};

const msg = (role, text) => ({ author: { role }, content: { content_type: 'text', parts: [text] } });
const fixture = () => ({
  conversation_id: 'conv-1',
  title: 'Limit Test',
  current_node: 'node-4',
  messages: [
    msg('system', 'before'),
    msg('user', 'user one'), msg('assistant', 'answer one'),
    msg('user', 'user two'), msg('assistant', 'answer two'),
    msg('assistant', 'answer two extra'),
    msg('user', 'user three'), msg('assistant', 'answer three'),
    msg('tool', 'tool three'), msg('system', 'system three'),
    msg('user', 'user four'), msg('assistant', 'answer four')
  ]
});

test('limit N shows the latest N USER groups and fetches detail once', async () => {
  const ctx = setup();
  let calls = 0;
  const result = await cli.run(['chatgpt', 'conversation', 'get', 'conv-1', 'limit', '2'], ctx.env, ctx.output, {
    getConversation: async () => { calls += 1; return fixture(); }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(calls, 1);
  assert.doesNotMatch(ctx.output.text, /user two/);
  assert.match(ctx.output.text, /\[#3\] USER\s+user three/);
  assert.match(ctx.output.text, /answer three/);
  assert.match(ctx.output.text, /\[#4\] USER\s+user four/);
  assert.match(ctx.output.text, /answer four/);
  fs.rmSync(ctx.dir, { recursive: true, force: true });
});

test('limit A-B shows USER groups A through B from the start', async () => {
  const ctx = setup();
  let calls = 0;
  const result = await cli.run(['chatgpt', 'conversation', 'get', 'conv-1', 'limit', '2-3'], ctx.env, ctx.output, {
    getConversation: async () => { calls += 1; return fixture(); }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(calls, 1);
  assert.doesNotMatch(ctx.output.text, /user one/);
  assert.match(ctx.output.text, /\[#2\] USER\s+user two/);
  assert.match(ctx.output.text, /answer two extra/);
  assert.match(ctx.output.text, /\[#3\] USER\s+user three/);
  assert.doesNotMatch(ctx.output.text, /user four/);
  fs.rmSync(ctx.dir, { recursive: true, force: true });
});

test('limit hides non USER ASSISTANT roles by default', async () => {
  const ctx = setup();
  let calls = 0;
  const result = await cli.run(['chatgpt', 'conversation', 'get', 'conv-1', 'limit', '2'], ctx.env, ctx.output, {
    getConversation: async () => { calls += 1; return fixture(); }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(calls, 1);
  assert.doesNotMatch(ctx.output.text, /TOOL/);
  assert.doesNotMatch(ctx.output.text, /tool three/);
  assert.doesNotMatch(ctx.output.text, /SYSTEM/);
  assert.doesNotMatch(ctx.output.text, /system three/);
  fs.rmSync(ctx.dir, { recursive: true, force: true });
});

test('limit debug shows all roles in selected USER groups', async () => {
  const ctx = setup();
  let calls = 0;
  const result = await cli.run(['chatgpt', 'conversation', 'get', 'conv-1', 'limit', '2', 'debug'], ctx.env, ctx.output, {
    getConversation: async () => { calls += 1; return fixture(); }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(calls, 1);
  assert.match(ctx.output.text, /TOOL\s+tool three/);
  assert.match(ctx.output.text, /SYSTEM\s+system three/);
  assert.match(ctx.output.text, /\[#3\] USER\s+user three/);
  assert.match(ctx.output.text, /\[#4\] USER\s+user four/);
  fs.rmSync(ctx.dir, { recursive: true, force: true });
});

const stateMsg = (id, parentId, role, text) => ({
  id,
  author: { role },
  content: { content_type: 'text', parts: [text] }
});

const stateFixture = () => ({
  conversation_id: 'conv-state',
  title: 'State Test',
  current_node: 'a4',
  messages: [
    stateMsg('u1', 'root', 'user', 'user one'), stateMsg('a1', 'u1', 'assistant', 'answer one'),
    stateMsg('u2', 'a1', 'user', 'user two'), stateMsg('a2', 'u2', 'assistant', 'answer two'),
    stateMsg('u3', 'a2', 'user', 'user three'), stateMsg('a3', 'u3', 'assistant', 'answer three'),
    stateMsg('u4', 'a3', 'user', 'user four'), stateMsg('a4', 'u4', 'assistant', 'answer four')
  ]
});

test('limit state targets the last displayed message and its editable USER', async () => {
  const ctx = setup();
  const result = await cli.run(['chatgpt', 'conversation', 'get', 'conv-state', 'limit', '2-3'], ctx.env, ctx.output, {
    getConversation: async () => stateFixture()
  });
  assert.equal(result.exitCode, 0);
  assert.match(ctx.output.text, /message_id=a3\nparent_id=u3\ncurrent_node=a4\nnext_parent_message_id=a3/);
  assert.match(ctx.output.text, /edit_message_id=u3\nedit_parent_id=a2/);
  assert.equal((ctx.output.text.match(/^message_id=/gm) || []).length, 1);
  fs.rmSync(ctx.dir, { recursive: true, force: true });
});
