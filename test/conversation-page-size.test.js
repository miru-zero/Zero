const test = require('node:test');
const assert = require('node:assert/strict');
const conversations = require('../src/providers/chatgpt/conversations');

test('project conversations use proven page size 50', async () => {
  let seenTarget = null;
  await conversations.listProjectConversations({
    projectId: 'g-p-1',
    token: 'token-1',
    sessionHeaders: { Cookie: 'a=b' },
    requestJson: async (target) => {
      seenTarget = target;
      return { status: 200, json: { items: [], cursor: null } };
    }
  });

  assert.match(seenTarget, /[?&]limit=50(?:&|$)/);
});
