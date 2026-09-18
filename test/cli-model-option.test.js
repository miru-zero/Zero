const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cli = require('../src/cli');

const makeJwt = (exp) => {
  const enc = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
  return `${enc({ alg: 'none' })}.${enc({ exp })}.x`;
};
const setup = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-cli-model-'));
  const sessionFile = path.join(dir, 'session.json');
  fs.writeFileSync(sessionFile, JSON.stringify({ headers: { Cookie: 'a=b' } }));
  const env = {
    ZERO_CHATGPT_ACCESS_TOKEN: makeJwt(Math.floor(Date.now() / 1000) + 120),
    ZERO_CHATGPT_SESSION_FILE: sessionFile
  };
  const output = { text: '', write(v) { this.text += v; } };
  return { dir, env, output, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
};

test('CLI conversation new model <slug>: ส่ง model ต่อให้ createConversation', async () => {
  const ctx = setup();
  let received = null;
  const result = await cli.run(['chatgpt', 'conversation', 'new', 'hello', 'model', 'gpt-5-thinking'], ctx.env, ctx.output, {
    createConversation: async (x) => { received = x; return { conversation_id: 'c1', current_node: 'n1' }; }
  });
  assert.equal(result.exitCode, 0);
  assert.equal(received.message, 'hello');
  assert.equal(received.model, 'gpt-5-thinking');
  assert.match(ctx.output.text, /model=gpt-5-thinking/);
  ctx.cleanup();
});

test('CLI conversation new ไม่ใส่ model: model เป็น undefined ให้ชั้นล่าง default gpt-5-6-thinking + extended', async () => {
  const ctx = setup();
  let received = null;
  const result = await cli.run(['chatgpt', 'conversation', 'new', 'hello'], ctx.env, ctx.output, {
    createConversation: async (x) => { received = x; return { conversation_id: 'c1' }; }
  });
  assert.equal(result.exitCode, 0);
  assert.equal(received.model, undefined);
  assert.doesNotMatch(ctx.output.text, /model=/);
  ctx.cleanup();
});

test('CLI conversation send model <slug>: ส่ง model ต่อให้ sendConversation', async () => {
  const ctx = setup();
  let received = null;
  const result = await cli.run(['chatgpt', 'conversation', 'send', 'c1', 'follow up', 'model', 'gpt-5'], ctx.env, ctx.output, {
    sendConversation: async (x) => { received = x; return { conversation_id: 'c1' }; }
  });
  assert.equal(result.exitCode, 0);
  assert.equal(received.conversationId, 'c1');
  assert.equal(received.message, 'follow up');
  assert.equal(received.model, 'gpt-5');
  assert.match(ctx.output.text, /model=gpt-5/);
  ctx.cleanup();
});

test('CLI project conversation new model <slug>: ส่ง model ต่อพร้อม projectId', async () => {
  const ctx = setup();
  let received = null;
  const result = await cli.run(['chatgpt', 'project', 'conversation', 'new', 'g-p-1', 'hello', 'model', 'gpt-5'], ctx.env, ctx.output, {
    createConversation: async (x) => { received = x; return { conversation_id: 'c1' }; }
  });
  assert.equal(result.exitCode, 0);
  assert.equal(received.projectId, 'g-p-1');
  assert.equal(received.model, 'gpt-5');
  ctx.cleanup();
});

test('CLI conversation new model ไม่ใส่ slug: เด้ง usage', async () => {
  const ctx = setup();
  const result = await cli.run(['chatgpt', 'conversation', 'new', 'hello', 'model'], ctx.env, ctx.output, {
    createConversation: async () => { throw new Error('must not be called'); }
  });
  assert.equal(result.exitCode, 64);
  assert.match(ctx.output.text, /\[model <slug>\]/);
  ctx.cleanup();
});

test('CLI usage: แสดง [model <slug>] ในทั้ง new/send/project conversation new', async () => {
  const ctx = setup();
  const result = await cli.run(['chatgpt', 'conversation', 'new'], ctx.env, ctx.output, {});
  assert.equal(result.exitCode, 64);
  assert.match(ctx.output.text, /zero chatgpt conversation new <message> \[model <slug>\]/);
  assert.match(ctx.output.text, /zero chatgpt conversation send <conversation_id> <message> \[model <slug>\]/);
  assert.match(ctx.output.text, /zero chatgpt project conversation new <project_id> <message> \[model <slug>\]/);
  ctx.cleanup();
});
