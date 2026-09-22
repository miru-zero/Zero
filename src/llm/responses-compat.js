const crypto = require('node:crypto');
const chatCompat = require('./openai-compat');
const toolCompat = require('./tool-compat');

const textFromContent = (content) => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content.map((part) => {
    if (typeof part === 'string') return part;
    if (!part || typeof part !== 'object') return '';
    if (typeof part.text === 'string') return part.text;
    return '';
  }).join('');
};

const outputToText = (output) => {
  if (typeof output === 'string') return output;
  if (output == null) return '';
  try {
    return JSON.stringify(output);
  } catch {
    return String(output);
  }
};

const assistantMessageText = (message) => {
  const parts = Array.isArray(message?.content?.parts) ? message.content.parts : [];
  return parts.map((part) => {
    if (typeof part === 'string') return part;
    if (part && typeof part === 'object' && typeof part.text === 'string') return part.text;
    return '';
  }).join('');
};

exports.makeResponseId = ({ conversationId, currentNode }) => {
  const conversation = conversationId || crypto.randomUUID();
  const node = currentNode || crypto.randomUUID();
  return `resp_zero_${conversation}_${node}`;
};

exports.conversationIdFromResponseId = (responseId) => {
  const match = String(responseId || '').match(
    /^resp_zero_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:_|$)/i
  );
  return match ? match[1] : null;
};

exports.inputToMessages = ({ instructions = null, input } = {}) => {
  const messages = [];

  if (typeof instructions === 'string' && instructions.trim()) {
    messages.push({ role: 'system', content: instructions });
  }

  if (typeof input === 'string') {
    if (input.trim()) messages.push({ role: 'user', content: input });
    return messages;
  }

  if (!Array.isArray(input)) return messages;

  for (const item of input) {
    if (!item || typeof item !== 'object') continue;

    if (item.type === 'function_call_output' && typeof item.call_id === 'string' && item.call_id.trim()) {
      messages.push({
        role: 'tool',
        tool_call_id: item.call_id.trim(),
        content: outputToText(item.output)
      });
      continue;
    }

    if (
      item.type === 'function_call'
      && typeof item.call_id === 'string'
      && item.call_id.trim()
      && typeof item.name === 'string'
      && item.name.trim()
    ) {
      messages.push({
        role: 'assistant',
        content: '',
        tool_calls: [{
          id: item.call_id.trim(),
          type: 'function',
          function: {
            name: item.name.trim(),
            arguments: typeof item.arguments === 'string'
              ? item.arguments
              : JSON.stringify(item.arguments || {})
          }
        }]
      });
      continue;
    }

    const rawRole = typeof item.role === 'string' ? item.role : 'user';
    const role = rawRole === 'developer' ? 'system' : rawRole;
    const content = textFromContent(item.content);
    if (content) messages.push({ role, content });
  }

  return messages;
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
  if (native) return { message, call: native };

  const shim = toolCompat.clientToolCallFromText(
    assistantMessageText(message),
    {
      tools,
      id: message?.id || conversation?.current_node || 'unknown'
    }
  );
  return shim ? { message, call: shim } : null;
};

exports.makeResponse = ({
  model,
  conversation,
  instructions = null,
  previousResponseId = null,
  tools = [],
  toolChoice = 'auto',
  createdAt = Math.floor(Date.now() / 1000)
}) => {
  const id = exports.makeResponseId({
    conversationId: conversation?.conversation_id,
    currentNode: conversation?.current_node
  });

  const functionCall = latestFunctionCall(conversation, tools);
  const text = functionCall ? '' : chatCompat.extractAssistantText(conversation);
  const output = functionCall
    ? [{
        id: `fc_zero_${functionCall.message?.id || crypto.randomUUID()}`,
        type: 'function_call',
        status: 'completed',
        call_id: functionCall.call.id,
        name: functionCall.call.function.name,
        arguments: functionCall.call.function.arguments
      }]
    : [{
        id: `msg_zero_${conversation?.current_node || crypto.randomUUID()}`,
        type: 'message',
        status: 'completed',
        role: 'assistant',
        content: [{
          type: 'output_text',
          text,
          annotations: []
        }]
      }];

  return {
    id,
    object: 'response',
    created_at: createdAt,
    status: 'completed',
    error: null,
    incomplete_details: null,
    instructions,
    model,
    output,
    output_text: text,
    previous_response_id: previousResponseId,
    parallel_tool_calls: true,
    tools: Array.isArray(tools) ? tools : [],
    tool_choice: toolChoice || 'auto',
    metadata: {},
    usage: null
  };
};
