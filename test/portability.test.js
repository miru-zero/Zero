const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const toolsHub = require('../src/hub');
const mcpClient = require('../src/hub/mcp-stdio-client');
const browserBridge = require('../src/providers/chatgpt/browser-bridge');

const repoRoot = path.resolve(__dirname, '..');

test('hub keeps PATH commands bare instead of resolving them under repo root', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-portable-'));
  const config = path.join(dir, 'zero.config.json');
  fs.writeFileSync(config, JSON.stringify({ providers: {
    portable: { type: 'mcp-stdio', command: 'npx', args: ['-y', 'some-mcp'] }
  }}));
  let seen;
  const hub = toolsHub.createHub({
    env: { ZERO_CONFIG_FILE: config },
    clientFactory: (options) => {
      seen = options;
      return { listTools: async () => [], callTool: async () => ({}), close: () => {} };
    }
  });
  await hub.listTools('portable');
  assert.equal(seen.command, 'npx');
  assert.equal(seen.cwd, repoRoot);
  hub.close();
});
test('mcp client enables shell for bare PATH commands on Windows only', () => {
  let seenOptions;
  const spawnFn = (command, args, options) => {
    seenOptions = options;
    const { EventEmitter } = require('node:events');
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { write: () => {} };
    child.exitCode = null;
    child.killed = false;
    child.kill = () => { child.killed = true; };
    return child;
  };
  const client = mcpClient.createClient({ command: 'npx', spawnFn });
  assert.equal(Boolean(seenOptions.shell), process.platform === 'win32');
  client.close();
});

test('runtime and example configs contain no machine-specific absolute drive paths', () => {
  for (const file of ['runtime/zero.config.json', 'config/zero.config.example.json']) {
    const text = fs.readFileSync(path.join(repoRoot, file), 'utf8');
    assert.doesNotMatch(text, /[A-Za-z]:[\\/]/, `${file} contains a machine-specific absolute path`);
    assert.doesNotMatch(text, /Users[\\/][^\\/]+/i, `${file} contains a user-profile path`);
  }
});
test('hub expands {env:NAME} placeholders from the current machine environment', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-env-'));
  const config = path.join(dir, 'zero.config.json');
  fs.writeFileSync(config, JSON.stringify({ providers: {
    portable: { type: 'mcp-stdio', command: 'node', env: { DOTNET_ROOT: '{env:LOCALAPPDATA}/Microsoft/dotnet' } }
  }}));
  let seen;
  const hub = toolsHub.createHub({
    env: { ZERO_CONFIG_FILE: config, LOCALAPPDATA: 'X:/PortableUser' },
    clientFactory: (options) => {
      seen = options;
      return { listTools: async () => [], callTool: async () => ({}), close: () => {} };
    }
  });
  await hub.listTools('portable');
  assert.equal(seen.env.DOTNET_ROOT, 'X:/PortableUser/Microsoft/dotnet');
  hub.close();
});


test('browser bridge resolves Chrome path without a machine-specific absolute literal', () => {
  assert.equal(browserBridge.resolveChromePath({ ZERO_CHROME_PATH: 'X:/portable/chrome.exe' }, () => false, 'win32'), 'X:/portable/chrome.exe');
  assert.equal(browserBridge.resolveChromePath({}, () => false, 'win32'), 'chrome.exe');
});

test('mcp PATH sanitizer does not invent C:\\WINDOWS when Windows root env is absent', () => {
  const env = { PATH: 'C:\\tools\\bin' };
  mcpClient._sanitizePathForNative(env);
  assert.doesNotMatch(env.PATH, /C:\\WINDOWS/i);
});
