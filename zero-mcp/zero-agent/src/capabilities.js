'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const localTools = require('./local-tools');

const defaultMcpRoot = () => path.resolve(__dirname, '../..');
const mcpRoot = (env = process.env) => path.resolve(env.ZERO_MCP_ROOT || defaultMcpRoot());
const providersDir = (env = process.env) => path.join(mcpRoot(env), 'providers');

const readManifest = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    return { error: error.message };
  }
};

const manifestProviders = (env = process.env) => {
  const dir = providersDir(env);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((item) => item.isDirectory())
    .map((item) => {
      const root = path.join(dir, item.name);
      const manifestFile = path.join(root, 'provider.json');
      const manifest = fs.existsSync(manifestFile) ? readManifest(manifestFile) : {};
      return {
        name: item.name,
        type: manifest.type || 'unknown',
        description: manifest.description || '',
        providerRoot: root,
        manifestFile,
        manifestError: manifest.error || null,
        module: manifest.module || null,
        command: manifest.command || null,
        args: manifest.args || []
      };
    });
};

const safeInternalTools = (provider) => {
  if (!provider.module) return [];
  const modulePath = provider.module.replaceAll('{providerRoot}', provider.providerRoot.replace(/\\/g, '/'));
  const resolved = path.resolve(modulePath);
  try {
    const runtime = require(resolved);
    if (typeof runtime.listTools !== 'function') return [];
    return runtime.listTools({}).map((tool) => ({
      name: tool.name,
      description: tool.description || '',
      inputSchema: tool.inputSchema || null
    }));
  } catch (error) {
    return [{ name: '__scan_error__', description: error.message, inputSchema: null }];
  }
};
const builtInLocalProvider = () => ({
  name: 'zero-agent-local',
  type: 'internal',
  description: 'Built-in safe local filesystem tools exposed by zero-agent.',
  status: 'present',
  tools: localTools.listTools(),
  tool_count: localTools.listTools().length
});

const buildCapabilities = (env = process.env) => {
  const providers = [builtInLocalProvider(), ...manifestProviders(env).map((provider) => {
    const tools = provider.type === 'internal' ? safeInternalTools(provider) : [];
    return {
      name: provider.name,
      type: provider.type,
      description: provider.description,
      status: provider.manifestError ? 'invalid' : 'present',
      tools,
      tool_count: tools.length,
      mcp_stdio_live_scan: provider.type === 'mcp-stdio' ? false : undefined
    };
  })];
  const payload = {
    agent_version: require('../package.json').version,
    mcp_root: mcpRoot(env),
    providers
  };
  payload.capability_hash = crypto
    .createHash('sha256')
    .update(JSON.stringify(payload.providers))
    .digest('hex');
  return payload;
};

const capabilities = { mcpRoot, providersDir, manifestProviders, buildCapabilities };
Object.assign(exports, capabilities);
