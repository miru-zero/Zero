const test = require('node:test');
const assert = require('node:assert/strict');
const conversations = require('../src/providers/chatgpt/conversations');

const response = (json) => ({ status: 200, json });

test('listAll fetches one global page and groups by project id', async () => {
  const seen = [];
  const requestJson = async (target, token, headers, options = {}) => {
    seen.push({ target, token, headers, options });

    if (target.includes('/backend-api/conversations?offset=0')) {
      return response({
        items: [
          { id: 'outside-1', title: 'Outside 1' },
          { id: 'project-1', title: 'Project 1', gizmo_id: 'g-p-1' }
        ],
        total: 51,
        limit: 50,
        offset: 0
      });
    }
    if (target.includes('/backend-api/conversations?offset=50')) {
      return response({ items: [{ id: 'outside-2', title: 'Outside 2' }], total: 51, limit: 50, offset: 50 });
    }
    if (target.includes('/backend-api/gizmos/snorlax/sidebar') && !target.includes('cursor=next-project')) {
      return response({
        items: [{ gizmo: { gizmo: { id: 'g-p-1', display: { name: 'Project One' } } } }],
        cursor: 'next-project'
      });
    }
    if (target.includes('/backend-api/gizmos/snorlax/sidebar') && target.includes('cursor=next-project')) {
      return response({
        items: [{ gizmo: { gizmo: { id: 'g-p-2', display: { name: 'Project Two' } } } }],
        cursor: null
      });
    }
    throw new Error(`unexpected target ${target}`);
  };

  const result = await conversations.listAll({
    token: 'token-1',
    sessionHeaders: { Cookie: 'a=b' },
    requestJson
  });

  assert.deepEqual(result.outside.map((item) => item.id), ['outside-1']);
  assert.deepEqual(result.projects[0].conversations.map((item) => item.id), ['project-1']);
  assert.deepEqual(result.projects[1].conversations, []);
  assert.equal(result.returned, 2);
  assert.equal(result.total, 51);
  assert.equal(result.nextOffset, 50);
  assert.ok(seen.some((entry) => entry.target.includes('limit=50')));
  assert.ok(!seen.some((entry) => entry.target.includes('/backend-api/conversations?offset=50')));
  assert.ok(!seen.some((entry) => entry.target.includes('/backend-api/gizmos/g-p-1/conversations')));
});


test('listConnectors closes its catalog connection before conversation creation', async () => {
  let seenOptions = null;
  const requestJson = async (target, token, headers, options = {}) => {
    seenOptions = options;
    return response({ plugins: [] });
  };

  const result = await conversations.listConnectors({
    token: 'token-1',
    sessionHeaders: { Cookie: 'a=b' },
    requestJson
  });

  assert.deepEqual(result, []);
  assert.equal(seenOptions.route, '/backend-api/ps/plugins/installed');
  assert.equal(seenOptions.headers?.connection, 'close');
});
