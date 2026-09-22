const crypto = require('node:crypto');
const path = require('node:path');
const conversations = require('../conversations');
const taskRegistry = require('./task-registry');
const mailbox = require('./mailbox');
const takeoverAudit = require('./takeover-audit');


const defaultTaskFile = path.resolve(__dirname, '../../../runtime/agent-tasks.json');
const defaultMailboxFile = path.resolve(__dirname, '../../../runtime/agent-mailbox.json');
const defaultConversionsDir = path.resolve(__dirname, 'conversions');
const defaultZeroRoot = path.resolve(__dirname, '../../../..');
const defaultRateLimitCooldownMs = 30000;
const activeTakeoverStatuses = new Set(['DISPATCHING', 'AUDITING', 'AUDIT_COMPLETE', 'RUNNING', 'RATE_LIMITED', 'AUDIT_BLOCKED']);

const activeTakeoverForParent = ({ taskFile, parentConversationId }) =>
  taskRegistry.listTasks({ filePath: taskFile }).find((task) =>
    task.mode === 'TAKEOVER'
    && task.parent_conversation_id === parentConversationId
    && activeTakeoverStatuses.has(task.status)
  ) || null;

const rateLimitTiming = (value = {}) => {
  const retryAfterMs = Number.isFinite(value?.retryAfterMs)
    ? value.retryAfterMs
    : defaultRateLimitCooldownMs;
  return {
    retry_after_ms: retryAfterMs,
    retry_not_before: new Date(Date.now() + retryAfterMs).toISOString()
  };
};

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

const makeTakeoverStartMessage = ({ taskId, sourceConversationId, workerConversationId, taskMessage, outputDir, zeroRoot = defaultZeroRoot }) => [
  '@Remote Desktop Commander',
  '[ZERO_TAKEOVER_START]',
  `task_id=${taskId}`,
  `source_conversation_id=${sourceConversationId}`,
  `worker_conversation_id=${workerConversationId}`,
  `output_dir=${outputDir}`,
  '',
  'Continue the actual work now from the verified NEXT you reconstructed. Do not stop at a summary, plan, acknowledgement, or generic approach.',
  '[REQUESTED_CONTINUATION]',
  taskMessage,
  '',
  'At the next milestone/blocker/natural stop, create output_dir yourself and write result.txt there yourself with CONVERSATION_ID, SOURCE_CONVERSATION_ID, TASK_ID, FACT, VERIFIED, BLOCKER, STATE, NEXT. Read it back yourself to verify.',
  '',
  '[ZERO_RETURN_RULE]',
  `Use repository CLI from ${zeroRoot}; do not use installed zero.cmd.`,
  `node .\\src\\cli.js chatgpt agent return ${taskId} "<FACT / VERIFIED / BLOCKER / STATE / NEXT>"`,
  `node .\\src\\cli.js chatgpt agent reply ${taskId} "<message>"`,
  'Do not finish silently.'
].join('\n');

exports.spawnTakeover = async ({
  taskFile = defaultTaskFile,
  conversionsDir = defaultConversionsDir,
  parentConversationId,
  workerProjectId = null,
  parentTurnId = null,
  parentTaskId = null,
  taskMessage,
  auditWindowSize = 4,
  taskId = `task_${crypto.randomUUID()}`,
  token,
  sessionHeaders,
  getConversation = conversations.getConversation,
  createConversation = conversations.createConversation,
  sendConversation = conversations.sendConversation,
  runAudit = takeoverAudit.runAudit
}) => {
  if (!parentConversationId) throw new Error('parentConversationId is required');
  if (!taskMessage) throw new Error('taskMessage is required');
  const active = activeTakeoverForParent({ taskFile, parentConversationId });
  if (active) {
    const error = new Error(`active takeover already exists for parent ${parentConversationId}: ${active.task_id}`);
    error.code = 'ACTIVE_TAKEOVER_EXISTS';
    error.taskId = active.task_id;
    throw error;
  }

  const parent = await getConversation({
    conversationId: parentConversationId,
    token,
    sessionHeaders
  });
  const resolvedParentTurnId = parentTurnId || parent?.current_node || null;
  if (!resolvedParentTurnId) throw new Error('parent current_node is required');
  const totalUserTurns = takeoverAudit.userTurnCount(parent);
  const auditWindows = takeoverAudit.buildWindows(totalUserTurns, auditWindowSize);
  const firstAuditWindow = auditWindows[0];

  const worker = await createConversation({
    message: takeoverAudit.makeInitMessage({
      taskId,
      sourceConversationId: parentConversationId,
      taskMessage,
      totalUserTurns,
      firstWindow: firstAuditWindow
    }),
    projectId: workerProjectId || parent?.gizmo_id || null,
    token,
    sessionHeaders
  });
  const workerConversationId = worker?.conversation_id;
  if (!workerConversationId) throw new Error('takeover worker missing conversation_id');

  taskRegistry.createTask({ filePath: taskFile, task: {
    task_id: taskId,
    parent_task_id: parentTaskId,
    parent_conversation_id: parentConversationId,
    parent_turn_id: resolvedParentTurnId,
    worker_conversation_id: workerConversationId,
    worker_project_id: workerProjectId || parent?.gizmo_id || null,
    worker_init_node_id: worker?.current_node || null,
    dispatch_node_id: worker?.current_node || null,
    mode: 'TAKEOVER',
    task_message: taskMessage,
    takeover_phase: 'AUDIT',
    source_snapshot_node_id: resolvedParentTurnId,
    audit_total_user_turns: totalUserTurns,
    audit_window_size: auditWindowSize,
    audit_cursor: 0,
    audit_windows_verified: [],
    audit_complete: false,
    status: 'AUDITING'
  }});

  const outputDir = path.join(conversionsDir, workerConversationId);
  try {
    const verifiedWindows = [];
    const auditResult = await runAudit({
      taskId,
      sourceConversationId: parentConversationId,
      workerConversationId,
      totalUserTurns,
      windowSize: auditWindowSize,
      initialWorker: worker,
      token,
      sessionHeaders,
      getConversation,
      sendConversation,
      onProgress: async ({ cursor, window }) => {
        verifiedWindows.push(`${window.start}-${window.end}`);
        taskRegistry.updateTask({ filePath: taskFile, taskId, patch: {
          audit_cursor: cursor,
          audit_windows_verified: [...verifiedWindows]
        }});
      }
    });
    if (!auditResult.complete) {
      const blocked = taskRegistry.updateTask({ filePath: taskFile, taskId, patch: {
        status: auditResult.rateLimited ? 'RATE_LIMITED' : 'AUDIT_BLOCKED',
        takeover_phase: 'AUDIT',
        transient_http_status: auditResult.rateLimited ? 429 : null,
        transient_error: auditResult.rateLimited ? auditResult.error : null,
        ...(auditResult.rateLimited
          ? rateLimitTiming(auditResult)
          : { retry_after_ms: null, retry_not_before: null }),
        audit_cursor: auditResult.cursor,
        audit_next_window: `${auditResult.nextWindow.start}-${auditResult.nextWindow.end}`,
        output_dir: outputDir
      }});
      return {
        status: blocked.status,
        task_id: taskId,
        agent_id: workerConversationId,
        source_conversation_id: parentConversationId,
        audit_cursor: blocked.audit_cursor,
        audit_total_user_turns: totalUserTurns,
        audit_next_window: blocked.audit_next_window,
        http_status: blocked.transient_http_status || null,
        retry_after_ms: blocked.retry_after_ms || null,
        retry_not_before: blocked.retry_not_before || null,
        output_dir: outputDir
      };
    }
    taskRegistry.updateTask({ filePath: taskFile, taskId, patch: {
      status: 'AUDIT_COMPLETE',
      takeover_phase: 'START_PENDING',
      audit_complete: true,
      audit_cursor: totalUserTurns,
      audit_next_window: null
    }});

    const sent = await sendConversation({
      conversationId: workerConversationId,
      message: makeTakeoverStartMessage({
        taskId,
        sourceConversationId: parentConversationId,
        workerConversationId,
        taskMessage,
        outputDir
      }),
      waitForFinal: false,
      token,
      sessionHeaders
    });
    if (!sent?.current_node) throw new Error('takeover dispatch missing current_node');
    taskRegistry.updateTask({ filePath: taskFile, taskId, patch: {
      dispatch_node_id: sent.previous_node || worker?.current_node || sent.current_node,
      status: 'RUNNING',
      takeover_phase: 'RUNNING',
      transient_http_status: null,
      transient_error: null,
      retry_after_ms: null,
      retry_not_before: null,
      output_dir: outputDir
    }});
    return {
      status: 'DISPATCHED',
      task_id: taskId,
      agent_id: workerConversationId,
      source_conversation_id: parentConversationId,
      worker_project_id: workerProjectId || parent?.gizmo_id || null,
      output_dir: outputDir,
      current_node: sent.current_node
    };
  } catch (error) {
    if (takeoverAudit.isRateLimitedError(error)) {
      const current = taskRegistry.getTask({ filePath: taskFile, taskId });
      const nextStart = (current?.audit_cursor || 0) + 1;
      const nextEnd = Math.min(nextStart + (current?.audit_window_size || 4) - 1, current?.audit_total_user_turns || nextStart);
      const limited = taskRegistry.updateTask({ filePath: taskFile, taskId, patch: {
        status: 'RATE_LIMITED',
        transient_http_status: 429,
        transient_error: String(error?.message || error),
        ...rateLimitTiming(error),
        audit_next_window: current?.audit_complete ? null : current?.audit_next_window || `${nextStart}-${nextEnd}`
      }});
      return {
        status: limited.status,
        task_id: taskId,
        agent_id: workerConversationId,
        source_conversation_id: parentConversationId,
        audit_cursor: limited.audit_cursor,
        audit_total_user_turns: limited.audit_total_user_turns,
        audit_next_window: limited.audit_next_window,
        http_status: 429,
        retry_after_ms: limited.retry_after_ms || null,
        retry_not_before: limited.retry_not_before || null,
        output_dir: outputDir
      };
    }
    taskRegistry.updateTask({ filePath: taskFile, taskId, patch: {
      status: 'FAILED',
      error: String(error?.message || error)
    }});
    throw error;
  }
};

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
  if (task.mode === 'TAKEOVER' && task.audit_complete !== true) return task;
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
  if (task.mode === 'TAKEOVER' && task.audit_complete !== true) {
    throw new Error(`TAKEOVER_AUDIT_INCOMPLETE:${task.audit_cursor || 0}/${task.audit_total_user_turns || 0}`);
  }
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
    status: task.mode === 'TAKEOVER' && task.audit_complete !== true ? task.status : 'RUNNING',
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
  const outboundMessage = task.mode === 'TAKEOVER'
    ? ['@Remote Desktop Commander', makeAgentMessage({ taskId, from: 'parent', text: message })].join('\n')
    : makeAgentMessage({ taskId, from: 'parent', text: message });
  const sent = await sendConversation({
    conversationId: task.worker_conversation_id,
    message: outboundMessage,
    waitForFinal: false,
    token,
    sessionHeaders
  });
  if (!sent?.current_node) throw new Error('worker dispatch missing current_node');
  taskRegistry.updateTask({ filePath: taskFile, taskId, patch: {
    status: task.mode === 'TAKEOVER' && task.audit_complete !== true ? task.status : 'RUNNING',
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


exports.resumeTakeover = async ({
  taskFile = defaultTaskFile,
  taskId,
  token,
  sessionHeaders,
  getConversation = conversations.getConversation,
  sendConversation = conversations.sendConversation,
  runAudit = takeoverAudit.runAudit
}) => {
  const task = taskRegistry.getTask({ filePath: taskFile, taskId });
  if (!task) throw new Error(`task not found: ${taskId}`);
  if (task.mode !== 'TAKEOVER') throw new Error(`task is not TAKEOVER: ${taskId}`);
  if (task.status === 'RUNNING') return {
    status: 'RUNNING',
    task_id: taskId,
    agent_id: task.worker_conversation_id,
    source_conversation_id: task.parent_conversation_id,
    audit_cursor: task.audit_cursor || 0,
    audit_total_user_turns: task.audit_total_user_turns || 0,
    output_dir: task.output_dir || path.join(defaultConversionsDir, task.worker_conversation_id)
  };
  if (task.status === 'DONE' || task.status === 'CLOSED') {
    throw new Error(`task cannot resume from ${task.status}: ${taskId}`);
  }
  if (task.status === 'FAILED' && !String(task.error || '').includes('(429)')) {
    throw new Error(`task failed non-transiently: ${taskId}`);
  }
  if (task.status === 'RATE_LIMITED' && task.retry_not_before) {
    const retryAt = Date.parse(task.retry_not_before);
    if (Number.isFinite(retryAt) && retryAt > Date.now()) {
      return {
        status: 'RATE_LIMITED',
        task_id: taskId,
        agent_id: task.worker_conversation_id,
        source_conversation_id: task.parent_conversation_id,
        audit_cursor: task.audit_cursor || 0,
        audit_total_user_turns: task.audit_total_user_turns || 0,
        audit_next_window: task.audit_next_window || null,
        http_status: 429,
        retry_after_ms: retryAt - Date.now(),
        retry_not_before: task.retry_not_before,
        output_dir: task.output_dir || path.join(defaultConversionsDir, task.worker_conversation_id)
      };
    }
  }
  const outputDir = task.output_dir || path.join(defaultConversionsDir, task.worker_conversation_id);
  let current = taskRegistry.updateTask({ filePath: taskFile, taskId, patch: {
    status: task.audit_complete ? 'AUDIT_COMPLETE' : 'AUDITING',
    transient_http_status: null,
    transient_error: null,
    retry_after_ms: null,
    retry_not_before: null,
    output_dir: outputDir
  }});
  try {
    if (current.audit_complete !== true) {
      const verifiedWindows = Array.isArray(current.audit_windows_verified)
        ? [...current.audit_windows_verified]
        : [];
      const auditResult = await runAudit({
        taskId,
        sourceConversationId: current.parent_conversation_id,
        workerConversationId: current.worker_conversation_id,
        totalUserTurns: current.audit_total_user_turns,
        windowSize: current.audit_window_size || 4,
        initialCursor: current.audit_cursor || 0,
        token,
        sessionHeaders,
        getConversation,
        sendConversation,
        onProgress: async ({ cursor, window }) => {
          const label = `${window.start}-${window.end}`;
          if (!verifiedWindows.includes(label)) verifiedWindows.push(label);
          current = taskRegistry.updateTask({ filePath: taskFile, taskId, patch: {
            audit_cursor: cursor,
            audit_windows_verified: [...verifiedWindows]
          }});
        }
      });
      if (!auditResult.complete) {
        const nextWindow = auditResult.nextWindow
          ? `${auditResult.nextWindow.start}-${auditResult.nextWindow.end}`
          : null;
        current = taskRegistry.updateTask({ filePath: taskFile, taskId, patch: {
          status: auditResult.rateLimited ? 'RATE_LIMITED' : 'AUDIT_BLOCKED',
          takeover_phase: 'AUDIT',
          audit_cursor: auditResult.cursor,
          audit_next_window: nextWindow,
          transient_http_status: auditResult.rateLimited ? 429 : null,
          transient_error: auditResult.rateLimited ? auditResult.error : null,
          ...(auditResult.rateLimited
            ? rateLimitTiming(auditResult)
            : { retry_after_ms: null, retry_not_before: null })
        }});
        return {
          status: current.status,
          task_id: taskId,
          agent_id: current.worker_conversation_id,
          source_conversation_id: current.parent_conversation_id,
          audit_cursor: current.audit_cursor,
          audit_total_user_turns: current.audit_total_user_turns,
          audit_next_window: current.audit_next_window,
          http_status: current.transient_http_status || null,
          retry_after_ms: current.retry_after_ms || null,
          retry_not_before: current.retry_not_before || null,
          output_dir: outputDir
        };
      }
      current = taskRegistry.updateTask({ filePath: taskFile, taskId, patch: {
        status: 'AUDIT_COMPLETE',
        takeover_phase: 'START_PENDING',
        audit_complete: true,
        audit_cursor: current.audit_total_user_turns,
        audit_next_window: null
      }});
    }
    if (!current.task_message) throw new Error(`takeover task_message missing: ${taskId}`);
    const sent = await sendConversation({
      conversationId: current.worker_conversation_id,
      message: makeTakeoverStartMessage({
        taskId,
        sourceConversationId: current.parent_conversation_id,
        workerConversationId: current.worker_conversation_id,
        taskMessage: current.task_message,
        outputDir
      }),
      waitForFinal: false,
      token,
      sessionHeaders
    });
    if (!sent?.current_node) throw new Error('takeover resume dispatch missing current_node');
    current = taskRegistry.updateTask({ filePath: taskFile, taskId, patch: {
      status: 'RUNNING',
      takeover_phase: 'RUNNING',
      dispatch_node_id: sent.previous_node || current.dispatch_node_id || sent.current_node,
      transient_http_status: null,
      transient_error: null,
      retry_after_ms: null,
      retry_not_before: null,
      output_dir: outputDir
    }});
    return {
      status: 'DISPATCHED',
      task_id: taskId,
      agent_id: current.worker_conversation_id,
      source_conversation_id: current.parent_conversation_id,
      audit_cursor: current.audit_cursor,
      audit_total_user_turns: current.audit_total_user_turns,
      output_dir: outputDir,
      current_node: sent.current_node
    };
  } catch (error) {
    if (takeoverAudit.isRateLimitedError(error)) {
      current = taskRegistry.updateTask({ filePath: taskFile, taskId, patch: {
        status: 'RATE_LIMITED',
        transient_http_status: 429,
        transient_error: String(error?.message || error),
        ...rateLimitTiming(error)
      }});
      return {
        status: current.status,
        task_id: taskId,
        agent_id: current.worker_conversation_id,
        source_conversation_id: current.parent_conversation_id,
        audit_cursor: current.audit_cursor || 0,
        audit_total_user_turns: current.audit_total_user_turns || 0,
        audit_next_window: current.audit_next_window || null,
        http_status: 429,
        retry_after_ms: current.retry_after_ms || null,
        retry_not_before: current.retry_not_before || null,
        output_dir: outputDir
      };
    }
    taskRegistry.updateTask({ filePath: taskFile, taskId, patch: {
      status: 'FAILED',
      error: String(error?.message || error)
    }});
    throw error;
  }
};
