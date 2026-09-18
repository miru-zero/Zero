const test = require('node:test');
const assert = require('node:assert/strict');

const modern = require('../src/miru/miru-modern-conversation');

const msg = (id, role, parentId = null, parts = [id]) => ({
  id,
  author: { role },
  content: { parts },
  metadata: parentId ? { parent_id: parentId, marker: id } : { marker: id }
});

test('modern acquisition asks for two transport turns per retained user line', () => {
  assert.equal(modern.acquisitionNumTurns(5), 10);
  assert.equal(modern.acquisitionNumTurns(30), 60);
});

test('modern compact keeps tail messages without rewriting parent metadata', () => {
  const source = {
    conversation_id: 'A',
    current_node: 'a2',
    messages: [
      msg('bootstrap', 'system'),
      msg('u0', 'user'), msg('a0', 'assistant', 'hidden-parent-0'),
      msg('u1', 'user'), msg('a1', 'assistant', 'hidden-parent-1'),
      msg('t1', 'tool', 'a1'),
      msg('u2', 'user'), msg('a2', 'assistant', 'hidden-parent-2')
    ],
    page_info: { start_cursor: 'bootstrap', end_cursor: 'a2', has_previous_page: true, has_next_page: false }
  };

  const compact = modern.compactPluralConversation(source, 2);

  assert.deepEqual(compact.messages.map((item) => item.id), [
    'bootstrap', 'u1', 'a1', 't1', 'u2', 'a2'
  ]);
  assert.equal(compact.current_node, 'a2');
  assert.equal(compact.messages.find((item) => item.id === 'a1').metadata.parent_id, 'hidden-parent-1');
  assert.equal(compact.messages.find((item) => item.id === 'a2').metadata.parent_id, 'hidden-parent-2');
  assert.equal(compact.page_info.has_previous_page, false);
  assert.equal(compact.page_info.has_next_page, false);
  assert.equal(compact.page_info.start_cursor, 'bootstrap');
  assert.equal(compact.page_info.end_cursor, 'a2');
  assert.equal(source.page_info.has_previous_page, true);
  assert.equal(source.messages.length, 8);
});

test('modern compact preserves a retained user current_node', () => {
  const source = {
    current_node: 'u2',
    messages: [msg('u0', 'user'), msg('a0', 'assistant', 'x'), msg('u1', 'user'), msg('u2', 'user')],
    page_info: { has_previous_page: true, has_next_page: false }
  };
  const compact = modern.compactPluralConversation(source, 2);
  assert.equal(compact.current_node, 'u2');
  assert.equal(compact.messages.at(-1).author.role, 'user');
});
