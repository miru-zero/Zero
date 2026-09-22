const crypto = require('node:crypto');
const toolCompat = require('./tool-compat');

const partToText = (part) => {
  if (typeof part === 'string') return part;
  if (part && typeof part === 'object' && typeof part.text === 'string') return part.text;
  return '';
};

const messageText = (message) => {
  const parts = Array.isArray(message?.content?.parts) ? message.content.parts : [];
  return parts.map(partToText).join('');
};

const latestAssistantMessage = (conversation) => {
  const messages = Array.isArray(conversation?.messages) ? conversation.messages : [];
  const currentNode = conversation?.current_node || null;
  if (currentNode) {
    const current = messages.find((message) => message?.id === currentNode);
    if (current?.author?.role === 'assistant') return current;
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.author?.role === 'assistant') return messages[index];
  }
  return null;
};

const latestFunctionCall = (conversation, tools) => {
  const message = latestAssistantMessage(conversation);
  if (!message) return null;

  const native = toolCompat.nativeInvocationToFunctionCall(message);
  if (native) return native;

  const text = messageText(message);
  return toolCompat.clientToolCallFromText(text, {
    tools,
    id: message?.id || conversation?.current_node || 'unknown'
  });
};

exports.extractAssistantText = (conversation) => {
  const messages = Array.isArray(conversation?.messages) ? conversation.messages : [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.author?.role !== 'assistant') continue;
    const text = messageText(message);
    if (text) return text;
  }
  return '';
};

exports.messagesToPrompt = (messages = []) => messages.map((message) => {
  const role = String(message?.role || 'user').toUpperCase();

  if (message?.role === 'assistant' && Array.isArray(message?.tool_calls) && message.tool_calls.length) {
    return `ASSISTANT_TOOL_CALLS: ${JSON.stringify(message.tool_calls)}`;
  }

  if (message?.role === 'tool') {
    const callId = typeof message?.tool_call_id === 'string' ? message.tool_call_id : '';
    const content = typeof message?.content === 'string'
      ? message.content
      : JSON.stringify(message?.content ?? '');
    return `TOOL_RESULT ${callId}: ${content}`;
  }

  const content = typeof message?.content === 'string'
    ? message.content
    : JSON.stringify(message?.content ?? '');
  return `${role}: ${content}`;
}).join('\n\n');

exports.makeChatCompletion = ({
  model,
  conversation,
  tools = [],
  created = Math.floor(Date.now() / 1000)
}) => {
  const functionCall = latestFunctionCall(conversation, tools);
  const toolCalls = functionCall ? [functionCall] : [];

  return {
    id: `chatcmpl-zero-${conversation?.current_node || crypto.randomUUID()}`,
    object: 'chat.completion',
    created,
    model,
    ...(conversation?.conversation_id ? { conversation_id: conversation.conversation_id } : {}),
    choices: [{
      index: 0,
      message: toolCalls.length
        ? { role: 'assistant', content: null, tool_calls: toolCalls }
        : { role: 'assistant', content: exports.extractAssistantText(conversation) },
      finish_reason: toolCalls.length ? 'tool_calls' : 'stop'
    }]
  };
};

exports.responseInputToMessages = (input) => {
  if (typeof input === 'string') {
    return input.trim() ? [{ role: 'user', content: input }] : [];
  }
  if (!Array.isArray(input)) return [];

  return input.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    if (item.type === 'message' && typeof item.role === 'string') {
      const content = Array.isArray(item.content)
        ? item.content.map((part) => {
            if (typeof part === 'string') return part;
            if (part && typeof part === 'object' && typeof part.text === 'string') return part.text;
            return '';
          }).join('')
        : (typeof item.content === 'string' ? item.content : '');
      return content ? [{ role: item.role, content }] : [];
    }
    return [];
  });
};

exports.makeResponse = ({
  model,
  conversation,
  createdAt = Math.floor(Date.now() / 1000)
}) => {
  const text = exports.extractAssistantText(conversation);
  const responseId = `resp_zero_${conversation?.current_node || crypto.randomUUID()}`;
  const messageId = `msg_zero_${conversation?.current_node || crypto.randomUUID()}`;

  return {
    id: responseId,
    object: 'response',
    created_at: createdAt,
    status: 'completed',
    error: null,
    incomplete_details: null,
    model,
    ...(conversation?.conversation_id ? { conversation_id: conversation.conversation_id } : {}),
    output: [{
      id: messageId,
      type: 'message',
      status: 'completed',
      role: 'assistant',
      content: [{
        type: 'output_text',
        text,
        annotations: []
      }]
    }],
    output_text: text
  };
};
