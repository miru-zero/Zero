// zero tools hub — ศูนย์กลางเรียก tool ทุก provider (internal + mcp-stdio)
const path = require('node:path');
const registry = require('./registry');
const mcpStdioClient = require('./mcp-stdio-client');

const unknownProvider = (name, config) => Object.assign(
  new Error(`ไม่มี provider "${name}" ใน config (${config.providers ? Object.keys(config.providers).join(', ') : '-'})`),
  { code: 'UNKNOWN_PROVIDER' }
);

exports.createHub = ({ env = process.env, clientFactory } = {}) => {
  const config = registry.loadConfig(env);
  const makeClient = clientFactory || ((options) => mcpStdioClient.createClient(options));
  const clients = new Map();
  const rootDir = path.resolve(__dirname, '../..'); // src/hub → core root
  const mcpRootDir = config.mcpRoot || rootDir;

  // placeholders ทำให้ provider ย้ายที่ได้โดยไม่ต้องแก้ client
  const expandValue = (value, provider = null) => {
    if (typeof value !== 'string') return value;
    let expanded = value.replaceAll('{root}', mcpRootDir.replace(/\\/g, '/'));
    if (config.mcpRoot) expanded = expanded.replaceAll('{mcpRoot}', config.mcpRoot.replace(/\\/g, '/'));
    if (provider?.providerRoot) expanded = expanded.replaceAll('{providerRoot}', provider.providerRoot.replace(/\\/g, '/'));
    return expanded.replace(/\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name) => env[name] || '');
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

  const resolveProviderCommand = (value, provider) => {
    const expanded = expandValue(value, provider);
    if (typeof expanded !== 'string' || !expanded) return expanded;
    if (path.isAbsolute(expanded)) return expanded;
    const baseDir = provider?.providerRoot || rootDir;
    return /[\\/]/.test(expanded) ? path.resolve(baseDir, expanded) : expanded;
  };

  const resolveProviderCwd = (provider) => {
    if (!provider.cwd) return rootDir;
    const expanded = expandValue(provider.cwd, provider);
    if (path.isAbsolute(expanded)) return path.normalize(expanded);
    return path.resolve(provider.providerRoot || rootDir, expanded);
  };

  const internalProviders = new Map();

  const resolveProviderModule = (provider) => {
    const raw = provider.module || (provider.name === 'chatgpt' ? '{root}/src/providers/chatgpt' : null);
    if (!raw) throw Object.assign(new Error('internal provider needs module: ' + provider.name), { code: 'CONFIG_INVALID' });
    const expanded = expandValue(raw, provider);
    return path.isAbsolute(expanded) ? path.normalize(expanded) : path.resolve(provider.providerRoot || rootDir, expanded);
  };

  const getInternalProvider = (provider) => {
    if (!internalProviders.has(provider.name)) {
      internalProviders.set(provider.name, require(resolveProviderModule(provider)));
    }
    return internalProviders.get(provider.name);
  };

  const getMcpClient = (provider) => {
    if (!clients.has(provider.name)) {
      const command = resolveProviderCommand(provider.command, provider);
      const args = (provider.args || []).map((value) => expandValue(value, provider));
      const env = Object.fromEntries(Object.entries(provider.env || {}).map(([key, value]) => [key, expandValue(value, provider)]));
      clients.set(provider.name, makeClient({
        command,
        args,
        env,
        cwd: resolveProviderCwd(provider),
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
      command: provider.command || null,
      description: provider.description || ''
    })),
    listTools: async (name, context = {}) => {
      const provider = requireProvider(name);
      if (provider.type === 'internal') return getInternalProvider(provider).listTools(context);
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
      if (provider.type === 'internal') return getInternalProvider(provider).callTool(toolName, toolArgs, context);
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
