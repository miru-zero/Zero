const test = require('node:test');
const assert = require('node:assert/strict');
const conversations = require('../src/providers/chatgpt/conversations');

const response = (json) => ({ status: 200, json });

test('listAll groups global conversations by project without refetching projects', async () => {
  const seen = [];
  const events = [];
  const requestJson = async (target) => {
    seen.push(target);
    if (target.includes('/backend-api/conversations?')) {
      return response({
        items: [
          { id: 'outside-1', title: 'Outside' },
          { id: 'project-1', title: 'Project Chat', gizmo_id: 'g-p-1' }
        ],
        total: 2,
        limit: 50,
        offset: 0
      });
    }
    if (target.includes('/backend-api/gizmos/snorlax/sidebar')) {
      return response({
        items: [{ gizmo: { gizmo: { id: 'g-p-1', display: { name: 'Project One' } } } }],
        cursor: null
      });
    }
    if (target.includes('/backend-api/gizmos/g-p-')) {
      throw new Error(`unexpected project refetch ${target}`);
    }
    throw new Error(`unexpected target ${target}`);
  };

  const result = await conversations.listAll({
    token: 'token-1',
    sessionHeaders: { Cookie: 'a=b' },
    requestJson,
    onProgress: (event) => events.push(event)
  });

  assert.deepEqual(result.outside.map((item) => item.id), ['outside-1']);
  assert.deepEqual(result.projects[0].conversations.map((item) => item.id), ['project-1']);
  assert.ok(seen.some((target) => /[?&]limit=50(?:&|$)/.test(target)));
  assert.ok(!seen.some((target) => target.includes('/backend-api/gizmos/g-p-1/conversations')));
  assert.ok(events.some((event) => event.type === 'conversation-page' && event.count === 2));
});

test('listAll fetches only one conversation page by default', async () => {
  let conversationCalls = 0;
  const requestJson = async (target) => {
    if (target.includes('/backend-api/conversations?')) {
      conversationCalls += 1;
      if (conversationCalls > 1) throw new Error(`unexpected extra page ${target}`);
      return response({ items: [{ id: 'a' }], total: 51, limit: 50, offset: 0 });
    }
    if (target.includes('/backend-api/gizmos/snorlax/sidebar')) {
      return response({ items: [], cursor: null });
    }
    throw new Error(`unexpected target ${target}`);
  };

  const result = await conversations.listAll({
    token: 'token-1',
    sessionHeaders: { Cookie: 'a=b' },
    requestJson
  });

  assert.equal(conversationCalls, 1);
  assert.equal(result.returned, 1);
  assert.equal(result.total, 51);
  assert.equal(result.nextOffset, 50);
});
