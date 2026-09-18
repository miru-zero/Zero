# Browser Bridge Send Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route only `zero conversation send <conversation_id> <message>` through a silent persistent Chrome runtime while preserving all unrelated Zero-ChatGPT behavior.

**Architecture:** Add one focused `src/bridge/browser-bridge.js` that launches/reuses a headless Chrome profile and drives the existing ChatGPT web UI through CDP. `conversations.sendConversation()` becomes a thin transport selector: browser bridge by default, current direct HTTP flow only when `transport === 'direct'`.

**Tech Stack:** Node.js 22.23.2 built-in `fetch`, built-in `WebSocket`, `child_process.spawn`, Chrome 151 CDP, node:test.

**Spec:** `docs/superpowers/specs/2026-09-12-browser-bridge-send-design.md`

## Global Constraints

- Minimal integration only; do not migrate get/list/rename/delete/move/project commands.
- No visible Chrome popup during normal send.
- Dedicated persistent profile; never open or clone live Chrome Default.
- No HAR replay, fake Sentinel token, CAPTCHA/Turnstile/Sentinel solver, or secret logging.
- Preserve direct HTTP send as diagnostic mode only.
- New exports use only `exports.name = (...) => { ... };` / async equivalent.
- Workspace is not a git repository; commit steps are recorded as skipped rather than fabricating commits.

---
### Task 1: Background Browser Bridge

**Files:**
- Create: `src/bridge/browser-bridge.js`
- Create: `test/browser-bridge.test.js`

**Interfaces:**
- Consumes: `{ conversationId, message, profileDir?, chromePath?, debugPort?, timeoutMs?, runtime? }`
- Produces: `exports.send(...) -> { success, status, conversationId, previousNode, currentNode }`

- [ ] **Step 1: Write the failing bridge tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const bridge = require('../src/bridge/browser-bridge');

test('browser bridge returns high-level conversation state only', async () => {
  const result = await bridge.send({ conversationId: 'c1', message: 'hello', runtime: fakeRuntime('n1', 'n2') });
  assert.deepEqual(result, { success: true, status: 'OK', conversationId: 'c1', previousNode: 'n1', currentNode: 'n2' });
  assert.equal(JSON.stringify(result).includes('Cookie'), false);
});
```
```js
const fakeRuntime = (beforeNode, afterNode) => ({
  ensureBrowser: async () => ({ endpoint: 'http://127.0.0.1:9223' }),
  openPage: async () => ({ id: 'page-1' }),
  getConversation: async () => ({ conversation_id: 'c1', current_node: beforeNode, gizmo_id: null }),
  submitMessage: async () => true,
  waitForConversation: async () => ({ conversation_id: 'c1', current_node: afterNode })
});

test('browser bridge reports AUTH_REQUIRED without opening login UI', async () => {
  const runtime = fakeRuntime('n1', 'n2');
  runtime.getConversation = async () => ({ status: 401 });
  const result = await bridge.send({ conversationId: 'c1', message: 'hello', runtime });
  assert.deepEqual(result, { success: false, status: 'AUTH_REQUIRED', conversationId: 'c1', previousNode: null, currentNode: null });
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test test/browser-bridge.test.js`
Expected: FAIL because `../src/bridge/browser-bridge` does not exist.

- [ ] **Step 3: Implement the minimal bridge runtime**
Use only Node built-ins. Defaults:

```js
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const defaultProfileDir = path.resolve(__dirname, '../../runtime/browser-profile');
const defaultChromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const defaultPort = 9223;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
```

`ensureBrowser()` first probes `http://127.0.0.1:<port>/json/version`. If unavailable, create the profile directory and spawn Chrome detached with exactly:

```js
['--headless=new', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profileDir}`,
 '--no-first-run', '--no-default-browser-check', 'about:blank']
```

Use `{ detached: true, stdio: 'ignore', windowsHide: true }`, call `.unref()`, then poll `/json/version` until `timeoutMs`; failure is `BRIDGE_UNAVAILABLE`.

- [ ] **Step 4: Implement CDP page operations without exposing secrets**
Open a hidden tab with `PUT /json/new?https%3A%2F%2Fchatgpt.com%2F`, connect to its returned `webSocketDebuggerUrl`, and implement a request/response CDP caller keyed by numeric `id`.

For conversation state, evaluate only this reduced shape inside the browser:

```js
(async () => {
  const r = await fetch('/backend-api/conversations/' + encodeURIComponent(conversationId));
  if (r.status !== 200) return { status: r.status };
  const j = await r.json();
  return {
    status: 200,
    conversation_id: j.conversation_id || j.id,
    current_node: j.current_node || null,
    gizmo_id: j.gizmo_id || null
  };
})()
```

Never return cookies, headers, Sentinel values, conduit values, or response bodies containing them.

- [ ] **Step 5: Implement browser UI submission**

Navigate the hidden tab to `/g/<gizmo_id>/c/<conversation_id>` for project conversations or `/c/<conversation_id>` otherwise. Poll until `#prompt-textarea` exists, focus it via `Runtime.evaluate`, insert the message with `Input.insertText`, then click the first existing selector from `button[data-testid="send-button"]`, `#composer-submit-button`, `button[aria-label*="Send"]`.
After click, poll the reduced conversation state every 500 ms until `current_node !== previousNode`; on 401 return `AUTH_REQUIRED`, on timeout return `SEND_TIMEOUT`. Close only the hidden tab with `/json/close/<targetId>`; keep Chrome alive for reuse.

`exports.send` maps results exactly:

```js
exports.send = async ({ conversationId, message, profileDir = defaultProfileDir,
  chromePath = defaultChromePath, debugPort = defaultPort, timeoutMs = 30000,
  runtime = defaultRuntime }) => {
  if (!conversationId) throw new Error('conversationId is required');
  if (!message) throw new Error('message is required');
  const browser = await runtime.ensureBrowser({ profileDir, chromePath, debugPort, timeoutMs });
  const page = await runtime.openPage({ endpoint: browser.endpoint });
  try {
    const before = await runtime.getConversation({ page, conversationId });
    if (before.status === 401) return { success: false, status: 'AUTH_REQUIRED', conversationId, previousNode: null, currentNode: null };
    if (before.status !== 200 || !before.current_node) return { success: false, status: 'CONVERSATION_UNAVAILABLE', conversationId, previousNode: null, currentNode: null };
    await runtime.submitMessage({ page, conversationId, projectId: before.gizmo_id, message });
    const after = await runtime.waitForConversation({ page, conversationId, previousNode: before.current_node, timeoutMs });
    return { success: true, status: 'OK', conversationId, previousNode: before.current_node, currentNode: after.current_node };
  } finally { await runtime.closePage({ page }); }
};
```
- [ ] **Step 6: Run bridge tests GREEN**

Run: `node --test test/browser-bridge.test.js`
Expected: all bridge tests PASS.

- [ ] **Step 7: Commit**

Skipped: workspace is not a git repository. Record test output instead.

### Task 2: Route Only Existing-Conversation Send Through the Bridge

**Files:**
- Modify: `src/conversations.js:1-3,358-428`
- Modify: `test/conversation-send.test.js`

**Interfaces:**
- Consumes: `browserBridge.send({ conversationId, message })`
- Produces: existing `exports.sendConversation(...)` result shape with `conversation_id` and `current_node`; direct transport remains callable with `transport: 'direct'`.

- [ ] **Step 1: Add failing transport-selection tests**

```js
test('sendConversation uses browser bridge by default', async () => {
  let called = null;
  const result = await conversations.sendConversation({
    conversationId: 'c-old', message: 'hello', browserSend: async (input) => {
      called = input;
      return { success: true, status: 'OK', conversationId: 'c-old', previousNode: 'n1', currentNode: 'n2' };
    }
  });
  assert.deepEqual(called, { conversationId: 'c-old', message: 'hello' });
  assert.equal(result.current_node, 'n2');
});
```
```js
test('sendConversation keeps current direct transport behind explicit diagnostic mode', async () => {
  const calls = [];
  const requestJson = async (target, token, headers, options = {}) => {
    calls.push(target);
    if (target === '/backend-api/conversations/c-old') return { status: 200, json: { conversation_id: 'c-old', current_node: 'n1', gizmo_id: null, messages: [] } };
    if (target === '/backend-api/f/conversation/prepare') return { status: 200, json: {}, headers: { 'x-conduit-token': 'ct' } };
    throw new Error('unexpected ' + target);
  };
  const requestText = async () => ({ status: 200, text: 'data: {"conversation_id":"c-old"}\n\n' });
  await conversations.sendConversation({ conversationId: 'c-old', message: 'hello', transport: 'direct', token: 't', sessionHeaders: {}, requestJson, requestText });
  assert.equal(calls.includes('/backend-api/f/conversation/prepare'), true);
});
```

- [ ] **Step 2: Run focused test and verify RED**

Run: `node --test test/conversation-send.test.js`
Expected: new browser-default test FAIL because `sendConversation` still executes direct HTTP.

- [ ] **Step 3: Make the smallest production change**

Add `const browserBridge = require('./bridge/browser-bridge');`. Rename the current body to private `sendConversationDirect`. Export only this wrapper:
```js
exports.sendConversation = async ({
  conversationId, message, transport = 'browser', browserSend = browserBridge.send, ...direct
}) => {
  if (transport === 'direct') return sendConversationDirect({ conversationId, message, ...direct });
  const result = await browserSend({ conversationId, message });
  if (!result?.success) {
    const error = new Error(result?.status || 'browser send failed');
    error.code = result?.status || 'BRIDGE_UNAVAILABLE';
    throw error;
  }
  return {
    conversation_id: result.conversationId || conversationId,
    current_node: result.currentNode || null,
    previous_node: result.previousNode || null
  };
};
```

Do not modify createConversation or any other management command.

- [ ] **Step 4: Run focused tests GREEN**

Run: `node --test test/conversation-send.test.js`
Expected: all send tests PASS, including preserved direct diagnostic path.

- [ ] **Step 5: Commit**

Skipped: workspace is not a git repository. Record focused test output instead.
### Task 3: CLI Error Mapping and Diagnostic Switch

**Files:**
- Modify: `src/cli.js:185-190,261-266`
- Modify: `test/cli-management.test.js`

**Interfaces:**
- Consumes: `ZERO_CHATGPT_SEND_TRANSPORT=direct` only for explicit diagnostic mode.
- Produces: normal send remains `status=OK`; browser auth failure prints `status=AUTH_REQUIRED`; bridge startup failure prints `status=BRIDGE_UNAVAILABLE`.

- [ ] **Step 1: Write failing CLI tests**

```js
test('CLI defaults conversation send to browser transport', async () => {
  const ctx = setup(); let received;
  await cli.run(['conversation','send','c1','hello'], ctx.env, ctx.output, {
    sendConversation: async (input) => { received = input; return { conversation_id:'c1', current_node:'n2' }; }
  });
  assert.equal(received.transport, 'browser');
});

test('CLI maps browser AUTH_REQUIRED without fatal output', async () => {
  const ctx = setup();
  const result = await cli.run(['conversation','send','c1','hello'], ctx.env, ctx.output, {
    sendConversation: async () => { const e = new Error('AUTH_REQUIRED'); e.code = 'AUTH_REQUIRED'; throw e; }
  });
  assert.equal(result.exitCode, 6);
  assert.match(ctx.output.text, /status=AUTH_REQUIRED/);
});
```
- [ ] **Step 2: Run CLI tests and verify RED**

Run: `node --test test/cli-management.test.js`
Expected: new transport/error tests FAIL.

- [ ] **Step 3: Implement minimal CLI mapping**

In `handleRequestError` add only:

```js
if (error?.code === 'AUTH_REQUIRED') {
  output.write('status=AUTH_REQUIRED\n');
  return { exitCode: 6, status: 'AUTH_REQUIRED' };
}
if (error?.code === 'BRIDGE_UNAVAILABLE') {
  output.write('status=BRIDGE_UNAVAILABLE\n');
  return { exitCode: 69, status: 'BRIDGE_UNAVAILABLE' };
}
```

For the send dispatch pass:

```js
transport: env.ZERO_CHATGPT_SEND_TRANSPORT === 'direct' ? 'direct' : 'browser'
```

No other CLI branch changes.

- [ ] **Step 4: Run CLI tests GREEN**

Run: `node --test test/cli-management.test.js`
Expected: all CLI management tests PASS.
- [ ] **Step 5: Commit**

Skipped: workspace is not a git repository. Record CLI test output instead.

### Task 4: Verification and One Real Bridge Probe

**Files:**
- Verify: `src/bridge/browser-bridge.js`
- Verify: `src/conversations.js`
- Verify: `src/cli.js`
- Verify: `test/browser-bridge.test.js`
- Verify: `test/conversation-send.test.js`
- Verify: `test/cli-management.test.js`

- [ ] **Step 1: Verify syntax**

Run:

```powershell
node --check src\bridge\browser-bridge.js
node --check src\conversations.js
node --check src\cli.js
```

Expected: all exit 0.

- [ ] **Step 2: Run complete regression suite**

Run: `npm test`
Expected: zero failures; existing non-send command tests remain unchanged.
