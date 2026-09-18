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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-cli-init-'));
  const sessionFile = path.join(dir, 'session.json');
  fs.writeFileSync(sessionFile, JSON.stringify({ headers: { Cookie: 'a=b' } }));
  const env = {
    ZERO_CHATGPT_ACCESS_TOKEN: makeJwt(Math.floor(Date.now() / 1000) + 120),
    ZERO_CHATGPT_SESSION_FILE: sessionFile
  };
  const output = { text: '', write(v) { this.text += v; } };
  return { dir, env, output, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
};

test('CLI conversation init: เรียก initConversation แล้วพิมพ์ default model + limits', async () => {
  const ctx = setup();
  let received = null;
  const result = await cli.run(['chatgpt', 'conversation', 'init', 'c-1'], ctx.env, ctx.output, {
    initConversation: async (x) => {
      received = x;
      return {
        type: 'conversation_detail_metadata',
        default_model_slug: 'gpt-5-6-thinking',
        intended_default_model_slug: 'gpt-5-6-thinking',
        limits_progress: [
          { feature_name: 'deep_research', remaining: 3, reset_after: '2026-09-16T00:00:00Z' }
        ]
      };
    }
  });
  assert.equal(result.exitCode, 0);
  assert.equal(received.conversationId, 'c-1');
  assert.match(ctx.output.text, /status=OK/);
  assert.match(ctx.output.text, /default_model_slug=gpt-5-6-thinking/);
  assert.match(ctx.output.text, /limits=1/);
  assert.match(ctx.output.text, /deep_research remaining=3/);
  ctx.cleanup();
});

test('CLI conversation init ไม่มี limits: พิมพ์ limits=0', async () => {
  const ctx = setup();
  const result = await cli.run(['chatgpt', 'conversation', 'init', 'c-2'], ctx.env, ctx.output, {
    initConversation: async () => ({ default_model_slug: 'auto' })
  });
  assert.equal(result.exitCode, 0);
  assert.match(ctx.output.text, /default_model_slug=auto/);
  assert.match(ctx.output.text, /limits=0/);
  ctx.cleanup();
});

test('CLI conversation init ไม่ใส่ id: เด้ง usage', async () => {
  const ctx = setup();
  const result = await cli.run(['chatgpt', 'conversation', 'init'], ctx.env, ctx.output, {
    initConversation: async () => { throw new Error('must not be called'); }
  });
  assert.equal(result.exitCode, 64);
  assert.match(ctx.output.text, /zero chatgpt conversation init <conversation_id>/);
  ctx.cleanup();
});

test('CLI conversation new: แสดง init=OK + default_model_slug เมื่อ init สำเร็จ', async () => {
  const ctx = setup();
  const result = await cli.run(['chatgpt', 'conversation', 'new', 'hello'], ctx.env, ctx.output, {
    createConversation: async () => ({
      conversation_id: 'c1',
      current_node: 'n1',
      init: { default_model_slug: 'gpt-5-6-thinking' }
    })
  });
  assert.equal(result.exitCode, 0);
  assert.match(ctx.output.text, /init=OK/);
  assert.match(ctx.output.text, /default_model_slug=gpt-5-6-thinking/);
  ctx.cleanup();
});

test('CLI conversation new: init พังแล้วห้องยังสำเร็จ พิมพ์ init=FAILED', async () => {
  const ctx = setup();
  const result = await cli.run(['chatgpt', 'conversation', 'new', 'hello'], ctx.env, ctx.output, {
    createConversation: async () => ({
      conversation_id: 'c1',
      init_error: 'ChatGPT request failed (429): /backend-api/conversation/init'
    })
  });
  assert.equal(result.exitCode, 0);
  assert.match(ctx.output.text, /status=OK/);
  assert.match(ctx.output.text, /init=FAILED/);
  assert.doesNotMatch(ctx.output.text, /init=OK/);
  ctx.cleanup();
});

test('CLI conversation new: ไม่มี init กลับมา (ของเก่า) ไม่พิมพ์บรรทัด init', async () => {
  const ctx = setup();
  const result = await cli.run(['chatgpt', 'conversation', 'new', 'hello'], ctx.env, ctx.output, {
    createConversation: async () => ({ conversation_id: 'c1' })
  });
  assert.equal(result.exitCode, 0);
  assert.doesNotMatch(ctx.output.text, /init=/);
  ctx.cleanup();
});
