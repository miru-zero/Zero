const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const mcpClient = require('../src/hub/mcp-stdio-client');
const toolsHub = require('../src/hub');

const FIXTURE = path.resolve(__dirname, '../test-fixtures/mcp-stdio-server.js');
const spawnFixture = () => ({ command: process.execPath, args: [FIXTURE] });

test('mcp-stdio client: initialize + listTools + callTool', async () => {
  const client = mcpClient.createClient(spawnFixture());
  const init = await client.initialize();
  assert.equal(init.serverInfo.name, 'fixture');
  const tools = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name), ['ping', 'echo']);
  const pong = await client.callTool('ping');
  assert.equal(pong.content[0].text, 'pong');
  const echo = await client.callTool('echo', { hello: 'zero' });
  assert.equal(echo.content[0].text, '{"hello":"zero"}');
  client.close();
});

test('mcp-stdio client: config env เป็น fallback ไม่ทับ env ที่ shell มีอยู่', async () => {
  const client = mcpClient.createClient({
    ...spawnFixture(),
    env: { PATH: 'SHOULD_NOT_WIN', ZERO_TEST_FALLBACK_VAR: 'from-config' }
  });
  await client.initialize();
  assert.notEqual(process.env.PATH, 'SHOULD_NOT_WIN');
  client.close();
});

test('mcp-stdio client: callTool error จาก server กลายเป็น MCP_ERROR', async () => {
  const client = mcpClient.createClient(spawnFixture());
  await assert.rejects(
    client.callTool('nope'),
    (error) => error.code === 'MCP_ERROR' && /unknown tool/.test(error.message)
  );
  client.close();
});

test('sanitizePath: POSIX form ถูกแปลง + เติม PowerShell dir', () => {
  const env = { PATH: '/mingw64/bin:/usr/bin:/c/WINDOWS/System32:/c/WINDOWS', SYSTEMROOT: 'C:\\WINDOWS' };
  mcpClient._sanitizePathForNative(env);
  const entries = env.PATH.split(';');
  assert.ok(entries.includes('C:\\WINDOWS\\System32'));
  assert.ok(entries.includes('C:\\WINDOWS'));
  assert.ok(entries.some((e) => e.toLowerCase() === 'c:\\windows\\system32\\windowspowershell\\v1.0'));
  assert.ok(!env.PATH.includes('/mingw'));
});

test('sanitizePath: Windows form (bash แปลงให้แล้ว) ก็ยังเติม PowerShell dir ที่ขาด', () => {
  const env = { PATH: 'C:\\tools\\git\\bin;C:\\WINDOWS\\System32;C:\\WINDOWS', SYSTEMROOT: 'C:\\WINDOWS' };
  mcpClient._sanitizePathForNative(env);
  const entries = env.PATH.split(';');
  assert.equal(entries[0], 'C:\\tools\\git\\bin');
  assert.equal(entries.filter((e) => e.toLowerCase() === 'c:\\windows\\system32').length, 1);
  assert.ok(entries.some((e) => e.toLowerCase() === 'c:\\windows\\system32\\windowspowershell\\v1.0'));
});

test('mcp-stdio client: spawn command มั่ว = error ไม่แขวน', async () => {
  const client = mcpClient.createClient({ command: 'zero-definitely-not-a-real-binary-xyz', timeoutMs: 3000 });
  await assert.rejects(client.listTools());
  client.close();
});

test('hub: listProviders/listTools/callTool ผ่าน clientFactory ปลอม', async () => {
  const calls = [];
  const hub = toolsHub.createHub({
    env: { ZERO_CONFIG_FILE: path.resolve(__dirname, '../test-fixtures/zero.config.test.json') },
    clientFactory: (options) => {
      calls.push(options);
      return {
        listTools: async () => [{ name: 'ping', description: 'pong' }],
        callTool: async (name, args) => ({ ok: true, name, args }),
        close: () => {}
      };
    }
  });
  const providers = hub.listProviders();
  assert.deepEqual(providers.map((p) => p.name).sort(), ['chatgpt', 'fixturemcp']);
  const tools = await hub.listTools('fixturemcp');
  assert.deepEqual(tools, [{ name: 'ping', description: 'pong', inputSchema: null }]);
  const result = await hub.callTool('fixturemcp', 'ping', { a: 1 });
  assert.deepEqual(result, { ok: true, name: 'ping', args: { a: 1 } });
  // mcp command ต้อง resolve เป็น absolute จาก repo root
  assert.equal(path.isAbsolute(calls[0].command), true);
  hub.close();
});

test('hub: {root} ใน env ถูก expand + client ได้ cwd = repo root', async () => {
  const calls = [];
  const hub = toolsHub.createHub({
    env: { ZERO_CONFIG_FILE: path.resolve(__dirname, '../test-fixtures/zero.config.test.json') },
    clientFactory: (options) => {
      calls.push(options);
      return { listTools: async () => [], callTool: async () => ({}), close: () => {} };
    }
  });
  await hub.listTools('fixturemcp');
  const repoRoot = path.resolve(__dirname, '..');
  assert.equal(calls[0].cwd, repoRoot);
  assert.equal(calls[0].env.ZERO_TEST_ROOT_VAR, `${repoRoot.replace(/\\/g, '/')}/.zero/screenshots`);
  assert.ok(!calls[0].env.ZERO_TEST_ROOT_VAR.includes('{root}'));
  hub.close();
});

test('hub: listTools ของ mcp-stdio ส่ง inputSchema ผ่านมาด้วย', async () => {
  const schema = {
    type: 'object',
    properties: { monitorIndex: { type: 'integer' } },
    required: ['monitorIndex']
  };
  const hub = toolsHub.createHub({
    env: { ZERO_CONFIG_FILE: path.resolve(__dirname, '../test-fixtures/zero.config.test.json') },
    clientFactory: () => ({
      listTools: async () => [{ name: 'screenshot', description: 'จับภาพจอ', inputSchema: schema }],
      callTool: async () => ({}),
      close: () => {}
    })
  });
  const tools = await hub.listTools('fixturemcp');
  assert.deepEqual(tools[0].inputSchema, schema);
  hub.close();
});

test('mcp-stdio client: ส่ง cwd เข้า spawn เมื่อระบุ / ไม่ส่งเมื่อไม่ระบุ', () => {
  const seen = [];
  const spawnFn = () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { write: () => {} };
    child.exitCode = null;
    child.killed = false;
    child.kill = () => { child.killed = true; };
    return child;
  };
  const capture = (command, args, options) => { seen.push(options); return spawnFn(); };
  const withCwd = mcpClient.createClient({ command: 'x.exe', cwd: 'M:\\repo', spawnFn: capture });
  const withoutCwd = mcpClient.createClient({ command: 'x.exe', spawnFn: capture });
  assert.equal(seen[0].cwd, 'M:\\repo');
  assert.equal('cwd' in seen[1], false);
  withCwd.close();
  withoutCwd.close();
});

test('hub: provider ไม่มีใน config = UNKNOWN_PROVIDER', async () => {
  const hub = toolsHub.createHub({
    env: { ZERO_CONFIG_FILE: path.resolve(__dirname, '../test-fixtures/zero.config.test.json') }
  });
  await assert.rejects(hub.listTools('ghost'), (error) => error.code === 'UNKNOWN_PROVIDER');
  assert.equal(hub.getProvider('ghost'), null);
  hub.close();
});

test('hub: internal provider ลิสต์ tools ของ chatgpt ได้โดยไม่ต้อง spawn', async () => {
  const hub = toolsHub.createHub({
    env: { ZERO_CONFIG_FILE: path.resolve(__dirname, '../test-fixtures/zero.config.test.json') }
  });
  const tools = await hub.listTools('chatgpt');
  const names = tools.map((t) => t.name);
  for (const expected of ['conversations_list', 'conversation_get', 'conversation_new', 'conversation_send', 'project_conversations', 'connectors_list', 'agent_spawn', 'agent_return']) {
    assert.ok(names.includes(expected), `missing ${expected}`);
  }
  hub.close();
});

test('registry: config มั่ว = CONFIG_INVALID', async () => {
  assert.throws(
    () => toolsHub.createHub({ env: { ZERO_CONFIG_FILE: path.resolve(__dirname, '../test-fixtures/zero.config.broken.json') } }),
    (error) => error.code === 'CONFIG_INVALID'
  );
});
