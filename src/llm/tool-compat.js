const parseJsonObject = (value) => {
  if (!value) return null;
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const toolNameFromPath = (path) => {
  if (typeof path !== 'string') return null;
  const parts = path.split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : null;
};

const functionSpec = (tool) => {
  if (!tool || tool.type !== 'function') return null;
  const value = tool.function && typeof tool.function === 'object'
    ? tool.function
    : tool;
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  if (!name) return null;
  return {
    name,
    description: typeof value.description === 'string' ? value.description : '',
    parameters: value.parameters && typeof value.parameters === 'object'
      ? value.parameters
      : { type: 'object', properties: {} },
    ...(value.strict !== undefined ? { strict: Boolean(value.strict) } : {})
  };
};

exports.toolsToLocalFunctionNames = (tools = []) => {
  if (!Array.isArray(tools)) return [];
  const names = [];
  for (const tool of tools) {
    const spec = functionSpec(tool);
    if (!spec) continue;
    if (!names.includes(spec.name)) names.push(spec.name);
  }
  return names;
};

exports.clientToolInstructions = (tools = []) => {
  const specs = Array.isArray(tools)
    ? tools.map(functionSpec).filter(Boolean)
    : [];
  if (!specs.length) return '';

  return [
    'ZERO_CLIENT_TOOLS_V1',
    'The client can execute the functions listed below. These are client-side functions, not ChatGPT built-in tools.',
    'When a function is needed, reply with exactly one tool-call marker and no other prose:',
    '<ZERO_CLIENT_TOOL_CALL>{"name":"FUNCTION_NAME","arguments":{}}</ZERO_CLIENT_TOOL_CALL>',
    'The arguments value must be a JSON object that follows the selected function parameters schema.',
    'Use only a function name from the list below. Do not claim a listed client function is unavailable.',
    'If no function is needed, answer normally and do not emit a ZERO_CLIENT_TOOL_CALL marker.',
    'AVAILABLE_CLIENT_FUNCTIONS_JSON:',
    JSON.stringify(specs)
  ].join('\n');
};

exports.clientToolCallFromText = (text, { tools = [], id = 'unknown' } = {}) => {
  if (typeof text !== 'string') return null;
  const match = text.trim().match(
    /^<ZERO_CLIENT_TOOL_CALL>([\s\S]+)<\/ZERO_CLIENT_TOOL_CALL>$/
  );
  if (!match) return null;

  const payload = parseJsonObject(match[1]);
  if (!payload || typeof payload.name !== 'string') return null;

  const allowed = new Set(
    (Array.isArray(tools) ? tools : [])
      .map(functionSpec)
      .filter(Boolean)
      .map((item) => item.name)
  );
  const name = payload.name.trim();
  if (!allowed.has(name)) return null;

  const args = payload.arguments && typeof payload.arguments === 'object' && !Array.isArray(payload.arguments)
    ? payload.arguments
    : parseJsonObject(payload.arguments);
  if (!args) return null;

  return {
    id: `call_zero_client_${id || 'unknown'}`,
    type: 'function',
    function: {
      name,
      arguments: JSON.stringify(args)
    }
  };
};

exports.clientToolResultToPrompt = (message) => {
  if (message?.role !== 'tool') return null;
  const callId = typeof message.tool_call_id === 'string' ? message.tool_call_id.trim() : '';
  if (!callId) return null;
  const content = typeof message.content === 'string'
    ? message.content
    : JSON.stringify(message.content ?? '');
  return [
    'ZERO_CLIENT_TOOL_RESULT_V1',
    `tool_call_id: ${callId}`,
    `output: ${content}`,
    'Continue the previous user task using this tool result.',
    'If another listed client function is needed, emit the ZERO_CLIENT_TOOL_CALL marker again; otherwise answer normally.'
  ].join('\n');
};

exports.nativeInvocationToFunctionCall = (message) => {
  if (message?.author?.role !== 'assistant') return null;
  if (message?.recipient !== 'api_tool.call_tool') return null;

  const contentPayload = parseJsonObject(message?.content?.text);
  const path = contentPayload?.path || message?.metadata?.connector_tool_name || null;
  const name = toolNameFromPath(path);
  if (!name) return null;

  const metadataArgs = parseJsonObject(message?.metadata?.connector_tool_payload);
  const contentArgs = parseJsonObject(contentPayload?.args);
  const args = metadataArgs || contentArgs || {};

  return {
    id: `call_zero_${message?.id || 'unknown'}`,
    type: 'function',
    function: {
      name,
      arguments: JSON.stringify(args)
    }
  };
};
