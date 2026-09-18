const fs = require('node:fs');
const path = require('node:path');


const readState = (filePath) => {
  if (!fs.existsSync(filePath)) return { version: 1, events: [] };
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return {
    version: Number(parsed?.version) || 1,
    events: Array.isArray(parsed?.events) ? parsed.events : []
  };
};

const writeState = (filePath, state) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, filePath);
};

exports.enqueue = ({ filePath, event, now = Date.now() }) => {
  if (!event?.event_id) throw new Error('event_id is required');
  const state = readState(filePath);
  const existing = state.events.find((item) => item.event_id === event.event_id);
  if (existing) return existing;
  const created = {
    acked: false,
    delivery_node_id: null,
    created_at: new Date(now).toISOString(),
    ...event
  };
  state.events.push(created);
  writeState(filePath, state);
  return created;
};

exports.list = ({ filePath, parentConversationId = null, pendingOnly = false }) =>
  readState(filePath).events.filter((event) => {
    if (parentConversationId && event.parent_conversation_id !== parentConversationId) return false;
    if (pendingOnly && event.acked) return false;
    return true;
  });

exports.ack = ({ filePath, eventId, deliveryNodeId = null, now = Date.now() }) => {
  const state = readState(filePath);
  const index = state.events.findIndex((event) => event.event_id === eventId);
  if (index < 0) throw new Error(`mailbox event not found: ${eventId}`);
  const updated = {
    ...state.events[index],
    acked: true,
    delivery_node_id: deliveryNodeId,
    acked_at: new Date(now).toISOString()
  };
  state.events[index] = updated;
  writeState(filePath, state);
  return updated;
};

