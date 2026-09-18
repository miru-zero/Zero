const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const mailbox = require('../src/providers/chatgpt/agents/mailbox');

const setup = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-agent-mailbox-'));
  return { dir, filePath: path.join(dir, 'mailbox.json') };
};

test('mailbox enqueue is idempotent by event id', () => {
  const ctx = setup();
  const event = {
    event_id: 'SUBAGENT_RETURN:T1:N_DONE',
    type: 'SUBAGENT_RETURN',
    task_id: 'T1',
    parent_conversation_id: 'C_MAIN',
    result_node_id: 'N_DONE'
  };
  const first = mailbox.enqueue({ filePath: ctx.filePath, event });
  const second = mailbox.enqueue({ filePath: ctx.filePath, event });
  assert.equal(first.event_id, event.event_id);
  assert.equal(second.event_id, event.event_id);
  assert.equal(mailbox.list({ filePath: ctx.filePath }).length, 1);
  fs.rmSync(ctx.dir, { recursive: true, force: true });
});
test('mailbox filters parent events and acknowledges delivery', () => {
  const ctx = setup();
  mailbox.enqueue({ filePath: ctx.filePath, event: {
    event_id: 'E1', type: 'SUBAGENT_RETURN', task_id: 'T1',
    parent_conversation_id: 'C_MAIN', result_node_id: 'N1'
  }});
  mailbox.enqueue({ filePath: ctx.filePath, event: {
    event_id: 'E2', type: 'SUBAGENT_RETURN', task_id: 'T2',
    parent_conversation_id: 'C_OTHER', result_node_id: 'N2'
  }});
  assert.deepEqual(
    mailbox.list({ filePath: ctx.filePath, parentConversationId: 'C_MAIN', pendingOnly: true }).map((event) => event.event_id),
    ['E1']
  );
  const acked = mailbox.ack({ filePath: ctx.filePath, eventId: 'E1', deliveryNodeId: 'N_PARENT_USER' });
  assert.equal(acked.acked, true);
  assert.equal(acked.delivery_node_id, 'N_PARENT_USER');
  assert.equal(mailbox.list({ filePath: ctx.filePath, parentConversationId: 'C_MAIN', pendingOnly: true }).length, 0);
  fs.rmSync(ctx.dir, { recursive: true, force: true });
});
