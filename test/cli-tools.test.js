const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cli = require('../src/cli');

const makeJwt = (exp) => {
  const enc = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
  return `${enc({ alg: 'none' })}.${enc({ exp })}.x`;
};

const setup = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-cli-tools-'));
  const sessionFile = path.join(dir, 'session.json');
  fs.writeFileSync(sessionFile, JSON.stringify({ headers: { Cookie: 'a=b' } }));
  const env = {
    ZERO_CHATGPT_ACCESS_TOKEN: makeJwt(Math.floor(Date.now() / 1000) + 120),
    ZERO_CHATGPT_SESSION_FILE: sessionFile,
    ZERO_CONFIG_FILE: path.join(dir, 'zero.config.json')
  };
  fs.writeFileSync(env.ZERO_CONFIG_FILE, JSON.stringify({
    providers: {
      chatgpt: { type: 'internal' },
      fakemcp: { type: 'mcp-stdio', command: 'x/y.exe' }
    }
  }));
  const output = { text: '', write(value) { this.text += value; } };
  const fakeHub = {
    configFile: env.ZERO_CONFIG_FILE,
    getProvider: (name) => (name === 'chatgpt' ? { name, type: 'internal' } : name === 'fakemcp' ? { name, type: 'mcp-stdio', command: 'x/y.exe' } : null),
    listProviders: () => [{ name: 'chatgpt', type: 'internal', command: null }, { name: 'fakemcp', type: 'mcp-stdio', command: 'x/y.exe' }],
    listTools: async () => [{ name: 'ping', description: 'pong' }],
    callTool: async (provider, tool, args) => ({ provider, tool, args }),
    close: () => {}
  };
  return { dir, env, output, fakeHub, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
};

test('CLI tools: ลิสต์ provider ไม่ต้องใช้ auth', async () => {
  const ctx = setup();
  const envNoAuth = { ZERO_CONFIG_FILE: ctx.env.ZERO_CONFIG_FILE };
  const result = await cli.run(['tools'], envNoAuth, ctx.output, {
    createHub: () => ctx.fakeHub
  });
  assert.equal(result.exitCode, 0);
  assert.match(ctx.output.text, /providers=2/);
  assert.match(ctx.output.text, /chatgpt  type=internal/);
  assert.match(ctx.output.text, /fakemcp  type=mcp-stdio  command=x\/y\.exe/);
  ctx.cleanup();
});

test('CLI tools <provider>: ลิสต์ tools ของ mcp provider ไม่ต้อง auth', async () => {
  const ctx = setup();
  const result = await cli.run(['fakemcp'], {}, ctx.output, {
    createHub: () => ctx.fakeHub
  });
  assert.equal(result.exitCode, 0);
  assert.match(ctx.output.text, /provider=fakemcp type=mcp-stdio tools=1/);
  assert.match(ctx.output.text, /ping  — pong/);
  ctx.cleanup();
});

test('CLI tools <provider>: แสดง args + required (*) จาก inputSchema', async () => {
  const ctx = setup();
  const hubWithSchema = {
    ...ctx.fakeHub,
    listTools: async () => [{
      name: 'screenshot',
      description: 'จับภาพจอ',
      inputSchema: {
        type: 'object',
        properties: { monitorIndex: { type: 'integer' }, savePath: { type: 'string' } },
        required: ['monitorIndex']
      }
    }]
  };
  const result = await cli.run(['fakemcp'], {}, ctx.output, {
    createHub: () => hubWithSchema
  });
  assert.equal(result.exitCode, 0);
  assert.match(ctx.output.text, /args: monitorIndex:integer\*, savePath:string  \(\* = required\)/);
  ctx.cleanup();
});

test('CLI tools <provider> call: ส่ง json args ไปหา hub', async () => {
  const ctx = setup();
  let received = null;
  const result = await cli.run(['fakemcp', 'call', 'ping', '{"n":2}'], {}, ctx.output, {
    createHub: () => ctx.fakeHub,
    callTool: async (provider, tool, args, context) => {
      received = { provider, tool, args, context };
      return { ok: true };
    }
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(received.args, { n: 2 });
  assert.deepEqual(received.context, {});
  assert.match(ctx.output.text, /"ok": true/);
  ctx.cleanup();
});

test('CLI tools call: json พัง = exitCode 65', async () => {
  const ctx = setup();
  const result = await cli.run(['fakemcp', 'call', 'ping', '{broken'], {}, ctx.output, {
    createHub: () => ctx.fakeHub
  });
  assert.equal(result.exitCode, 65);
  assert.match(ctx.output.text, /error=INVALID_JSON/);
  ctx.cleanup();
});

test('CLI tools: provider ไม่มี = exitCode 71', async () => {
  const ctx = setup();
  const result = await cli.run(['ghost'], {}, ctx.output, {
    createHub: () => ctx.fakeHub
  });
  assert.equal(result.exitCode, 71);
  assert.match(ctx.output.text, /error=UNKNOWN_PROVIDER/);
  ctx.cleanup();
});

test('CLI tools internal provider: แนบ token/sessionHeaders เข้า context', async () => {
  const ctx = setup();
  let received = null;
  const result = await cli.run(['chatgpt', 'call', 'connectors_list', '{}'], ctx.env, ctx.output, {
    createHub: () => ctx.fakeHub,
    callTool: async (provider, tool, args, context) => {
      received = { provider, tool, context };
      return [];
    }
  });
  assert.equal(result.exitCode, 0);
  assert.equal(received.provider, 'chatgpt');
  assert.ok(received.context.token, 'token ต้องถูกแนบ');
  assert.deepEqual(received.context.sessionHeaders, { Cookie: 'a=b' });
  ctx.cleanup();
});

test('CLI tools internal provider: ไม่มี token = เด้ง auth status ไม่ยิง tool', async () => {
  const ctx = setup();
  let called = false;
  const envNoAuth = { ZERO_CHATGPT_AUTH_FILE: path.join(ctx.dir, 'no-auth.json'), ZERO_CONFIG_FILE: ctx.env.ZERO_CONFIG_FILE };
  const result = await cli.run(['chatgpt', 'call', 'connectors_list'], envNoAuth, ctx.output, {
    createHub: () => ctx.fakeHub,
    callTool: async () => { called = true; return []; }
  });
  assert.notEqual(result.exitCode, 0);
  assert.equal(called, false);
  ctx.cleanup();
});

test('CLI tools: call ไม่ครบ = usage exitCode 64', async () => {
  const ctx = setup();
  const result = await cli.run(['fakemcp', 'call'], {}, ctx.output, { createHub: () => ctx.fakeHub });
  assert.equal(result.exitCode, 64);
  assert.match(ctx.output.text, /Usage: zero fakemcp call <tool>/);
  ctx.cleanup();
});

test('CLI mcp sugar: zero <provider> <tool> <json> ไม่ต้องพิมพ์ call', async () => {
  const ctx = setup();
  let received = null;
  const result = await cli.run(['fakemcp', 'ping', '{"n":7}'], {}, ctx.output, {
    createHub: () => ctx.fakeHub,
    callTool: async (provider, tool, args) => {
      received = { provider, tool, args };
      return { ok: true };
    }
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(received, { provider: 'fakemcp', tool: 'ping', args: { n: 7 } });
  ctx.cleanup();
});

test('CLI legacy flat command: เด้ง migration hint exitCode 64 ไม่ยิง tool', async () => {
  const ctx = setup();
  let called = false;
  const result = await cli.run(['conversation', 'get', 'abc'], {}, ctx.output, {
    createHub: () => { called = true; return ctx.fakeHub; }
  });
  assert.equal(result.exitCode, 64);
  assert.match(ctx.output.text, /ย้ายแล้ว/);
  assert.match(ctx.output.text, /zero chatgpt conversation get abc/);
  assert.equal(called, false, 'ต้องไม่สร้าง hub เลย');
  ctx.cleanup();
});
