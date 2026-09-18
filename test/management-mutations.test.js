const test = require('node:test');
const assert = require('node:assert/strict');
const conversations = require('../src/providers/chatgpt/conversations');

const ok = (json = { success: true }) => ({ status: 200, json });

test('conversation rename delete and move use proven PATCH contract', async () => {
  const calls = [];
  const requestJson = async (target, token, headers, options) => { calls.push({ target, options }); return ok(); };
  const common = { token: 't', sessionHeaders: {}, requestJson };
  await conversations.renameConversation({ ...common, conversationId: 'c1', title: 'Renamed' });
  await conversations.deleteConversation({ ...common, conversationId: 'c1' });
  await conversations.moveConversation({ ...common, conversationId: 'c1', projectId: 'g-p-1' });
  await conversations.moveConversation({ ...common, conversationId: 'c1', projectId: null });
  assert.deepEqual(calls.map(x => [x.target, x.options.method, x.options.body]), [
    ['/backend-api/conversation/c1', 'PATCH', { title: 'Renamed' }],
    ['/backend-api/conversation/c1', 'PATCH', { is_visible: false }],
    ['/backend-api/conversation/c1', 'PATCH', { gizmo_id: 'g-p-1' }],
    ['/backend-api/conversation/c1', 'PATCH', { gizmo_id: null }]
  ]);
});

test('project create rename delete use proven contracts', async () => {
  const calls = [];
  const requestJson = async (target, token, headers, options = {}) => {
    calls.push({ target, options });
    if (options.method === 'GET' || !options.method) return ok({ gizmo: { id: 'g-p-1', instructions: 'keep', display: { name: 'Old', emoji: 'x', theme: 'dark' } } });
    if (target === '/backend-api/projects') return ok({ id: 'g-p-new', name: 'New' });
    return ok();
  };
  const common = { token: 't', sessionHeaders: {}, requestJson };
  await conversations.createProject({ ...common, name: 'New' });
  await conversations.renameProject({ ...common, projectId: 'g-p-1', name: 'Renamed' });
  await conversations.deleteProject({ ...common, projectId: 'g-p-1' });
  assert.deepEqual(calls[0], { target: '/backend-api/projects', options: { method: 'POST', body: { name: 'New', instructions: '', memory_scope: 'project_v2' }, route: '/backend-api/projects' } });
  assert.equal(calls[1].target, '/backend-api/gizmos/g-p-1');
  assert.deepEqual(calls[2].options.body, { name: 'Renamed', instructions: 'keep', emoji: 'x', theme: 'dark' });
  assert.equal(calls[2].target, '/backend-api/projects/g-p-1');
  assert.equal(calls[2].options.method, 'PATCH');
  assert.equal(calls[3].target, '/backend-api/gizmos/g-p-1');
  assert.equal(calls[3].options.method, 'DELETE');
});
