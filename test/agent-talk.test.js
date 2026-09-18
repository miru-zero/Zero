const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const orchestrator = require('../src/providers/chatgpt/agents/orchestrator');
const taskRegistry = require('../src/providers/chatgpt/agents/task-registry');
const mailbox = require('../src/providers/chatgpt/agents/mailbox');
const cli = require('../src/cli');

const setup = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-agent-talk-'));
  const taskFile = path.join(dir, 'tasks.json');
  const mailboxFile = path.join(dir, 'mailbox.json');
  taskRegistry.createTask({ filePath: taskFile, task: {
    task_id: 'T1', parent_task_id: null, parent_conversation_id: 'C_MAIN',
    parent_turn_id: 'N_MAIN', worker_conversation_id: 'C_WORKER',
    dispatch_node_id: 'N_DISPATCH', status: 'RUNNING'
  }});
  return { dir, taskFile, mailboxFile, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
};

// --- orchestrator.replyAgent ---

test('replyAgent ส่ง [ZERO_AGENT_MESSAGE] from=worker เข้าห้อง parent และยัง RUNNING', async () => {
  const ctx = setup();
  const calls = [];
  const result = await orchestrator.replyAgent({
    taskFile: ctx.taskFile, taskId: 'T1', message: 'ถามกลับ: เอาแบบไหน',
    sendConversation: async (input) => { calls.push(input); return { current_node: 'N_REPLY' }; }
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].conversationId, 'C_MAIN');
  assert.match(calls[0].message, /\[ZERO_AGENT_MESSAGE\]/);
  assert.match(calls[0].message, /task_id=T1/);
  assert.match(calls[0].message, /from=worker/);
  assert.match(calls[0].message, /ถามกลับ: เอาแบบไหน/);
  assert.equal(result.status, 'REPLIED');
  assert.equal(result.parent_conversation_id, 'C_MAIN');
  const task = taskRegistry.getTask({ filePath: ctx.taskFile, taskId: 'T1' });
  assert.equal(task.status, 'RUNNING');
  assert.equal(task.last_reply_node_id, 'N_REPLY');
  ctx.cleanup();
});

test('replyAgent งาน CLOSED = throw', async () => {
  const ctx = setup();
  taskRegistry.updateTask({ filePath: ctx.taskFile, taskId: 'T1', patch: { status: 'CLOSED' } });
  await assert.rejects(
    orchestrator.replyAgent({ taskFile: ctx.taskFile, taskId: 'T1', message: 'x', sendConversation: async () => ({ current_node: 'N' }) }),
    /task is closed/
  );
  ctx.cleanup();
});

test('replyAgent งานที่ return ไปแล้ว = throw (คุยต่อต้อง spawn ใหม่)', async () => {
  const ctx = setup();
  taskRegistry.updateTask({ filePath: ctx.taskFile, taskId: 'T1', patch: { status: 'DONE', delivery_status: 'DELIVERED' } });
  await assert.rejects(
    orchestrator.replyAgent({ taskFile: ctx.taskFile, taskId: 'T1', message: 'x', sendConversation: async () => ({ current_node: 'N' }) }),
    /already returned/
  );
  ctx.cleanup();
});

// --- orchestrator.sendMessage envelope ---

test('sendMessage ห่อ [ZERO_AGENT_MESSAGE] from=parent ให้ worker อ่านรู้เรื่อง', async () => {
  const ctx = setup();
  const calls = [];
  await orchestrator.sendMessage({
    taskFile: ctx.taskFile, taskId: 'T1', message: 'ตอบ: เอาแบบ A',
    sendConversation: async (input) => { calls.push(input); return { current_node: 'N_SAY' }; }
  });
  assert.equal(calls[0].conversationId, 'C_WORKER');
  assert.match(calls[0].message, /\[ZERO_AGENT_MESSAGE\]/);
  assert.match(calls[0].message, /from=parent/);
  assert.match(calls[0].message, /ตอบ: เอาแบบ A/);
  ctx.cleanup();
});

// --- dispatch สอน reply ---

test('spawnAgent dispatch message สอนทั้ง return และ reply', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-agent-dispatch-'));
  const taskFile = path.join(dir, 'tasks.json');
  const sends = [];
  await orchestrator.spawnAgent({
    taskFile,
    workerConversationId: 'C_W', parentConversationId: 'C_P', taskMessage: 'งาน X',
    getConversation: async () => ({ current_node: 'N_P' }),
    sendConversation: async (input) => { sends.push(input); return { current_node: 'N_D' }; }
  });
  assert.match(sends[0].message, /zero chatgpt agent return task_/);
  assert.match(sends[0].message, /zero chatgpt agent reply task_/);
  assert.match(sends[0].message, /WITHOUT finishing/);
  fs.rmSync(dir, { recursive: true, force: true });
});

// --- orchestrator.checkAgent ---

test('checkAgent เก็บผล worker ที่จบเงียบๆ แล้ว deliver เข้าห้อง parent', async () => {
  const ctx = setup();
  const deliveries = [];
  const result = await orchestrator.checkAgent({
    taskFile: ctx.taskFile, mailboxFile: ctx.mailboxFile, taskId: 'T1',
    getConversation: async () => ({
      current_node: 'N_FINAL',
      messages: [{ id: 'N_FINAL', author: { role: 'assistant' }, status: 'finished_successfully', end_turn: true, content: { content: 'ผลลัพธ์ X' } }]
    }),
    sendConversation: async (input) => { deliveries.push(input); return { current_node: 'N_DELIVER' }; }
  });
  assert.equal(result.task.status, 'DONE');
  assert.equal(result.delivered, 1);
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].conversationId, 'C_MAIN');
  assert.match(deliveries[0].message, /\[ZERO_SUBAGENT_RESULT\]/);
  assert.match(deliveries[0].message, /ผลลัพธ์ X/);
  assert.equal(mailbox.list({ filePath: ctx.mailboxFile, pendingOnly: true }).length, 0);
  ctx.cleanup();
});

// --- CLI wiring ---

const cliSetup = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-cli-talk-'));
  const sessionFile = path.join(dir, 'session.json');
  fs.writeFileSync(sessionFile, JSON.stringify({ headers: { Cookie: 'a=b' } }));
  const enc = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const env = {
    ZERO_CHATGPT_ACCESS_TOKEN: `${enc({ alg: 'none' })}.${enc({ exp: Math.floor(Date.now() / 1000) + 120 })}.x`,
    ZERO_CHATGPT_SESSION_FILE: sessionFile,
    ZERO_AGENT_TASK_FILE: path.join(dir, 'tasks.json')
  };
  const output = { text: '', write(v) { this.text += v; } };
  return { dir, env, output, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
};

test('CLI agent say ส่ง message ให้ sendMessage', async () => {
  const ctx = cliSetup();
  let received = null;
  const result = await cli.run(['chatgpt', 'agent', 'say', 'T1', 'เอาแบบ A'], ctx.env, ctx.output, {
    sendMessage: async (x) => { received = x; return { status: 'DISPATCHED', task_id: x.taskId, agent_id: 'C_W', current_node: 'N1' }; }
  });
  assert.equal(result.exitCode, 0);
  assert.equal(received.taskId, 'T1');
  assert.equal(received.message, 'เอาแบบ A');
  assert.match(ctx.output.text, /status=DISPATCHED/);
  ctx.cleanup();
});

test('CLI agent reply ส่ง message ให้ replyAgent', async () => {
  const ctx = cliSetup();
  let received = null;
  const result = await cli.run(['chatgpt', 'agent', 'reply', 'T1', 'ถามกลับ'], ctx.env, ctx.output, {
    replyAgent: async (x) => { received = x; return { status: 'REPLIED', task_id: x.taskId, parent_conversation_id: 'C_MAIN', current_node: 'N2' }; }
  });
  assert.equal(result.exitCode, 0);
  assert.equal(received.taskId, 'T1');
  assert.equal(received.message, 'ถามกลับ');
  assert.match(ctx.output.text, /status=REPLIED/);
  ctx.cleanup();
});

test('CLI agent check/status/list ทำงานและพิมพ์สถานะ', async () => {
  const ctx = cliSetup();
  const checkResult = await cli.run(['chatgpt', 'agent', 'check', 'T1'], ctx.env, ctx.output, {
    checkAgent: async () => ({ task: { status: 'DONE', task_id: 'T1', delivery_status: 'DELIVERED' }, delivered: 1 })
  });
  assert.equal(checkResult.exitCode, 0);
  assert.match(ctx.output.text, /status=DONE/);
  assert.match(ctx.output.text, /delivered=1/);

  const statusResult = await cli.run(['chatgpt', 'agent', 'status', 'T1'], ctx.env, ctx.output, {
    agentStatus: () => ({ task_id: 'T1', status: 'RUNNING', worker_conversation_id: 'C_W', parent_conversation_id: 'C_P' })
  });
  assert.equal(statusResult.exitCode, 0);
  assert.match(ctx.output.text, /worker=C_W/);

  const listResult = await cli.run(['chatgpt', 'agent', 'list'], ctx.env, ctx.output, {
    listAgents: () => [{ task_id: 'T1', status: 'RUNNING', worker_conversation_id: 'C_W', parent_conversation_id: 'C_P' }]
  });
  assert.equal(listResult.exitCode, 0);
  assert.match(ctx.output.text, /tasks=1/);
  ctx.cleanup();
});

// --- regression: dispatch baseline ต้องเป็น node ก่อนส่ง ไม่ใช่ reply ของ worker ---

test('sendMessage เก็บ previous_node เป็น baseline กัน current_node ชน reply ของ worker', async () => {
  const ctx = setup();
  // จำลองเคสจริง: หลังส่ง say ห้องตอบไวมาก current_node = reply ของ worker เลย
  await orchestrator.sendMessage({
    taskFile: ctx.taskFile, taskId: 'T1', message: 'ปลุก',
    sendConversation: async () => ({ current_node: 'N_WORKER_REPLY', previous_node: 'N_BEFORE_SAY' })
  });
  const task = taskRegistry.getTask({ filePath: ctx.taskFile, taskId: 'T1' });
  assert.equal(task.dispatch_node_id, 'N_BEFORE_SAY');
  // และ checkTask ต้องเก็บ reply นั้นได้ ไม่มองข้าม
  const checked = await orchestrator.checkTask({
    taskFile: ctx.taskFile, mailboxFile: ctx.mailboxFile, taskId: 'T1',
    getConversation: async () => ({
      current_node: 'N_WORKER_REPLY',
      messages: [{ id: 'N_WORKER_REPLY', author: { role: 'assistant' }, status: 'finished_successfully', end_turn: true, content: { content: 'ผลงาน' } }]
    })
  });
  assert.equal(checked.status, 'DONE');
  assert.equal(checked.result_text, 'ผลงาน');
  ctx.cleanup();
});

test('sendMessage fallback: ไม่มี previous_node ใช้ current_node เหมือนเดิม', async () => {
  const ctx = setup();
  await orchestrator.sendMessage({
    taskFile: ctx.taskFile, taskId: 'T1', message: 'ปลุก',
    sendConversation: async () => ({ current_node: 'N_ONLY' })
  });
  const task = taskRegistry.getTask({ filePath: ctx.taskFile, taskId: 'T1' });
  assert.equal(task.dispatch_node_id, 'N_ONLY');
  ctx.cleanup();
});

test('spawnAgent เก็บ previous_node เป็น baseline เช่นกัน', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-agent-baseline-'));
  const taskFile = path.join(dir, 'tasks.json');
  const result = await orchestrator.spawnAgent({
    taskFile,
    workerConversationId: 'C_W', parentConversationId: 'C_P', taskMessage: 'งาน X',
    getConversation: async () => ({ current_node: 'N_P' }),
    sendConversation: async () => ({ current_node: 'N_FAST_REPLY', previous_node: 'N_BEFORE' })
  });
  const task = taskRegistry.getTask({ filePath: taskFile, taskId: result.task_id });
  assert.equal(task.dispatch_node_id, 'N_BEFORE');
  fs.rmSync(dir, { recursive: true, force: true });
});
