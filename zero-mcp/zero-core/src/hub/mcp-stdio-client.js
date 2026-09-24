// MCP stdio client (newline-delimited JSON-RPC) สำหรับ zero tools hub
const { spawn } = require('node:child_process');

const hasEnvKey = (env, key) => Object.keys(env).some((k) => k.toLowerCase() === key.toLowerCase());

const toNativePathEntry = (entry) => {
  const match = /^\/([a-zA-Z])\/(.*)$/.exec(entry);
  return match ? `${match[1].toUpperCase()}:\\${match[2].replace(/\//g, '\\')}` : null;
};

// PATH ที่เข้ามาอาจเป็น POSIX form (raw Git Bash env) หรือ Windows form ที่ bash แปลงให้แล้ว
// — แบบไหนก็ต้อง guarantee ว่า native child หา powershell.exe เจอ: เติม System32/PowerShell จาก SYSTEMROOT เสมอ
const sanitizePathForNative = (env) => {
  if (process.platform !== 'win32') return;
  const pathKey = Object.keys(env).find((k) => k.toLowerCase() === 'path');
  if (!pathKey) return;
  const raw = env[pathKey];
  if (typeof raw !== 'string' || raw === '') return;
  const isPosix = raw.includes('/') && /(^|:)\/(mingw|usr|[a-z])(\/|:|$)/i.test(raw);
  let entries = raw.split(isPosix ? ':' : ';');
  if (isPosix) entries = entries.map(toNativePathEntry).filter(Boolean);
  const sysroot = env.SYSTEMROOT || env.SystemRoot || env.WINDIR || env.windir || null;
  const required = sysroot ? [sysroot, `${sysroot}\\System32`, `${sysroot}\\System32\\WindowsPowerShell\\v1.0`] : [];
  for (const extra of required) {
    if (!entries.some((entry) => entry.toLowerCase() === extra.toLowerCase())) entries.push(extra);
  }
  env[pathKey] = entries.join(';');
};

exports.createClient = ({ command, args = [], env = {}, timeoutMs = 60000, protocolVersion = '2024-11-05', cwd, spawnFn = spawn } = {}) => {
  if (!command) throw new Error('mcp-stdio client requires command');
  // env จาก config เป็น fallback เท่านั้น (ค่าที่ shell มีอยู่แล้วชนะเสมอ) — ค่าเฉพาะเครื่องอยู่ใน config json
  const mergedEnv = { ...process.env };
  for (const [key, value] of Object.entries(env)) {
    if (!hasEnvKey(mergedEnv, key)) mergedEnv[key] = value;
  }
  sanitizePathForNative(mergedEnv);

  const useShell = process.platform === 'win32' && !/[\\/]/.test(command);
  const child = spawnFn(command, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: mergedEnv,
    ...(cwd ? { cwd } : {}),
    ...(useShell ? { shell: true } : {})
  });
  let buffer = '';
  let nextId = 1;
  const pending = new Map();
  const stderrLines = [];
  let initialized = null;

  const failAll = (error) => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    pending.clear();
  };

  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      if (message && message.id != null && pending.has(message.id)) {
        const entry = pending.get(message.id);
        pending.delete(message.id);
        clearTimeout(entry.timer);
        if (message.error) {
          const error = new Error(message.error.message || 'MCP error');
          error.code = 'MCP_ERROR';
          error.mcpError = message.error;
          entry.reject(error);
        } else {
          entry.resolve(message.result);
        }
      }
    }
  });
  child.stderr.on('data', (chunk) => {
    stderrLines.push(chunk.toString('utf8'));
    if (stderrLines.length > 50) stderrLines.shift();
  });
  child.on('error', (error) => {
    error.code = error.code || 'MCP_SPAWN_FAILED';
    failAll(error);
  });
  child.on('exit', (code) => {
    failAll(Object.assign(new Error(`mcp-stdio server exited code=${code}`), { code: 'MCP_EXITED' }));
  });

  const request = (method, params) => new Promise((resolve, reject) => {
    if (child.exitCode !== null || child.killed) {
      reject(Object.assign(new Error('mcp-stdio server not running'), { code: 'MCP_EXITED' }));
      return;
    }
    const id = nextId;
    nextId += 1;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(Object.assign(new Error(`mcp-stdio timeout after ${timeoutMs}ms (${method})`), { code: 'MCP_TIMEOUT' }));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });

  const ensureInitialized = () => {
    if (!initialized) {
      initialized = request('initialize', {
        protocolVersion,
        capabilities: {},
        clientInfo: { name: 'zero-tools-hub', version: '0.1.0' }
      }).then((result) => {
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
        return result;
      });
    }
    return initialized;
  };

  return {
    initialize: ensureInitialized,
    listTools: async () => {
      await ensureInitialized();
      const result = await request('tools/list');
      return (result && result.tools) || [];
    },
    callTool: async (name, toolArgs = {}) => {
      await ensureInitialized();
      return request('tools/call', { name, arguments: toolArgs });
    },
    stderrTail: () => stderrLines.join(''),
    close: () => {
      failAll(Object.assign(new Error('mcp-stdio client closed'), { code: 'MCP_CLOSED' }));
      try { child.kill(); } catch { /* already dead */ }
    }
  };
};

// export ไว้ให้ test ตรวจ PATH conversion โดยตรง
exports._sanitizePathForNative = sanitizePathForNative;
