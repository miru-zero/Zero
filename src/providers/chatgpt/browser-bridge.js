const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const defaultProfileDir = path.resolve(__dirname, '../../../runtime/browser-profile');
const resolveChromePath = (env = process.env, existsSync = fs.existsSync, platform = process.platform) => {
  for (const key of ['ZERO_CHROME_PATH', 'CHROME_PATH', 'CHROME_BIN']) {
    if (typeof env[key] === 'string' && env[key].trim()) return env[key].trim();
  }
  if (platform === 'win32') {
    for (const base of [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA]) {
      if (!base) continue;
      const candidate = path.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe');
      if (existsSync(candidate)) return candidate;
    }
    return 'chrome.exe';
  }
  return 'google-chrome';
};
exports.resolveChromePath = resolveChromePath;
const defaultPort = 9223;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const createCdpClient = (WebSocketImpl, url) => new Promise((resolve, reject) => {
  const socket = new WebSocketImpl(url);
  const pending = new Map();
  const listeners = new Map();
  let nextId = 1;
  let opened = false;
  let closed = false;
  const rejectAll = (error) => {
    for (const item of pending.values()) item.reject(error);
    pending.clear();
  };
  const client = {
    send: (method, params = {}) => new Promise((res, rej) => {
      if (closed) return rej(new Error('CDP socket closed'));
      const id = nextId++;
      pending.set(id, { resolve: res, reject: rej });
      socket.send(JSON.stringify({ id, method, params }));
    }),
    on: (method, handler) => {
      if (!listeners.has(method)) listeners.set(method, new Set());
      listeners.get(method).add(handler);
      return () => listeners.get(method)?.delete(handler);
    },
    close: () => {
      if (closed) return;
      closed = true;
      listeners.clear();
      try { socket.close(); } catch {}
    }
  };
  socket.onopen = () => { opened = true; resolve(client); };
  socket.onmessage = (event) => {
    try {
      const message = JSON.parse(String(event.data));
      if (message.method) {
        for (const handler of listeners.get(message.method) || []) handler(message.params || {});
        return;
      }
      const item = pending.get(message.id);
      if (!item) return;
      pending.delete(message.id);
      if (message.error) item.reject(new Error(message.error.message || 'CDP command failed'));
      else item.resolve(message.result || {});
    } catch (error) { rejectAll(error); }
  };
  socket.onerror = () => {
    const error = new Error('CDP socket failed');
    if (!opened) reject(error);
    rejectAll(error);
  };
  socket.onclose = () => { closed = true; rejectAll(new Error('CDP socket closed')); };
});

const cdpCommand = async (WebSocketImpl, url, method, params = {}) => {
  const client = await createCdpClient(WebSocketImpl, url);
  try { return await client.send(method, params); }
  finally { client.close(); }
};

const pageCommand = (page, WebSocketImpl, method, params = {}) =>
  page?.cdp ? page.cdp.send(method, params) : cdpCommand(WebSocketImpl, page.webSocketDebuggerUrl, method, params);


exports.createRuntime = ({ fetchImpl = fetch, spawnImpl = spawn, WebSocketImpl = WebSocket, sleepImpl = sleep } = {}) => { const runtime = {
  ensureBrowser: async ({ profileDir, chromePath, debugPort, timeoutMs }) => {
    const endpoint = `http://127.0.0.1:${debugPort}`;
    const ready = async () => {
      try {
        const response = await fetchImpl(`${endpoint}/json/version`);
        return Boolean(response?.ok);
      } catch {
        return false;
      }
    };
    if (await ready()) return { endpoint };
    fs.mkdirSync(profileDir, { recursive: true });
    const child = spawnImpl(chromePath, [
      '--no-startup-window',
      '--disable-features=Translate,TranslateUI',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${profileDir}`,
      '--no-first-run',
      '--no-default-browser-check'
    ], { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref?.();
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await ready()) return { endpoint };
      await sleep(100);
    }
    const error = new Error('BRIDGE_UNAVAILABLE');
    error.code = 'BRIDGE_UNAVAILABLE';
    throw error;
  },
  openPage: async ({ endpoint, timeoutMs = 10000 }) => {
    const url = `${endpoint}/json/new?${encodeURIComponent('https://chatgpt.com/')}`;
    const response = await fetchImpl(url, { method: 'PUT' });
    if (!response?.ok) throw new Error('browser target open failed');
    const target = { ...(await response.json()), endpoint };
    target.cdp = await createCdpClient(WebSocketImpl, target.webSocketDebuggerUrl);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const state = await target.cdp.send('Runtime.evaluate', {
        expression: "location.origin === 'https://chatgpt.com'", returnByValue: true
      });
      if (state?.result?.value) return target;
      await sleepImpl(100);
    }
    throw new Error('CHATGPT_PAGE_NOT_READY');
  },
  hydrateSession: async ({ page, sessionHeaders = {}, token = null }) => {
    const raw = sessionHeaders.Cookie || sessionHeaders.cookie || '';
    const cookies = String(raw).split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
      const index = part.indexOf('=');
      return index > 0 ? { name: part.slice(0, index).trim(), value: part.slice(index + 1), url: 'https://chatgpt.com/' } : null;
    }).filter(Boolean);
    if (!cookies.length) return 0;
    await pageCommand(page, WebSocketImpl, 'Network.setCookies', { cookies });
    if (token) {
      await pageCommand(page, WebSocketImpl, 'Network.enable');
      await pageCommand(page, WebSocketImpl, 'Network.setExtraHTTPHeaders', { headers: { Authorization: 'Bearer ' + token } });
    }
    return cookies.length;
  },
  getConversation: async ({ page, conversationId }) => {
    const id = JSON.stringify(String(conversationId));
    const expression = `(async()=>{const id=${id};const r=await fetch('/backend-api/conversations/'+encodeURIComponent(id),{credentials:'include'});if(r.status!==200)return{status:r.status};const j=await r.json();const current=(j.messages||[]).find((m)=>m&&m.id===j.current_node)||null;return{status:200,conversation_id:j.conversation_id||j.id,current_node:j.current_node||null,gizmo_id:j.gizmo_id||null,current_role:current?.author?.role||null,current_status:current?.status||null,end_turn:current?.end_turn??null};})()`;
    const result = await pageCommand(page, WebSocketImpl, 'Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    return result?.result?.value || { status: 0 };
  },
  submitMessage: async ({ page, conversationId, projectId, message, timeoutMs = 15000 }) => {
    let projectRoute = projectId || null;
    if (projectId) {
      const id = JSON.stringify(String(projectId));
      const expression = `(async()=>{const id=${id};const r=await fetch('/backend-api/gizmos/'+encodeURIComponent(id),{credentials:'include'});if(r.status!==200)return{status:r.status,short_url:null};const j=await r.json();const g=j?.gizmo?.gizmo||j?.gizmo||j||{};return{status:200,short_url:g.short_url||null};})()`;
      const result = await pageCommand(page, WebSocketImpl, 'Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true
      });
      projectRoute = result?.result?.value?.short_url || projectId;
    }
    const route = projectRoute ? 'https://chatgpt.com/g/' + encodeURIComponent(projectRoute) + '/c/' + encodeURIComponent(conversationId) : 'https://chatgpt.com/c/' + encodeURIComponent(conversationId);
    await pageCommand(page, WebSocketImpl, 'Page.navigate', { url: route });
    const deadline = Date.now() + timeoutMs;
    let ready = false;
    while (Date.now() < deadline && !ready) {
      const state = await pageCommand(page, WebSocketImpl, 'Runtime.evaluate', { expression: "Boolean(document.querySelector('#prompt-textarea'))", returnByValue: true });
      ready = Boolean(state?.result?.value);
      if (!ready) await sleepImpl(100);
    }
    if (!ready) throw new Error('COMPOSER_UNAVAILABLE');
    await pageCommand(page, WebSocketImpl, 'Runtime.evaluate', { expression: "(()=>{const e=document.querySelector('#prompt-textarea');if(!e)return false;e.focus();return true})()", returnByValue: true });
    await pageCommand(page, WebSocketImpl, 'Input.insertText', { text: String(message) });
    const click = await pageCommand(page, WebSocketImpl, 'Runtime.evaluate', { expression: "(()=>{const e=document.querySelector('button[data-testid=\"send-button\"]')||document.querySelector('#composer-submit-button')||document.querySelector('button[aria-label*=\"Send\"]');if(!e)return false;e.click();return true})()", returnByValue: true });
    if (!click?.result?.value) throw new Error('SEND_BUTTON_UNAVAILABLE');
    return true;
  },
  waitForSubmission: async ({ page, conversationId, previousNode, timeoutMs = 10000 }) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const state = await runtime.getConversation({ page, conversationId });
      if (state.status === 401) { const e = new Error('AUTH_REQUIRED'); e.code = 'AUTH_REQUIRED'; throw e; }
      if (state.status === 200 && state.current_node && state.current_node !== previousNode) return state;
      await sleepImpl(250);
    }
    const e = new Error('SEND_ACK_TIMEOUT'); e.code = 'SEND_ACK_TIMEOUT'; throw e;
  },
  waitForConversation: async ({ page, conversationId, previousNode, timeoutMs = 30000 }) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const state = await runtime.getConversation({ page, conversationId });
      if (state.status === 401) { const e = new Error('AUTH_REQUIRED'); e.code = 'AUTH_REQUIRED'; throw e; }
      const finalAssistant = state.status === 200
        && state.current_node && state.current_node !== previousNode
        && state.current_role === 'assistant'
        && state.current_status === 'finished_successfully'
        && state.end_turn === true;
      if (finalAssistant) return state;
      await sleepImpl(500);
    }
    const e = new Error('SEND_TIMEOUT'); e.code = 'SEND_TIMEOUT'; throw e;
  },
  closePage: async ({ page }) => {
    if (!page?.endpoint || !page?.id) return false;
    try { await fetchImpl(page.endpoint + '/json/close/' + encodeURIComponent(page.id)); }
    finally { page.cdp?.close?.(); }
    return true;
  }
};
  return runtime;
};

const defaultRuntime = exports.createRuntime();

const unavailableRuntime = {
  ensureBrowser: async () => {
    const error = new Error('BRIDGE_UNAVAILABLE');
    error.code = 'BRIDGE_UNAVAILABLE';
    throw error;
  }
};

exports.send = async ({
  conversationId,
  message,
  profileDir = defaultProfileDir,
  chromePath = resolveChromePath(),
  debugPort = defaultPort,
  timeoutMs = 30000,
  waitForFinal = false,
  sessionHeaders = {},
  token = null,
  runtime = defaultRuntime
}) => {
  if (!conversationId) throw new Error('conversationId is required');
  if (!message) throw new Error('message is required');
  const browser = await runtime.ensureBrowser({ profileDir, chromePath, debugPort, timeoutMs });
  const page = await runtime.openPage({ endpoint: browser.endpoint });
  try {
    if (runtime.hydrateSession && (sessionHeaders.Cookie || sessionHeaders.cookie)) {
      await runtime.hydrateSession({ page, sessionHeaders, token });
    }
    const before = await runtime.getConversation({ page, conversationId });
    if (before.status === 401) {
      return {
        success: false,
        status: 'AUTH_REQUIRED',
        conversationId,
        previousNode: null,
        currentNode: null
      };
    }
    if (before.status !== 200 || !before.current_node) {
      return {
        success: false,
        status: 'CONVERSATION_UNAVAILABLE',
        conversationId,
        previousNode: null,
        currentNode: null
      };
    }
    await runtime.submitMessage({ page, conversationId, projectId: before.gizmo_id, message });
    const after = waitForFinal
      ? await runtime.waitForConversation({ page, conversationId, previousNode: before.current_node, timeoutMs })
      : await runtime.waitForSubmission({ page, conversationId, previousNode: before.current_node, timeoutMs });
    return {
      success: true,
      status: waitForFinal ? 'OK' : 'DISPATCHED',
      conversationId,
      previousNode: before.current_node,
      currentNode: after.current_node
    };
  } finally {
    await runtime.closePage({ page });
  }
};
