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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-conversation-get-'));
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

test('zero conversations prints project id', async () => {
  const ctx = setup();
  const result = await cli.run(['chatgpt', 'conversations'], ctx.env, ctx.output, {
    listAll: async () => ({
      outside: [],
      projects: [{ id: 'g-p-1', name: 'Zero Project', conversations: [] }],
      total: 0
    })
  });

  assert.equal(result.exitCode, 0);
  assert.match(ctx.output.text, /Zero Project/);
  assert.match(ctx.output.text, /g-p-1/);
  fs.rmSync(ctx.dir, { recursive: true, force: true });
});

test('zero conversation get prints conversation state', async () => {
  const ctx = setup();
  let seenId = null;
  const result = await cli.run(['chatgpt', 'conversation', 'get', 'conv-1'], ctx.env, ctx.output, {
    getConversation: async ({ conversationId }) => {
      seenId = conversationId;
      return {
        conversation_id: 'conv-1',
        title: 'Conversation One',
        current_node: 'node-1',
        gizmo_id: 'g-p-1',
        messages: [{ id: 'm1' }, { id: 'm2' }]
      };
    }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(seenId, 'conv-1');
  assert.match(ctx.output.text, /Conversation One/);
  assert.match(ctx.output.text, /conversation_id=conv-1/);
  assert.match(ctx.output.text, /project_id=g-p-1/);
  assert.match(ctx.output.text, /current_node=node-1/);
  assert.match(ctx.output.text, /messages=2/);
  fs.rmSync(ctx.dir, { recursive: true, force: true });
});

test('zero conversation get prints next and edit state from current branch tip', async () => {
  const ctx = setup();
  const result = await cli.run(['chatgpt', 'conversation', 'get', 'conv-state'], ctx.env, ctx.output, {
    getConversation: async () => ({
      conversation_id: 'conv-state',
      title: 'State',
      current_node: 'a2',
      messages: [
        { id: 'u1', author: { role: 'user' }, content: { parts: ['one'] } },
        { id: 'a1', author: { role: 'assistant' }, content: { parts: ['one a'] } },
        { id: 'u2', author: { role: 'user' }, content: { parts: ['two'] } },
        { id: 'a2', author: { role: 'assistant' }, content: { parts: ['two a'] } }
      ]
    })
  });
  assert.equal(result.exitCode, 0);
  assert.match(ctx.output.text, /message_id=a2\nparent_id=u2/);
  assert.match(ctx.output.text, /next_parent_message_id=a2/);
  assert.match(ctx.output.text, /edit_message_id=u2\nedit_parent_id=a1/);
  fs.rmSync(ctx.dir, { recursive: true, force: true });
});