const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const registry = require('../src/hub/registry');
const toolsHub = require('../src/hub');

test('registry loads provider manifests from ZERO_MCP_ROOT', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-mcp-root-'));
  const configFile = path.join(dir, 'zero.config.json');
  const mcpRoot = path.join(dir, 'mcp');
  const providerRoot = path.join(mcpRoot, 'providers', 'fixture');
  fs.mkdirSync(providerRoot, { recursive: true });
  fs.writeFileSync(configFile, JSON.stringify({ providers: { chatgpt: { type: 'internal' } } }));
  fs.writeFileSync(path.join(providerRoot, 'provider.json'), JSON.stringify({ type: 'mcp-stdio', command: 'node', args: ['server.js'] }));

  const loaded = registry.loadConfig({ ZERO_CONFIG_FILE: configFile, ZERO_MCP_ROOT: mcpRoot });
  assert.deepEqual(Object.keys(loaded.providers).sort(), ['chatgpt', 'fixture']);
  assert.equal(loaded.providers.fixture.providerRoot, providerRoot);
  assert.equal(loaded.mcpRoot, mcpRoot);

  fs.rmSync(dir, { recursive: true, force: true });
});
test('registry accepts mcpRoot-only config when manifests provide providers', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-mcp-config-'));
  const mcpRoot = path.join(dir, 'mcp');
  const providerRoot = path.join(mcpRoot, 'providers', 'chatgpt');
  fs.mkdirSync(providerRoot, { recursive: true });
  const configFile = path.join(dir, 'zero.config.json');
  fs.writeFileSync(configFile, JSON.stringify({ mcpRoot }));
  fs.writeFileSync(path.join(providerRoot, 'provider.json'), JSON.stringify({ type: 'internal' }));

  const loaded = registry.loadConfig({ ZERO_CONFIG_FILE: configFile });
  assert.equal(loaded.providers.chatgpt.type, 'internal');
  assert.equal(loaded.mcpRoot, mcpRoot);

  fs.rmSync(dir, { recursive: true, force: true });
});
test('hub expands providerRoot and honors provider cwd', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-provider-root-'));
  const mcpRoot = path.join(dir, 'mcp');
  const providerRoot = path.join(mcpRoot, 'providers', 'fixture');
  fs.mkdirSync(providerRoot, { recursive: true });
  const configFile = path.join(dir, 'zero.config.json');
  fs.writeFileSync(configFile, JSON.stringify({ mcpRoot }));
  fs.writeFileSync(path.join(providerRoot, 'provider.json'), JSON.stringify({ type: 'mcp-stdio', command: 'node', args: ['{providerRoot}/server.js'], cwd: '{providerRoot}' }));
  const calls = [];
  const hub = toolsHub.createHub({ env: { ZERO_CONFIG_FILE: configFile }, clientFactory: (options) => {
    calls.push(options);
    return { listTools: async () => [], callTool: async () => ({}), close: () => {} };
  } });
  await hub.listTools('fixture');
  assert.equal(calls[0].args[0], `${providerRoot.replace(/\\/g, '/')}/server.js`);
  assert.equal(calls[0].cwd, providerRoot);
  hub.close();
  fs.rmSync(dir, { recursive: true, force: true });
});