// zero tools hub — ศูนย์กลางเรียก tool ทุก provider (internal + mcp-stdio)
const path = require('node:path');
const registry = require('./registry');
const mcpStdioClient = require('./mcp-stdio-client');
const chatgptProvider = require('../providers/chatgpt');

const unknownProvider = (name, config) => Object.assign(
  new Error(`ไม่มี provider "${name}" ใน config (${config.providers ? Object.keys(config.providers).join(', ') : '-'})`),
  { code: 'UNKNOWN_PROVIDER' }
);

exports.createHub = ({ env = process.env, clientFactory } = {}) => {
  const config = registry.loadConfig(env);
  const makeClient = clientFactory || ((options) => mcpStdioClient.createClient(options));
  const clients = new Map();
  const rootDir = path.resolve(__dirname, '../..'); // src/hub → repo root

  // {root} = repo root — ให้ config เขียน path/env แบบไม่ฟิกค่าตายตัว ย้ายเครื่องไม่พัง
  const expandRoot = (value) => {
    if (typeof value !== 'string') return value;
    const withRoot = value.replaceAll('{root}', rootDir.replace(/\\/g, '/'));
    return withRoot.replace(/\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name) => env[name] || '');
  };

  const getProvider = (name) => {
    const provider = config.providers[name];
    return provider ? { name, ...provider } : null;
  };

  const requireProvider = (name) => {
    const provider = getProvider(name);
    if (!provider) throw unknownProvider(name, config);
    return provider;
  };

  const resolveProviderCommand = (value) => {
    const expanded = expandRoot(value);
    if (typeof expanded !== 'string' || !expanded) return expanded;
    if (path.isAbsolute(expanded)) return expanded;
    return /[\\/]/.test(expanded) ? path.resolve(rootDir, expanded) : expanded;
  };

  const getMcpClient = (provider) => {
    if (!clients.has(provider.name)) {
      const command = resolveProviderCommand(provider.command);
      const args = (provider.args || []).map(expandRoot);
      const env = Object.fromEntries(Object.entries(provider.env || {}).map(([key, value]) => [key, expandRoot(value)]));
      clients.set(provider.name, makeClient({
        command,
        args,
        env,
        cwd: rootDir, // ล็อก cwd ของ child ให้นิ่ง ไม่ขึ้นกับที่ยืนรัน zero (เช่น screenshot default dir)
        timeoutMs: provider.timeoutMs || 60000
      }));
    }
    return clients.get(provider.name);
  };

  const hub = {
    configFile: config.file,
    getProvider,
    listProviders: () => Object.entries(config.providers).map(([name, provider]) => ({
      name,
      type: provider.type || 'unknown',
      command: provider.command || null
    })),
    listTools: async (name, context = {}) => {
      const provider = requireProvider(name);
      if (provider.type === 'internal') return chatgptProvider.listTools();
      if (provider.type === 'mcp-stdio') {
        const tools = await getMcpClient(provider).listTools();
        return tools.map((tool) => ({
          name: tool.name,
          description: tool.description || '',
          inputSchema: tool.inputSchema || tool.input_schema || null
        }));
      }
      throw Object.assign(new Error(`provider type "${provider.type}" ยังไม่รองรับ`), { code: 'UNKNOWN_PROVIDER_TYPE' });
    },
    callTool: async (name, toolName, toolArgs = {}, context = {}) => {
      const provider = requireProvider(name);
      if (provider.type === 'internal') return chatgptProvider.callTool(toolName, toolArgs, context);
      if (provider.type === 'mcp-stdio') return getMcpClient(provider).callTool(toolName, toolArgs);
      throw Object.assign(new Error(`provider type "${provider.type}" ยังไม่รองรับ`), { code: 'UNKNOWN_PROVIDER_TYPE' });
    },
    close: () => {
      for (const client of clients.values()) client.close();
      clients.clear();
    }
  };
  return hub;
};
