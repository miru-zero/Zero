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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-cli-agent-callback-'));
  const sessionFile = path.join(dir, 'session.json');
  fs.writeFileSync(sessionFile, JSON.stringify({ headers: { Cookie: 'a=b' } }));
  const env = {
    ZERO_CHATGPT_ACCESS_TOKEN: makeJwt(Math.floor(Date.now() / 1000) + 120),
    ZERO_CHATGPT_SESSION_FILE: sessionFile,
    ZERO_AGENT_TASK_FILE: path.join(dir, 'tasks.json')
  };
  const output = { text: '', write(value) { this.text += value; } };
  return { dir, env, output };
};

test('CLI agent spawn dispatches without starting a watcher', async () => {
  const ctx = setup();
  let received = null;
  const result = await cli.run(
    ['chatgpt', 'agent', 'spawn', 'C_WORKER', 'C_MAIN', 'do one cycle'],
    ctx.env,
    ctx.output,
    {
      spawnAgent: async (input) => {
        received = input;
        return { status: 'DISPATCHED', task_id: 'T1', agent_id: 'C_WORKER', current_node: 'N_DISPATCH' };
      }
    }
  );
  assert.equal(result.exitCode, 0);
  assert.equal(received.workerConversationId, 'C_WORKER');
  assert.equal(received.parentConversationId, 'C_MAIN');
  assert.equal(received.taskMessage, 'do one cycle');
  assert.equal(received.taskFile, ctx.env.ZERO_AGENT_TASK_FILE);
  assert.match(ctx.output.text, /status=DISPATCHED/);
  assert.match(ctx.output.text, /task_id=T1/);
  assert.doesNotMatch(ctx.output.text, /watcher/i);
  fs.rmSync(ctx.dir, { recursive: true, force: true });
});

test('CLI agent return pushes worker report through task metadata', async () => {
  const ctx = setup();
  let received = null;
  const result = await cli.run(
    ['chatgpt', 'agent', 'return', 'T1', 'FACT\n- done\nNEXT\n- stop'],
    ctx.env,
    ctx.output,
    {
      returnAgent: async (input) => {
        received = input;
        return { status: 'DELIVERED', task_id: 'T1', parent_conversation_id: 'C_MAIN', current_node: 'N_PARENT_RETURN' };
      }
    }
  );
  assert.equal(result.exitCode, 0);
  assert.equal(received.taskId, 'T1');
  assert.equal(received.report, 'FACT\n- done\nNEXT\n- stop');
  assert.equal(received.taskFile, ctx.env.ZERO_AGENT_TASK_FILE);
  assert.match(ctx.output.text, /status=DELIVERED/);
  assert.match(ctx.output.text, /parent_conversation_id=C_MAIN/);
  assert.match(ctx.output.text, /current_node=N_PARENT_RETURN/);
  fs.rmSync(ctx.dir, { recursive: true, force: true });
});
