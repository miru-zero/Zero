const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cli = require('../src/cli');
const conversations = require('../src/providers/chatgpt/conversations');

const makeJwt = (exp) => {
  const enc = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${enc({ alg: 'none' })}.${enc({ exp })}.secret`;
};

const setup = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-project-list-'));
  const sessionFile = path.join(dir, 'session.json');
  fs.writeFileSync(sessionFile, JSON.stringify({ headers: { Cookie: 'a=b' } }));
  return {
    dir,
    env: { ZERO_CHATGPT_ACCESS_TOKEN: makeJwt(Math.floor(Date.now() / 1000) + 120), ZERO_CHATGPT_SESSION_FILE: sessionFile },
    output: { text: '', write(value) { this.text += value; } }
  };
};
test('project conversation page fetches exactly one cursor page', async () => {
  const seen = [];
  const page = await conversations.listProjectConversationPage({
    projectId: 'g-p-1', token: 'token', sessionHeaders: {},
    requestJson: async (target, token, headers, options) => {
      seen.push({ target, options });
      return { status: 200, json: { items: [{ id: 'c1', title: 'Chat 1' }], cursor: 'next-1' } };
    }
  });

  assert.equal(seen.length, 1);
  assert.match(seen[0].target, /gizmos\/g-p-1\/conversations/);
  assert.match(seen[0].target, /cursor=0/);
  assert.equal(seen[0].options.route, '/backend-api/gizmos/{gizmo_id}/conversations');
  assert.deepEqual(page.items.map((item) => item.id), ['c1']);
  assert.equal(page.nextCursor, 'next-1');
});
test('zero project conversations prints one project page', async () => {
  const ctx = setup();
  let calls = 0;
  const result = await cli.run(['chatgpt', 'project', 'conversations', 'g-p-1'], ctx.env, ctx.output, {
    listProjectConversationPage: async ({ projectId }) => {
      calls += 1;
      assert.equal(projectId, 'g-p-1');
      return { items: [{ id: 'c1', title: 'Chat 1' }, { id: 'c2', title: 'Chat 2' }], nextCursor: 'next-1' };
    }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(calls, 1);
  assert.match(ctx.output.text, /Project ID: g-p-1/);
  assert.match(ctx.output.text, /Chat 1/);
  assert.match(ctx.output.text, /Chat 2/);
  assert.match(ctx.output.text, /Next cursor: next-1/);
  fs.rmSync(ctx.dir, { recursive: true, force: true });
});
