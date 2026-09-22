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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-stream-recovery-'));
  const sessionFile = path.join(dir, 'session.json');
  fs.writeFileSync(sessionFile, JSON.stringify({ headers: { Cookie: 'a=b' } }));
  return {
    dir,
    env: {
      ZERO_CHATGPT_ACCESS_TOKEN: makeJwt(Math.floor(Date.now() / 1000) + 120),
      ZERO_CHATGPT_SESSION_FILE: sessionFile
    },
    output: { text: '', write(value) { this.text += value; } }
  };
};

test('CLI conversation stream-status reads stream lifecycle without JSON quoting', async () => {
  const ctx = setup();
  let seen;
  const result = await cli.run(['chatgpt', 'conversation', 'stream-status', 'conv-1'], ctx.env, ctx.output, {
    getConversationStreamStatus: async (args) => { seen = args; return { status: 'COMPLETE' }; }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(seen.conversationId, 'conv-1');
  assert.match(ctx.output.text, /status=COMPLETE/);
  assert.match(ctx.output.text, /conversation_id=conv-1/);
  fs.rmSync(ctx.dir, { recursive: true, force: true });
});

test('CLI conversation resume resumes the existing completion stream without JSON quoting', async () => {
  const ctx = setup();
  let seen;
  const result = await cli.run(['chatgpt', 'conversation', 'resume', 'conv-1'], ctx.env, ctx.output, {
    resumeConversation: async (args) => {
      seen = args;
      return { conversation_id: 'conv-1', status: 200, content_type: 'text/event-stream', text: 'data: [DONE]\n\n' };
    }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(seen.conversationId, 'conv-1');
  assert.match(ctx.output.text, /status=OK/);
  assert.match(ctx.output.text, /conversation_id=conv-1/);
  assert.match(ctx.output.text, /http_status=200/);
  assert.match(ctx.output.text, /content_type=text\/event-stream/);
  fs.rmSync(ctx.dir, { recursive: true, force: true });
});
