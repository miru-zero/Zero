const conversations = require('../providers/chatgpt/conversations');
const registry = require('./model-registry');
const toolCompat = require('./tool-compat');

const textContent = (item) => {
  if (typeof item?.content === 'string') return item.content;
  if (!Array.isArray(item?.content)) return '';
  return item.content.map((part) => {
    if (typeof part === 'string') return part;
    if (part && typeof part === 'object' && typeof part.text === 'string') return part.text;
    return '';
  }).join('');
};

const syntheticSystemText = (item) => {
  if (item?.role !== 'user') return null;
  const text = textContent(item).trim();
  const match = text.match(/^<system>\s*([\s\S]*?)\s*<\/system>$/i);
  return match ? match[1].trim() : null;
};

const hiddenHistoryText = (item) => {
  const content = textContent(item);

  if (item?.role === 'system' || item?.role === 'developer') {
    return content.trim() ? content.trim() : null;
  }

  const syntheticSystem = syntheticSystemText(item);
  if (syntheticSystem) return syntheticSystem;

  if (item?.role === 'tool') {
    return toolCompat.clientToolResultToPrompt(item);
  }

  if (item?.role === 'assistant' && Array.isArray(item?.tool_calls) && item.tool_calls.length) {
    return [
      'ZERO_CLIENT_ASSISTANT_TOOL_CALL_HISTORY_V1',
      JSON.stringify(item.tool_calls)
    ].join('\n');
  }

  if (item?.role === 'assistant' && content.trim()) {
    return ['ZERO_CLIENT_ASSISTANT_HISTORY_V1', content].join('\n');
  }

  if (item?.role === 'user' && content.trim()) {
    return ['ZERO_CLIENT_USER_HISTORY_V1', content].join('\n');
  }

  return null;
};

const buildEnvelope = ({ messages = [], tools = [] } = {}) => {
  const items = Array.isArray(messages) ? messages : [];
  let latestActionIndex = -1;
  let latestActionKind = null;

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item?.role === 'tool' && typeof item?.tool_call_id === 'string' && item.tool_call_id.trim()) {
      latestActionIndex = index;
      latestActionKind = 'tool';
      continue;
    }
    if (item?.role === 'user' && !syntheticSystemText(item) && textContent(item).trim()) {
      latestActionIndex = index;
      latestActionKind = 'user';
    }
  }

  const hiddenSystemMessages = [];
  for (let index = 0; index < items.length; index += 1) {
    if (index === latestActionIndex && latestActionKind === 'user') continue;
    const hidden = hiddenHistoryText(items[index]);
    if (hidden) hiddenSystemMessages.push(hidden);
  }

  const toolInstructions = toolCompat.clientToolInstructions(tools);
  if (toolInstructions) hiddenSystemMessages.push(toolInstructions);

  if (latestActionKind === 'user') {
    return {
      message: textContent(items[latestActionIndex]).trim(),
      hideUserMessage: false,
      hiddenSystemMessages
    };
  }

  if (latestActionKind === 'tool') {
    return {
      message: 'Continue the previous task using the hidden client tool result.',
      hideUserMessage: true,
      hiddenSystemMessages
    };
  }

  return null;
};

exports.complete = async ({
  model,
  messages,
  context = {},
  conversationId = null,
  tools = [],
  onChunk = null,
  createConversation = conversations.createConversation,
  sendConversation = conversations.sendConversation
}) => {
  const spec = registry.get(model);
  if (!spec) {
    const error = new Error(`Unknown model: ${model}`);
    error.code = 'MODEL_NOT_FOUND';
    throw error;
  }

  const envelope = buildEnvelope({ messages, tools });
  if (!envelope) {
    const error = new Error(conversationId
      ? 'a user or tool message is required to continue a conversation'
      : 'messages are required');
    error.code = 'BAD_REQUEST';
    throw error;
  }

  const common = {
    message: envelope.message,
    hideUserMessage: envelope.hideUserMessage,
    hiddenSystemMessages: envelope.hiddenSystemMessages,
    model: spec.backendModel,
    onChunk,
    recoverStream: typeof onChunk === 'function',
    token: context.token,
    sessionHeaders: context.sessionHeaders || {}
  };

  if (conversationId) {
    return sendConversation({
      conversationId,
      ...common
    });
  }

  return createConversation({ ...common, projectId: context.projectId || process.env.ZERO_LLM_PROJECT_ID || null });
};
