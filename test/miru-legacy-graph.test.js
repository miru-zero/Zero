const test = require('node:test');
const assert = require('node:assert/strict');

const miru = require('../src/miru/miru-legacy-graph');

test('Miru route parser uses only the conversation id after /c/', () => {
  assert.equal(
    miru.parseConversationIdFromPath('/c/6aa518e9-14c8-83ec-b502-0f25a5f9f9af'),
    '6aa518e9-14c8-83ec-b502-0f25a5f9f9af'
  );
  assert.equal(
    miru.parseConversationIdFromPath('/g/g-p-project/c/6aa42a02-dcec-83ec-8b6b-1e30f89b59a5'),
    '6aa42a02-dcec-83ec-8b6b-1e30f89b59a5'
  );
});

test('Miru pin follows URL only while logic is off', () => {
  assert.equal(miru.nextPinnedConversationId({ logicToggle: 'off', routeConversationId: 'B', pinnedConversationId: 'A' }), 'B');
  assert.equal(miru.nextPinnedConversationId({ logicToggle: 'on', routeConversationId: 'B', pinnedConversationId: 'A' }), 'A');
  assert.equal(miru.nextPinnedConversationId({ logicToggle: 'on', routeConversationId: 'A', pinnedConversationId: null }), 'A');
});

const messageNode = (id, role, time, parent, children = []) => ({
  id,
  parent,
  children,
  message: {
    id,
    author: { role },
    create_time: time,
    content: { parts: [id] },
    metadata: {}
  }
});

const legacyFixture = () => ({
  current_node: 'u4',
  mapping: {
    'client-created-root': { id: 'client-created-root', message: null, parent: null, children: ['s0'] },
    s0: messageNode('s0', 'system', 0, 'client-created-root', ['u0']),
    u0: messageNode('u0', 'user', 1, 's0', ['a0']),
    a0: messageNode('a0', 'assistant', 2, 'u0', ['u1']),
    u1: messageNode('u1', 'user', 3, 'a0', ['a1']),
    a1: messageNode('a1', 'assistant', 4, 'u1', ['u2']),
    u2: messageNode('u2', 'user', 5, 'a1', ['u3']),
    u3: messageNode('u3', 'user', 6, 'u2', ['u4']),
    u4: messageNode('u4', 'user', 7, 'u3', [])
  }
});

test('legacy cleaner grafts tail and preserves a valid user current_node', async () => {
  const session = legacyFixture();
  const cleaned = await miru.cleanChainLastFromJSON(session, 3);
  const users = Object.values(cleaned.mapping)
    .filter((node) => node?.message?.author?.role === 'user')
    .map((node) => node.id);

  assert.deepEqual(users, ['u0', 'u2', 'u3', 'u4']);
  assert.equal(cleaned.current_node, 'u4');
  assert.equal(cleaned.mapping.u4.message.author.role, 'user');
  assert.deepEqual(cleaned.mapping.s0.children, ['u2']);
  assert.equal(cleaned.mapping.u2.parent, 's0');
  assert.deepEqual(cleaned.mapping['client-created-root'].children, ['s0', 'u0']);
  assert.equal(cleaned.mapping.u0.parent, 'client-created-root');
  assert.deepEqual(session.mapping.s0.children, ['u2']);
});
