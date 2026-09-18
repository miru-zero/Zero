const crypto = require('node:crypto');
const path = require('node:path');
const conversations = require('../conversations');
const taskRegistry = require('./task-registry');
const mailbox = require('./mailbox');


const defaultTaskFile = path.resolve(__dirname, '../../../runtime/agent-tasks.json');
const defaultMailboxFile = path.resolve(__dirname, '../../../runtime/agent-mailbox.json');

const currentMessage = (conversation) => {
  const messages = Array.isArray(conversation?.messages) ? conversation.messages : [];
  return messages.find((item) => item?.id === conversation?.current_node) || null;
};

const messageText = (message) => {
  const content = message?.content;
  if (!content) return '';
  if (typeof content.content === 'string') return content.content;
  if (typeof content.text === 'string') return content.text;
  if (Array.isArray(content.parts)) {
    return content.parts.map((part) => typeof part === 'string' ? part : part?.text).filter(Boolean).join('\n');
  }
  return '';
};

const finalWorkerMessage = (conversation, dispatchNodeId) => {
  const message = currentMessage(conversation);
  if (!message || message.id === dispatchNodeId) return null;
  if (message?.author?.role !== 'assistant') return null;
  if (message.status !== 'finished_successfully') return null;
  if (message.end_turn !== true) return null;
  return message;
};

const makeReturnMessage = (event) => [
  '[ZERO_SUBAGENT_RESULT]',
  `task_id=${event.task_id}`,
  `worker_conversation_id=${event.worker_conversation_id}`,
  `result_node=${event.result_node_id}`,
  `status=${event.status}`,
  '',
  event.result_text || ''
].join('\n');

const makeAgentMessage = ({ taskId, from, text }) => [
  '[ZERO_AGENT_MESSAGE]',
  `task_id=${taskId}`,
  `from=${from}`,
  '',
  text
].join('\n');

const makeTaskDispatchMessage = ({ taskId, parentConversationId, taskMessage }) => [
  taskMessage,
  '',
  '[ZERO_AGENT_CONTEXT]',
  `task_id=${taskId}`,
  `parent_conversation_id=${parentConversationId}`,
  '',
  '[ZERO_RETURN_RULE]',
  'When finished at a milestone, blocker, or natural stop, return the report to MAIN through Zero and STOP.',
  `zero chatgpt agent return ${taskId} "<FACT / VERIFIED / BLOCKER / STATE / NEXT>"`,
  'To ask MAIN a question or report mid-task progress WITHOUT finishing:',
  `zero chatgpt agent reply ${taskId} "<message>"`,
  'Do not finish silently. Do not start the next task after returning the report.'
].join('\n');

exports.spawnAgent = async ({
  taskFile = defaultTaskFile,
  mailboxFile = defaultMailboxFile,
  workerConversationId,
  parentConversationId,
  parentTurnId = null,
  parentTaskId = null,
  taskMessage,
  taskId = `task_${crypto.randomUUID()}`,
  token,
  sessionHeaders,
  getConversation = conversations.getConversation,
  sendConversation = conversations.sendConversation
}) => {
  if (!workerConversationId) throw new Error('workerConversationId is required');
  if (!parentConversationId) throw new Error('parentConversationId is required');
  if (!taskMessage) throw new Error('taskMessage is required');
  let resolvedParentTurnId = parentTurnId;
  if (!resolvedParentTurnId) {
    const parent = await getConversation({
      conversationId: parentConversationId,
      token,
      sessionHeaders
    });
    resolvedParentTurnId = parent?.current_node || null;
  }
  if (!resolvedParentTurnId) throw new Error('parent current_node is required');

  taskRegistry.createTask({ filePath: taskFile, task: {
    task_id: taskId,
    parent_task_id: parentTaskId,
    parent_conversation_id: parentConversationId,
    parent_turn_id: resolvedParentTurnId,
    worker_conversation_id: workerConversationId,
    dispatch_node_id: null,
    status: 'DISPATCHING'
  }});

  try {
    const sent = await sendConversation({
      conversationId: workerConversationId,
      message: makeTaskDispatchMessage({ taskId, parentConversationId, taskMessage }),
      waitForFinal: false,
      token,
      sessionHeaders
    });
    if (!sent?.current_node) throw new Error('worker dispatch missing current_node');
    taskRegistry.updateTask({ filePath: taskFile, taskId, patch: {
      dispatch_node_id: sent.previous_node || sent.current_node,
      status: 'RUNNING'
    }});
    return {
      status: 'DISPATCHED',
      task_id: taskId,
      agent_id: workerConversationId,
      current_node: sent.current_node
    };
  } catch (error) {
    taskRegistry.updateTask({ filePath: taskFile, taskId, patch: {
      status: 'FAILED',
      error: String(error?.message || error)
    }});
    throw error;
  }
};

exports.checkTask = async ({
  taskFile = defaultTaskFile,
  mailboxFile = defaultMailboxFile,
  taskId,
  token,
  sessionHeaders,
  getConversation = conversations.getConversation
}) => {
  const task = taskRegistry.getTask({ filePath: taskFile, taskId });
  if (!task) throw new Error(`task not found: ${taskId}`);
  if (task.status !== 'RUNNING') return task;
  const worker = await getConversation({
    conversationId: task.worker_conversation_id,
    token,
    sessionHeaders
  });
  const final = finalWorkerMessage(worker, task.dispatch_node_id);
  if (!final) return task;
  const resultText = messageText(final);
  const eventId = `SUBAGENT_RETURN:${task.task_id}:${final.id}`;
  mailbox.enqueue({ filePath: mailboxFile, event: {
    event_id: eventId,
    type: 'SUBAGENT_RETURN',
    task_id: task.task_id,
    parent_task_id: task.parent_task_id,
    root_task_id: task.root_task_id,
    parent_conversation_id: task.parent_conversation_id,
    parent_turn_id: task.parent_turn_id,
    worker_conversation_id: task.worker_conversation_id,
    result_node_id: final.id,
    result_text: resultText,
    status: 'DONE'
  }});
  return taskRegistry.updateTask({ filePath: taskFile, taskId, patch: {
    status: 'DONE',
    result_node_id: final.id,
    result_text: resultText
  }});
};

exports.deliverEvent = async ({
  taskFile = defaultTaskFile,
  mailboxFile = defaultMailboxFile,
  eventId,
  token,
  sessionHeaders,
  sendConversation = conversations.sendConversation
}) => {
  const event = mailbox.list({ filePath: mailboxFile }).find((item) => item.event_id === eventId);
  if (!event) throw new Error(`mailbox event not found: ${eventId}`);
  if (event.acked) return event;
  const sent = await sendConversation({
    conversationId: event.parent_conversation_id,
    message: makeReturnMessage(event),
    waitForFinal: false,
    token,
    sessionHeaders
  });
  if (!sent?.current_node) throw new Error('parent resume missing current_node');
  const acked = mailbox.ack({
    filePath: mailboxFile,
    eventId,
    deliveryNodeId: sent.current_node
  });
  taskRegistry.updateTask({ filePath: taskFile, taskId: event.task_id, patch: {
    delivery_status: 'DELIVERED',
    delivery_node_id: sent.current_node
  }});
  return acked;
};

exports.returnAgent = async ({
  taskFile = defaultTaskFile,
  taskId,
  report,
  token,
  sessionHeaders,
  sendConversation = conversations.sendConversation
}) => {
  if (!report) throw new Error('report is required');
  const task = exports.agentStatus({ taskFile, taskId });
  if (task.status === 'DONE' && task.delivery_status === 'DELIVERED') {
    return { status: 'DELIVERED', task_id: taskId, parent_conversation_id: task.parent_conversation_id, current_node: task.delivery_node_id };
  }
  const event = { ...task, result_text: report, status: 'DONE' };
  const sent = await sendConversation({
    conversationId: task.parent_conversation_id,
    message: makeReturnMessage(event),
    waitForFinal: false,
    token,
    sessionHeaders
  });
  if (!sent?.current_node) throw new Error('parent return missing current_node');
  taskRegistry.updateTask({ filePath: taskFile, taskId, patch: {
    status: 'DONE',
    result_text: report,
    delivery_status: 'DELIVERED',
    delivery_node_id: sent.current_node,
    return_mode: 'CALLBACK'
  }});
  return {
    status: 'DELIVERED',
    task_id: taskId,
    parent_conversation_id: task.parent_conversation_id,
    current_node: sent.current_node
  };
};

exports.replyAgent = async ({
  taskFile = defaultTaskFile,
  taskId,
  message,
  token,
  sessionHeaders,
  sendConversation = conversations.sendConversation
}) => {
  if (!message) throw new Error('message is required');
  const task = exports.agentStatus({ taskFile, taskId });
  if (task.status === 'CLOSED') throw new Error(`task is closed: ${taskId}`);
  if (task.status === 'DONE' && task.delivery_status === 'DELIVERED') {
    throw new Error(`task already returned: ${taskId} — คุยต่อต้อง spawn งานใหม่ (งานนี้ปิดแล้ว)`);
  }
  const sent = await sendConversation({
    conversationId: task.parent_conversation_id,
    message: makeAgentMessage({ taskId, from: 'worker', text: message }),
    waitForFinal: false,
    token,
    sessionHeaders
  });
  if (!sent?.current_node) throw new Error('parent reply missing current_node');
  taskRegistry.updateTask({ filePath: taskFile, taskId, patch: {
    status: 'RUNNING',
    last_reply_node_id: sent.current_node
  }});
  return {
    status: 'REPLIED',
    task_id: taskId,
    parent_conversation_id: task.parent_conversation_id,
    current_node: sent.current_node
  };
};

exports.checkAgent = async ({
  taskFile = defaultTaskFile,
  mailboxFile = defaultMailboxFile,
  taskId,
  token,
  sessionHeaders,
  getConversation,
  sendConversation
}) => {
  await exports.checkTask({
    taskFile,
    mailboxFile,
    taskId,
    token,
    sessionHeaders,
    ...(getConversation ? { getConversation } : {})
  });
  const pending = mailbox.list({ filePath: mailboxFile, pendingOnly: true })
    .filter((event) => event.task_id === taskId);
  for (const event of pending) {
    await exports.deliverEvent({
      taskFile,
      mailboxFile,
      eventId: event.event_id,
      token,
      sessionHeaders,
      ...(sendConversation ? { sendConversation } : {})
    });
  }
  return { task: exports.agentStatus({ taskFile, taskId }), delivered: pending.length };
};

exports.listAgents = ({ taskFile = defaultTaskFile }) =>
  taskRegistry.listTasks({ filePath: taskFile });

exports.agentStatus = ({ taskFile = defaultTaskFile, taskId }) => {
  const task = taskRegistry.getTask({ filePath: taskFile, taskId });
  if (!task) throw new Error(`task not found: ${taskId}`);
  return task;
};

exports.agentResult = ({ taskFile = defaultTaskFile, taskId }) => {
  const task = exports.agentStatus({ taskFile, taskId });
  return {
    task_id: task.task_id,
    status: task.status,
    result_node_id: task.result_node_id || null,
    result_text: task.result_text || null
  };
};

exports.sendMessage = async ({
  taskFile = defaultTaskFile,
  taskId,
  message,
  token,
  sessionHeaders,
  sendConversation = conversations.sendConversation
}) => {
  if (!message) throw new Error('message is required');
  const task = exports.agentStatus({ taskFile, taskId });
  if (task.status === 'CLOSED') throw new Error(`task is closed: ${taskId}`);
  const sent = await sendConversation({
    conversationId: task.worker_conversation_id,
    message: makeAgentMessage({ taskId, from: 'parent', text: message }),
    waitForFinal: false,
    token,
    sessionHeaders
  });
  if (!sent?.current_node) throw new Error('worker dispatch missing current_node');
  taskRegistry.updateTask({ filePath: taskFile, taskId, patch: {
    status: 'RUNNING',
    dispatch_node_id: sent.previous_node || sent.current_node,
    result_node_id: null,
    result_text: null,
    delivery_status: 'PENDING',
    delivery_node_id: null
  }});
  return {
    status: 'DISPATCHED',
    task_id: taskId,
    agent_id: task.worker_conversation_id,
    current_node: sent.current_node
  };
};

exports.closeAgent = ({ taskFile = defaultTaskFile, taskId }) =>
  taskRegistry.updateTask({
    filePath: taskFile,
    taskId,
    patch: { status: 'CLOSED' }
  });
exports.waitAgent = async ({
  taskFile = defaultTaskFile,
  mailboxFile = defaultMailboxFile,
  taskId,
  timeoutMs = 30000,
  pollMs = 500,
  sleepImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  checkTaskImpl = exports.checkTask,
  ...checkInput
}) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const task = await checkTaskImpl({
      taskFile,
      mailboxFile,
      taskId,
      ...checkInput
    });
    if (['DONE', 'FAILED', 'CLOSED'].includes(task.status)) return task;
    await sleepImpl(pollMs);
  }
  const error = new Error('AGENT_WAIT_TIMEOUT');
  error.code = 'AGENT_WAIT_TIMEOUT';
  throw error;
};

