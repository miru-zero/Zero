'use strict';

const toolsHub = require('../hub');

const inputSchema = (properties, required = []) => ({
  type: 'object',
  properties,
  ...(required.length ? { required } : {}),
  additionalProperties: false
});

const devicesTool = (name, description, properties, required = []) => ({
  name: `zero.devices.${name}`,
  description: `${description} Routes to provider devices/${name}.`,
  inputSchema: inputSchema(properties, required)
});

const commandTool = (name, description, properties, required = []) => ({
  name: `zero.command.${name}`,
  description: `${description} Routes to provider command/${name}.`,
  inputSchema: inputSchema(properties, required)
});

const COMMAND_TOOL_NAMES = [
  'readFile',
  'readFiles',
  'writeFile',
  'replaceFile',
  'createDirectory',
  'deleteFile',
  'globFiles',
  'grepFiles',
  'listDirectory',
  'getFileInfo'
];
const COMMAND_TOOL_DEFS = [
  commandTool('readFile', 'Read a text file with line numbers.', {
    path: { type: 'string' },
    offset: { type: 'integer', default: 0 },
    length: { type: 'integer', minimum: 1, maximum: 1000, default: 200 }
  }, ['path']),
  commandTool('readFiles', 'Read multiple text files with line numbers. Accept paths[] or files[].', {
    paths: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 50 },
    files: {
      type: 'array', minItems: 1, maxItems: 50,
      items: inputSchema({
        path: { type: 'string' },
        offset: { type: 'integer' },
        length: { type: 'integer', minimum: 1, maximum: 1000 }
      }, ['path'])
    },
    offset: { type: 'integer', default: 0 },
    length: { type: 'integer', minimum: 1, maximum: 1000, default: 200 }
  }),
  commandTool('writeFile', 'Write or append text content to a file.', {
    path: { type: 'string' },
    content: { type: 'string' },
    mode: { type: 'string', enum: ['overwrite', 'append'], default: 'overwrite' }
  }, ['path', 'content']),
  commandTool('replaceFile', 'Replace exact text inside a text file.', {
    path: { type: 'string' },
    oldString: { type: 'string' },
    newString: { type: 'string' },
    expectedReplacements: { type: 'integer', minimum: 0 }
  }, ['path', 'oldString', 'newString']),
  commandTool('createDirectory', 'Create a directory under an allowed root.', {
    path: { type: 'string' }
  }, ['path']),
  commandTool('deleteFile', 'Delete one file under an allowed root.', {
    path: { type: 'string' }
  }, ['path'])
];
COMMAND_TOOL_DEFS.push(
  commandTool('globFiles', 'Find files by wildcard pattern.', {
    path: { type: 'string' },
    pattern: { type: 'string' },
    maxResults: { type: 'integer', minimum: 1, maximum: 1000, default: 200 }
  }, ['path', 'pattern']),
  commandTool('grepFiles', 'Search text content in files.', {
    path: { type: 'string' },
    pattern: { type: 'string' },
    literal: { type: 'boolean', default: false },
    filePattern: { type: 'string' },
    maxResults: { type: 'integer', minimum: 1, maximum: 1000, default: 200 }
  }, ['path', 'pattern']),
  commandTool('listDirectory', 'List files and directories.', {
    path: { type: 'string' },
    depth: { type: 'integer', minimum: 1, maximum: 5, default: 2 }
  }, ['path']),
  commandTool('getFileInfo', 'Get file or directory metadata.', {
    path: { type: 'string' }
  }, ['path'])
);
const DEVICES_TOOL_NAMES = ['list', 'status', 'heartbeat', 'exec'];
const DEVICES_TOOL_DEFS = [
  devicesTool('list', 'List paired Zero devices.', {
    onlineOnly: { type: 'boolean', default: false }
  }),
  devicesTool('status', 'Get one Zero device by device_id or name.', {
    device_id: { type: 'string' },
    name: { type: 'string' }
  }),
  devicesTool('heartbeat', 'Summarize latest heartbeat state for one Zero device.', {
    device_id: { type: 'string' },
    name: { type: 'string' }
  }),
  devicesTool('exec', 'Queue a safe command tool on one Zero agent device and wait for the result.', {
    device_id: { type: 'string' },
    name: { type: 'string' },
    tool: { type: 'string' },
    arguments: { type: 'object', additionalProperties: true },
    waitMs: { type: 'integer', minimum: 0, maximum: 60000, default: 15000 }
  }, ['tool'])
];
const TOOL_DEFS = [
  {
    name: 'getChatGPTConversation',
    description: 'Read one ChatGPT conversation through Zero by conversation id.',
    inputSchema: inputSchema({
      conversation_id: { type: 'string', description: 'ChatGPT conversation id' },
      limit: { type: 'integer', minimum: 1, maximum: 200, description: 'Optional max message count' }
    }, ['conversation_id'])
  },
  {
    name: 'listChatGPTConversations',
    description: 'List ChatGPT conversations through the Zero ChatGPT provider.',
    inputSchema: inputSchema({
      limit: { type: 'integer', minimum: 1, maximum: 100 },
      offset: { type: 'integer', minimum: 0 }
    })
  },
  {
    name: 'listZeroTools',
    description: 'List Zero providers and tools available through zero.miru.work.',
    inputSchema: inputSchema({ provider: { type: 'string' }, schemas: { type: 'boolean' } })
  },
  ...COMMAND_TOOL_DEFS,
  ...DEVICES_TOOL_DEFS
];
TOOL_DEFS.push({
  name: 'callZeroTool',
  description: 'Call a Zero provider tool. Use only when no fixed Zero MCP tool fits.',
  inputSchema: inputSchema({
    provider: { type: 'string' },
    tool: { type: 'string' },
    arguments: { type: 'object', additionalProperties: true }
  }, ['provider', 'tool'])
});

const ok = (id, result) => ({ jsonrpc: '2.0', id, result });
const fail = (id, code, message, data = undefined) => ({
  jsonrpc: '2.0',
  id: id ?? null,
  error: { code, message, ...(data === undefined ? {} : { data }) }
});

const trace = (env, event, payload = {}) => {
  if (!env || env.ZERO_TRACE !== '1') return;
  console.error(JSON.stringify({ at: new Date().toISOString(), event, ...payload }));
};

const contentResult = (value) => ({
  content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  structuredContent: value
});

const mcpTools = () => TOOL_DEFS.map((tool) => ({ ...tool }));
const callHubTool = async ({ createHub, env, context, provider, tool, args }) => {
  const hub = (createHub || toolsHub.createHub)({ env });
  try {
    return await hub.callTool(provider, tool, args || {}, context || {});
  } finally {
    if (hub && typeof hub.close === 'function') hub.close();
  }
};

const devicesToolName = (name) => {
  if (!name || !name.startsWith('zero.devices.')) return null;
  const tool = name.slice('zero.devices.'.length);
  return DEVICES_TOOL_NAMES.includes(tool) ? tool : null;
};

const commandToolName = (name) => {
  if (!name || !name.startsWith('zero.command.')) return null;
  const tool = name.slice('zero.command.'.length);
  return COMMAND_TOOL_NAMES.includes(tool) ? tool : null;
};

const callNamedTool = async (name, args, options) => {
  const devicesName = devicesToolName(name);
  if (devicesName) {
    return callHubTool({ ...options, provider: 'devices', tool: devicesName, args });
  }

  const commandName = commandToolName(name);
  if (commandName) {
    return callHubTool({ ...options, provider: 'command', tool: commandName, args });
  }

  if (name === 'getChatGPTConversation') {
    return callHubTool({
      ...options,
      provider: 'chatgpt',
      tool: 'conversation_get',
      args: {
        conversation_id: args.conversation_id,
        ...(args.limit ? { limit: args.limit } : {})
      }
    });
  }

  if (name === 'listChatGPTConversations') {
    return callHubTool({ ...options, provider: 'chatgpt', tool: 'conversations_list', args });
  }

  if (name === 'listZeroTools') {
    return options.collectTools({
      createHub: options.createHub,
      env: options.env,
      providerName: args.provider || null,
      includeSchemas: args.schemas === true
    });
  }
  if (name === 'callZeroTool') {
    return callHubTool({
      ...options,
      provider: args.provider,
      tool: args.tool,
      args: args.arguments || {}
    });
  }

  const error = new Error('unknown MCP tool: ' + name);
  error.code = 'UNKNOWN_TOOL';
  throw error;
};

const initializeResult = (params = {}) => ({
  protocolVersion: params.protocolVersion || '2025-06-18',
  capabilities: { tools: { listChanged: false } },
  serverInfo: { name: 'zero-mcp', version: '0.1.0' }
});

const handleMessage = async (message, options) => {
  const id = Object.prototype.hasOwnProperty.call(message, 'id') ? message.id : null;
  const method = message.method;
  const params = message.params || {};

  if (!method && id === null) return null;
  if (method === 'initialize') return ok(id, initializeResult(params));
  if (method === 'notifications/initialized') return null;
  if (method === 'ping') return ok(id, {});
  if (method === 'tools/list') return ok(id, { tools: mcpTools() });

  if (method === 'tools/call') {
    const name = params.name;
    const args = params.arguments && typeof params.arguments === 'object'
      ? params.arguments
      : {};
    try {
      trace(options?.env, 'mcp.tools.call', { tool: name, args });
      const result = await callNamedTool(name, args, options || {});
      return ok(id, contentResult(result));
    } catch (error) {
      return fail(id, -32000, error.message || String(error), { code: error.code || 'TOOL_FAILED' });
    }
  }

  return fail(id, -32601, 'method not found: ' + method);
};

const mcp = {
  tools: mcpTools,
  handle: async (body, options) => {
    if (!body || typeof body !== 'object') {
      return fail(null, -32600, 'invalid request');
    }

    if (Array.isArray(body)) {
      const replies = [];
      for (const item of body) {
        const reply = await handleMessage(item, options || {});
        if (reply) replies.push(reply);
      }
      return replies.length ? replies : null;
    }

    return handleMessage(body, options || {});
  }
};

Object.assign(exports, mcp);
