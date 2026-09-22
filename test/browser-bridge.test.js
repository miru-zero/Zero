const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const bridge = require('../src/providers/chatgpt/browser-bridge');

const fakeRuntime = (beforeNode, afterNode) => ({
  ensureBrowser: async () => ({ endpoint: 'http://127.0.0.1:9223' }),
  openPage: async () => ({ id: 'page-1' }),
  getConversation: async () => ({
    status: 200,
    conversation_id: 'c1',
    current_node: beforeNode,
    gizmo_id: null
  }),
  submitMessage: async () => true,
  waitForSubmission: async () => ({
    status: 200,
    conversation_id: 'c1',
    current_node: afterNode
  }),
  waitForConversation: async () => ({
    status: 200,
    conversation_id: 'c1',
    current_node: afterNode
  }),
  closePage: async () => true
});

test('browser bridge returns high-level conversation state only', async () => {
  const runtime = fakeRuntime('n1', 'n2');
  runtime.waitForSubmission = runtime.waitForConversation;
  const result = await bridge.send({
    conversationId: 'c1', message: 'hello', runtime, waitForFinal: true
  });
  assert.deepEqual(result, {
    success: true,
    status: 'OK',
    conversationId: 'c1',
    previousNode: 'n1',
    currentNode: 'n2'
  });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('Cookie'), false);
  assert.equal(serialized.includes('sentinel'), false);
});

test('browser bridge dispatch returns after submission acknowledgement without waiting for final assistant', async () => {
  let waitedForSubmission = 0;
  let waitedForFinal = 0;
  const runtime = fakeRuntime('n1', 'n2');
  runtime.waitForSubmission = async () => {
    waitedForSubmission += 1;
    return { status: 200, conversation_id: 'c1', current_node: 'n2', current_role: 'user' };
  };
  runtime.waitForConversation = async () => {
    waitedForFinal += 1;
    throw new Error('SHOULD_NOT_WAIT_FOR_FINAL');
  };
  const result = await bridge.send({ conversationId: 'c1', message: 'hello', runtime });
  assert.equal(result.success, true);
  assert.equal(result.status, 'DISPATCHED');
  assert.equal(result.currentNode, 'n2');
  assert.equal(waitedForSubmission, 1);
  assert.equal(waitedForFinal, 0);
});

test('browser bridge reports AUTH_REQUIRED without opening login UI', async () => {
  const runtime = fakeRuntime('n1', 'n2');
  runtime.getConversation = async () => ({ status: 401 });
  const result = await bridge.send({
    conversationId: 'c1', message: 'hello', runtime
  });
  assert.deepEqual(result, {
    success: false,
    status: 'AUTH_REQUIRED',
    conversationId: 'c1',
    previousNode: null,
    currentNode: null
  });
});

test('browser bridge does not submit when the initial conversation read is rate limited', async () => {
  let submitted = false;
  const runtime = fakeRuntime('n1', 'n2');
  runtime.getConversation = async () => ({ status: 429 });
  runtime.submitMessage = async () => { submitted = true; };
  const result = await bridge.send({ conversationId: 'c1', message: 'hello', runtime });
  assert.equal(result.success, false);
  assert.equal(result.status, 'RATE_LIMITED');
  assert.equal(submitted, false);
});

for (const method of ['waitForSubmission', 'waitForConversation']) {
  test(`browser runtime ${method} stops reading after the first 429`, async () => {
    let reads = 0;
    let sleeps = 0;
    const runtime = bridge.createRuntime({ sleepImpl: async () => { sleeps += 1; } });
    runtime.getConversation = async () => { reads += 1; return { status: 429 }; };
    await assert.rejects(
      runtime[method]({ page: {}, conversationId: 'c1', previousNode: 'n1', timeoutMs: 1000 }),
      (error) => error.code === 'RATE_LIMITED' && error.status === 429
    );
    assert.equal(reads, 1);
    assert.equal(sleeps, 0);
  });
}

test('browser runtime reuses an existing CDP endpoint without launching Chrome', async () => {
  const seen = [];
  const runtime = bridge.createRuntime({
    fetchImpl: async (url) => {
      seen.push(String(url));
      return { ok: true, json: async () => ({ webSocketDebuggerUrl: 'ws://browser' }) };
    },
    spawnImpl: () => { throw new Error('SPAWN_SHOULD_NOT_RUN'); }
  });
  const result = await runtime.ensureBrowser({
    profileDir: 'P', chromePath: 'chrome.exe', debugPort: 9444, timeoutMs: 50
  });
  assert.deepEqual(result, { endpoint: 'http://127.0.0.1:9444' });
  assert.deepEqual(seen, ['http://127.0.0.1:9444/json/version']);
});

test('browser runtime opens a ChatGPT target using the CDP discovery endpoint', async () => {
  let request = null;
  class FakeWebSocket {
    constructor() { setImmediate(() => this.onopen?.()); }
    send(text) {
      const message = JSON.parse(text);
      setImmediate(() => this.onmessage?.({ data: JSON.stringify({ id: message.id, result: { result: { value: true } } }) }));
    }
    close() {}
  }
  const runtime = bridge.createRuntime({
    WebSocketImpl: FakeWebSocket,
    fetchImpl: async (url, options) => {
      request = { url: String(url), options };
      return { ok: true, json: async () => ({ id: 'page-1', webSocketDebuggerUrl: 'ws://page-1' }) };
    }
  });
  const page = await runtime.openPage({ endpoint: 'http://127.0.0.1:9444' });
  assert.equal(page.id, 'page-1');
  assert.equal(page.webSocketDebuggerUrl, 'ws://page-1');
  assert.equal(request.options.method, 'PUT');
  assert.match(request.url, /\/json\/new\?/);
  assert.match(request.url, /chatgpt\.com/);
});

test('browser runtime reads reduced conversation state through CDP', async () => {
  const sent = [];
  class FakeWebSocket {
    constructor() { setImmediate(() => this.onopen?.()); }
    send(text) {
      const message = JSON.parse(text);
      sent.push(message);
      const value = {
        status: 200,
        conversation_id: 'c1',
        current_node: 'n1',
        gizmo_id: 'g-p-1',
        current_role: 'assistant',
        current_status: 'finished_successfully',
        end_turn: true
      };
      setImmediate(() => this.onmessage?.({
        data: JSON.stringify({ id: message.id, result: { result: { value } } })
      }));
    }
    close() {}
  }
  const runtime = bridge.createRuntime({ WebSocketImpl: FakeWebSocket });
  const result = await runtime.getConversation({
    page: { id: 'p1', endpoint: 'http://127.0.0.1:9444', webSocketDebuggerUrl: 'ws://p1' },
    conversationId: 'c1'
  });
  assert.deepEqual(result, {
    status: 200,
    conversation_id: 'c1',
    current_node: 'n1',
    gizmo_id: 'g-p-1',
    current_role: 'assistant',
    current_status: 'finished_successfully',
    end_turn: true
  });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].method, 'Runtime.evaluate');
  assert.equal(sent[0].params.awaitPromise, true);
  assert.equal(sent[0].params.returnByValue, true);
  assert.match(sent[0].params.expression, /backend-api\/conversations/);
  assert.match(sent[0].params.expression, /messages/);
  assert.match(sent[0].params.expression, /current_status/);
});

test('browser runtime submits through the ChatGPT composer instead of direct conversation POST', async () => {
  const sent = [];
  class FakeWebSocket {
    constructor() { setImmediate(() => this.onopen?.()); }
    send(text) {
      const message = JSON.parse(text);
      sent.push(message);
      let result = {};
      if (message.method === 'Runtime.evaluate') result = { result: { value: true } };
      setImmediate(() => this.onmessage?.({ data: JSON.stringify({ id: message.id, result }) }));
    }
    close() {}
  }
  const runtime = bridge.createRuntime({ WebSocketImpl: FakeWebSocket });
  await runtime.submitMessage({
    page: { id: 'p1', endpoint: 'http://127.0.0.1:9444', webSocketDebuggerUrl: 'ws://p1' },
    conversationId: 'c1',
    projectId: 'g-p-1',
    message: 'hello'
  });
  const nav = sent.find((item) => item.method === 'Page.navigate');
  assert.ok(nav);
  assert.match(nav.params.url, /\/g\/g-p-1\/c\/c1$/);
  const input = sent.find((item) => item.method === 'Input.insertText');
  assert.equal(input.params.text, 'hello');
  assert.equal(sent.some((item) => String(item.params?.expression || '').includes('/backend-api/f/conversation')), false);
});

test('browser runtime waits for final successful assistant turn', async () => {
  let reads = 0;
  class FakeWebSocket {
    constructor() { setImmediate(() => this.onopen?.()); }
    send(text) {
      const message = JSON.parse(text);
      reads += 1;
      const states = [
        { current_node: 'n1', current_role: 'assistant', current_status: 'finished_successfully', end_turn: true },
        { current_node: 'n2', current_role: 'user', current_status: 'finished_successfully', end_turn: null },
        { current_node: 'n3', current_role: 'assistant', current_status: 'finished_successfully', end_turn: true }
      ];
      const value = { status: 200, conversation_id: 'c1', gizmo_id: null, ...states[Math.min(reads - 1, 2)] };
      setImmediate(() => this.onmessage?.({ data: JSON.stringify({ id: message.id, result: { result: { value } } }) }));
    }
    close() {}
  }
  const runtime = bridge.createRuntime({ WebSocketImpl: FakeWebSocket, sleepImpl: async () => {} });
  const result = await runtime.waitForConversation({
    page: { id: 'p1', endpoint: 'http://127.0.0.1:9444', webSocketDebuggerUrl: 'ws://p1' },
    conversationId: 'c1', previousNode: 'n1', timeoutMs: 1000
  });
  assert.equal(result.current_node, 'n3');
  assert.equal(reads, 3);
});

test('browser runtime closes only the hidden target', async () => {
  let request = null;
  const runtime = bridge.createRuntime({
    fetchImpl: async (url, options) => {
      request = { url: String(url), options };
      return { ok: true };
    }
  });
  await runtime.closePage({
    page: { id: 'p1', endpoint: 'http://127.0.0.1:9444', webSocketDebuggerUrl: 'ws://p1' }
  });
  assert.equal(request.url, 'http://127.0.0.1:9444/json/close/p1');
});
test('browser runtime waits for ChatGPT execution context before returning page', async () => {
  let checks = 0;
  class FakeWebSocket {
    constructor() { setImmediate(() => this.onopen?.()); }
    send(text) {
      const message = JSON.parse(text);
      checks += 1;
      const value = checks > 1;
      setImmediate(() => this.onmessage?.({
        data: JSON.stringify({ id: message.id, result: { result: { value } } })
      }));
    }
    close() {}
  }
  const runtime = bridge.createRuntime({
    WebSocketImpl: FakeWebSocket,
    sleepImpl: async () => {},
    fetchImpl: async () => ({ ok: true, json: async () => ({ id: 'p1', url: 'https://chatgpt.com/', webSocketDebuggerUrl: 'ws://p1' }) })
  });
  const page = await runtime.openPage({ endpoint: 'http://127.0.0.1:9444', timeoutMs: 1000 });
  assert.equal(page.id, 'p1');
  assert.equal(checks, 2);
});
test('browser runtime launches headful Chrome without a startup window', async (t) => {
  let fetchCount = 0;
  let spawned = null;
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-browser-profile-'));
  t.after(() => fs.rmSync(profileDir, { recursive: true, force: true }));
  const runtime = bridge.createRuntime({
    fetchImpl: async () => ({ ok: fetchCount++ > 0 }),
    spawnImpl: (command, args, options) => {
      spawned = { command, args, options };
      return { unref() {} };
    },
    sleepImpl: async () => {}
  });
  const result = await runtime.ensureBrowser({
    profileDir, chromePath: 'chrome.exe', debugPort: 9444, timeoutMs: 1000
  });
  assert.deepEqual(result, { endpoint: 'http://127.0.0.1:9444' });
  assert.equal(spawned.command, 'chrome.exe');
  assert.equal(spawned.args.includes('--no-startup-window'), true);
  assert.equal(spawned.args.includes('--headless=new'), false);
  assert.equal(spawned.args.some((value) => String(value).startsWith('--window-position=')), false);
  assert.equal(spawned.args.includes('about:blank'), false);
  assert.equal(spawned.args.includes('--remote-debugging-port=9444'), true);
  assert.equal(spawned.options.windowsHide, true);
});


test('browser bridge hydrates Zero session before reading conversation', async () => {
  const calls = [];
  const runtime = fakeRuntime('n1', 'n2');
  runtime.hydrateSession = async (input) => { calls.push(['hydrate', input.sessionHeaders.Cookie]); return true; };
  runtime.getConversation = async () => { calls.push(['get']); return { status: 200, conversation_id: 'c1', current_node: 'n1', gizmo_id: null }; };
  await bridge.send({
    conversationId: 'c1',
    message: 'hello',
    sessionHeaders: { Cookie: 'session=a' },
    runtime
  });
  assert.deepEqual(calls.slice(0, 2), [['hydrate', 'session=a'], ['get']]);
});

test('browser runtime hydrates cookie header with CDP Network.setCookies', async () => {
  const sent = [];
  class FakeWebSocket {
    constructor() { setImmediate(() => this.onopen?.()); }
    send(text) {
      const message = JSON.parse(text);
      sent.push(message);
      setImmediate(() => this.onmessage?.({ data: JSON.stringify({ id: message.id, result: {} }) }));
    }
    close() {}
  }
  const runtime = bridge.createRuntime({ WebSocketImpl: FakeWebSocket });  await runtime.hydrateSession({
    page: { id: 'p1', endpoint: 'http://127.0.0.1:9444', webSocketDebuggerUrl: 'ws://p1' },
    sessionHeaders: { Cookie: 'a=1; b=two' }
  });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].method, 'Network.setCookies');
  assert.deepEqual(sent[0].params.cookies, [
    { name: 'a', value: '1', url: 'https://chatgpt.com/' },
    { name: 'b', value: 'two', url: 'https://chatgpt.com/' }
  ]);
});

test('browser runtime applies Zero bearer token to hidden target', async () => {
  const sent = [];
  class FakeWebSocket {
    constructor() { setImmediate(() => this.onopen?.()); }
    send(text) {
      const message = JSON.parse(text);
      sent.push(message);
      setImmediate(() => this.onmessage?.({ data: JSON.stringify({ id: message.id, result: {} }) }));
    }
    close() {}
  }
  const runtime = bridge.createRuntime({ WebSocketImpl: FakeWebSocket });
  await runtime.hydrateSession({
    page: { id: 'p1', endpoint: 'http://127.0.0.1:9444', webSocketDebuggerUrl: 'ws://p1' },
    sessionHeaders: { Cookie: 'a=1' },
    token: 'token-fixture'
  });
  const enableIndex = sent.findIndex((item) => item.method === 'Network.enable');
  const authIndex = sent.findIndex((item) => item.method === 'Network.setExtraHTTPHeaders');
  assert.ok(enableIndex >= 0);
  assert.ok(authIndex > enableIndex);
  const auth = sent[authIndex];
  assert.equal(auth.params.headers.Authorization, 'Bearer token-fixture');
});

test('browser page keeps one CDP session across auth and conversation fetch', async () => {
  let instances = 0;
  const sent = [];
  class FakeWebSocket {
    constructor() { instances += 1; setImmediate(() => this.onopen?.()); }
    send(text) {
      const message = JSON.parse(text);
      sent.push(message.method);
      let result = {};
      if (message.method === 'Runtime.evaluate') {
        const value = message.params.expression.includes('location.origin')
          ? true
          : { status: 200, conversation_id: 'c1', current_node: 'n1', gizmo_id: null };
        result = { result: { value } };
      }
      setImmediate(() => this.onmessage?.({ data: JSON.stringify({ id: message.id, result }) }));
    }
    close() {}
  }
  const runtime = bridge.createRuntime({
    WebSocketImpl: FakeWebSocket,
    fetchImpl: async () => ({ ok: true, json: async () => ({ id: 'p1', webSocketDebuggerUrl: 'ws://p1' }) })
  });
  const page = await runtime.openPage({ endpoint: 'http://127.0.0.1:9444' });
  await runtime.hydrateSession({ page, sessionHeaders: { Cookie: 'a=1' }, token: 't' });
  await runtime.getConversation({ page, conversationId: 'c1' });
  assert.equal(instances, 1);
  assert.equal(sent.includes('Network.setExtraHTTPHeaders'), true);
});
test('browser CDP client dispatches protocol events to listeners', async () => {
  let socket = null;
  class FakeWebSocket {
    constructor() { socket = this; setImmediate(() => this.onopen?.()); }
    send(text) {
      const message = JSON.parse(text);
      const result = message.method === 'Runtime.evaluate'
        ? { result: { value: true } }
        : {};
      setImmediate(() => this.onmessage?.({ data: JSON.stringify({ id: message.id, result }) }));
    }
    close() {}
  }
  const runtime = bridge.createRuntime({
    WebSocketImpl: FakeWebSocket,
    fetchImpl: async () => ({ ok: true, json: async () => ({ id: 'p1', webSocketDebuggerUrl: 'ws://p1' }) })
  });
  const page = await runtime.openPage({ endpoint: 'http://127.0.0.1:9444' });
  let seen = null;
  page.cdp.on('Fetch.requestPaused', (params) => { seen = params; });
  socket.onmessage?.({ data: JSON.stringify({ method: 'Fetch.requestPaused', params: { requestId: 'r1' } }) });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(seen, { requestId: 'r1' });
});

test('project composer navigation resolves gizmo short_url before Page.navigate', async () => {
  const sent = [];
  class FakeWebSocket {
    constructor() { setImmediate(() => this.onopen?.()); }
    send(text) {
      const message = JSON.parse(text);
      sent.push(message);
      let value = true;
      if (message.method === 'Runtime.evaluate'
          && String(message.params?.expression || '').includes('/backend-api/gizmos/')) {
        value = { status: 200, short_url: 'g-p-1-ocr-voice' };
      }
      setImmediate(() => this.onmessage?.({
        data: JSON.stringify({ id: message.id, result: { result: { value } } })
      }));
    }
    close() {}
  }
  const runtime = bridge.createRuntime({ WebSocketImpl: FakeWebSocket });
  await runtime.submitMessage({
    page: { id: 'p1', endpoint: 'http://127.0.0.1:9444', webSocketDebuggerUrl: 'ws://p1' },
    conversationId: 'c1', projectId: 'g-p-1', message: 'hello'
  });
  const nav = sent.find((item) => item.method === 'Page.navigate');
  assert.equal(nav.params.url, 'https://chatgpt.com/g/g-p-1-ocr-voice/c/c1');
});
