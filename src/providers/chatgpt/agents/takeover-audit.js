const path = require('node:path');

const defaultZeroRoot = path.resolve(__dirname, '../../../..');

const messageText = (message) => {
  const content = message?.content;
  if (!content) return '';
  if (typeof content.content === 'string') return content.content;
  if (typeof content.text === 'string') return content.text;
  if (Array.isArray(content.parts)) {
    return content.parts
      .map((part) => typeof part === 'string' ? part : part?.text)
      .filter(Boolean)
      .join('\n');
  }
  return '';
};

exports.userTurnCount = (conversation) => {
  if (Number.isInteger(conversation?.user_turns) && conversation.user_turns >= 0) {
    return conversation.user_turns;
  }
  const messages = Array.isArray(conversation?.messages) ? conversation.messages : [];
  return messages.filter((item) => item?.author?.role === 'user').length;
};
exports.buildWindows = (totalUserTurns, windowSize = 4) => {
  if (!Number.isInteger(totalUserTurns) || totalUserTurns < 1) {
    throw new Error('totalUserTurns must be >= 1');
  }
  if (!Number.isInteger(windowSize) || windowSize < 1) {
    throw new Error('windowSize must be >= 1');
  }
  const windows = [];
  for (let start = 1; start <= totalUserTurns; start += windowSize) {
    windows.push({
      start,
      end: Math.min(start + windowSize - 1, totalUserTurns)
    });
  }
  return windows;
};

const expectedCommand = ({ sourceConversationId, start, end }) =>
  `conversation get ${sourceConversationId} limit ${start}-${end} debug`;

exports.isRateLimitedError = (error) =>
  error?.status === 429 || error?.httpStatus === 429 || error?.code === 'RATE_LIMITED';

exports.verifyWindow = (conversation, input) => {
  const messages = Array.isArray(conversation?.messages) ? conversation.messages : [];
  const needle = expectedCommand(input);
  let callIndex = -1;
  for (let index = 0; index < messages.length; index += 1) {
    const item = messages[index];
    if (item?.author?.role !== 'assistant' || item?.recipient !== 'api_tool.call_tool') continue;
    const text = messageText(item);
    if (text.includes('start_process') && text.includes(needle)) callIndex = index;
  }  if (callIndex < 0) return false;
  for (let index = callIndex + 1; index < messages.length; index += 1) {
    const item = messages[index];
    if (item?.author?.role !== 'tool') continue;
    const text = messageText(item);
    if (!text.includes(`conversation_id=${input.sourceConversationId}`)) continue;
    let complete = true;
    for (let turn = input.start; turn <= input.end; turn += 1) {
      if (!text.includes(`[#${turn}] USER`)) {
        complete = false;
        break;
      }
    }
    if (complete) return true;
  }
  return false;
};

exports.makeInitMessage = ({
  taskId, sourceConversationId, taskMessage, totalUserTurns,
  firstWindow, zeroRoot = defaultZeroRoot
}) => [
  '@Remote Desktop Commander',
  '[ZERO_TAKEOVER_INIT]',
  `task_id=${taskId}`,
  `source_conversation_id=${sourceConversationId}`,
  `source_total_user_turns=${totalUserTurns}`,
  `audit_window=${firstWindow.start}-${firstWindow.end}`,
  `zero_root=${zeroRoot}`,
  '',  'AUDIT GATE IS CONTROLLED BY ZERO.',
  'Do not execute continuation work until ZERO_TAKEOVER_START.',
  `Set-Location '${zeroRoot}'`,
  `Run exactly: node .\\src\\cli.js chatgpt conversation get ${sourceConversationId} limit ${firstWindow.start}-${firstWindow.end} debug`,
  'Inspect the actual tool result and compact only this assigned window.',
  'Do not read another window on your own. Zero advances the cursor after verification.',
  '',
  '[REQUESTED_CONTINUATION_CONTEXT_ONLY]',
  taskMessage,
  '',
  `Reply with AUDIT_WINDOW_PROCESSED ${firstWindow.start}-${firstWindow.end}.`
].join('\n');

exports.makeWindowMessage = ({
  taskId, sourceConversationId, totalUserTurns, window,
  zeroRoot = defaultZeroRoot
}) => [
  '@Remote Desktop Commander',
  '[ZERO_TAKEOVER_AUDIT]',
  `task_id=${taskId}`,
  `source_conversation_id=${sourceConversationId}`,
  `source_total_user_turns=${totalUserTurns}`,
  `audit_window=${window.start}-${window.end}`,
  `Set-Location '${zeroRoot}'`,
  `Run exactly: node .\\src\\cli.js chatgpt conversation get ${sourceConversationId} limit ${window.start}-${window.end} debug`,
  'Inspect the actual result and compact only this window.',
  'Do not start continuation work yet.'
].join('\n');

exports.runAudit = async ({
  taskId, sourceConversationId, workerConversationId,
  totalUserTurns, windowSize = 4, initialCursor = 0, initialWorker = null, token, sessionHeaders,
  getConversation, sendConversation, onProgress = () => {},
  verifyWindow = exports.verifyWindow, zeroRoot = defaultZeroRoot
}) => {
  const windows = exports.buildWindows(totalUserTurns, windowSize);
  if (!Number.isInteger(initialCursor) || initialCursor < 0 || initialCursor > totalUserTurns) {
    throw new Error('initialCursor out of range');
  }
  let cursor = initialCursor;
  let worker = initialWorker;
  for (const window of windows) {
    if (window.end <= initialCursor) continue;
    try {
      if (!Array.isArray(worker?.messages)) {
        worker = await getConversation({
          conversationId: workerConversationId, token, sessionHeaders
        });
      }
      if (!verifyWindow(worker, { sourceConversationId, ...window })) {
        const sent = await sendConversation({
          conversationId: workerConversationId,
          message: exports.makeWindowMessage({
            taskId, sourceConversationId, totalUserTurns, window, zeroRoot
          }),
          token, sessionHeaders
        });
        worker = Array.isArray(sent?.messages)
          ? sent
          : await getConversation({
              conversationId: workerConversationId, token, sessionHeaders
            });
      }
      if (!verifyWindow(worker, { sourceConversationId, ...window })) {
        return { complete: false, cursor, nextWindow: window, windows, rateLimited: false };
      }
    } catch (error) {
      if (!exports.isRateLimitedError(error)) throw error;
      return {
        complete: false,
        cursor,
        nextWindow: window,
        windows,
        rateLimited: true,
        httpStatus: 429,
        retryAfterMs: Number.isFinite(error?.retryAfterMs) ? error.retryAfterMs : null,
        error: String(error?.message || error)
      };
    }
    cursor = window.end;
    await onProgress({
      cursor, totalUserTurns, window, complete: cursor === totalUserTurns
    });
  }
  return {
    complete: cursor === totalUserTurns,
    cursor,
    nextWindow: null,
    windows,
    rateLimited: false
  };
};