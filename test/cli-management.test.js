const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cli = require('../src/cli');

const makeJwt = (exp) => { const enc = v => Buffer.from(JSON.stringify(v)).toString('base64url'); return enc({alg:'none'}) + '.' + enc({exp}) + '.x'; };
const setup = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-mgmt-'));
  const sessionFile = path.join(dir, 'session.json');
  fs.writeFileSync(sessionFile, JSON.stringify({ headers: { Cookie: 'a=b' } }));
  return { dir, env: { ZERO_CHATGPT_ACCESS_TOKEN: makeJwt(Math.floor(Date.now()/1000)+120), ZERO_CHATGPT_SESSION_FILE: sessionFile }, output: { text:'', write(v){this.text+=v;} } };
};

test('CLI dispatches conversation rename delete move and exit', async () => {
  const calls=[]; const ctx=setup();
  const deps={ renameConversation: async x=>{calls.push(['rename',x.conversationId,x.title]);return{};}, deleteConversation:async x=>{calls.push(['del',x.conversationId]);return{};}, moveConversation:async x=>{calls.push(['move',x.conversationId,x.projectId]);return{};} };
  assert.equal((await cli.run(['chatgpt', 'conversation','rename','c1','Name'],ctx.env,ctx.output,deps)).exitCode,0);
  assert.equal((await cli.run(['chatgpt', 'conversation','del','c1'],ctx.env,ctx.output,deps)).exitCode,0);
  assert.equal((await cli.run(['chatgpt', 'conversation','move','c1','g-p-1'],ctx.env,ctx.output,deps)).exitCode,0);
  assert.equal((await cli.run(['chatgpt', 'conversation','move','c1','exit'],ctx.env,ctx.output,deps)).exitCode,0);
  assert.deepEqual(calls, [['rename','c1','Name'],['del','c1'],['move','c1','g-p-1'],['move','c1',null]]);
  assert.match(ctx.output.text,/status=OK/); fs.rmSync(ctx.dir,{recursive:true,force:true});
});

test('CLI dispatches project new rename and delete', async () => {
  const calls=[]; const ctx=setup();
  const deps={ createProject:async x=>{calls.push(['new',x.name]);return{id:'g-p-new'};}, renameProject:async x=>{calls.push(['rename',x.projectId,x.name]);return{};}, deleteProject:async x=>{calls.push(['del',x.projectId]);return{};} };
  assert.equal((await cli.run(['chatgpt', 'project','new','Project X'],ctx.env,ctx.output,deps)).exitCode,0);
  assert.equal((await cli.run(['chatgpt', 'project','rename','g-p-1','Project Y'],ctx.env,ctx.output,deps)).exitCode,0);
  assert.equal((await cli.run(['chatgpt', 'project','del','g-p-1'],ctx.env,ctx.output,deps)).exitCode,0);
  assert.deepEqual(calls,[['new','Project X'],['rename','g-p-1','Project Y'],['del','g-p-1']]);
  assert.match(ctx.output.text,/project_id=g-p-new/); fs.rmSync(ctx.dir,{recursive:true,force:true});
});
test('CLI dispatches conversation new', async () => {
  const ctx=setup();
  let received=null;
  const result=await cli.run(['chatgpt', 'conversation','new','hello'],ctx.env,ctx.output,{
    createConversation:async x=>{received=x;return{conversation_id:'c-new',current_node:'n-new'};}
  });
  assert.equal(result.exitCode,0);
  assert.equal(received.message,'hello');
  assert.equal(received.projectId,null);
  assert.match(ctx.output.text,/conversation_id=c-new/);
  assert.match(ctx.output.text,/current_node=n-new/);
  fs.rmSync(ctx.dir,{recursive:true,force:true});
});
test('CLI dispatches project conversation new', async () => {
  const ctx=setup();
  let received=null;
  const result=await cli.run(['chatgpt', 'project','conversation','new','g-p-1','hello'],ctx.env,ctx.output,{
    createConversation:async x=>{received=x;return{conversation_id:'c-project',current_node:'n-project'};}
  });
  assert.equal(result.exitCode,0);
  assert.equal(received.message,'hello');
  assert.equal(received.projectId,'g-p-1');
  assert.match(ctx.output.text,/conversation_id=c-project/);
  assert.match(ctx.output.text,/project_id=g-p-1/);
  fs.rmSync(ctx.dir,{recursive:true,force:true});
});

test('CLI dispatches conversation send', async () => {
  const ctx = setup();
  let received = null;
  const result = await cli.run(['chatgpt', 'conversation', 'send', 'c-old', 'hello'], ctx.env, ctx.output, {
    sendConversation: async (input) => {
      received = input;
      return { conversation_id: 'c-old', current_node: 'node-new' };
    }
  });
  assert.equal(result.exitCode, 0);
  assert.equal(received.conversationId, 'c-old');
  assert.equal(received.message, 'hello');
  assert.match(ctx.output.text, /status=DISPATCHED/);
  assert.doesNotMatch(ctx.output.text, /status=OK/);
  assert.match(ctx.output.text, /conversation_id=c-old/);
  assert.match(ctx.output.text, /current_node=node-new/);
  fs.rmSync(ctx.dir, { recursive: true, force: true });
});
test('CLI defaults conversation send to direct transport', async () => {
  const ctx = setup();
  let received = null;
  const result = await cli.run(['chatgpt', 'conversation', 'send', 'c1', 'hello'], ctx.env, ctx.output, {
    sendConversation: async (input) => {
      received = input;
      return { conversation_id: 'c1', current_node: 'n2' };
    }
  });
  assert.equal(result.exitCode, 0);
  assert.equal(received.transport, 'direct');
  fs.rmSync(ctx.dir, { recursive: true, force: true });
});

test('CLI uses browser transport only when explicitly requested', async () => {
  const ctx = setup();
  let received = null;
  const result = await cli.run(['chatgpt', 'conversation', 'send', 'c1', 'hello'], { ...ctx.env, ZERO_CHATGPT_SEND_TRANSPORT: 'browser' }, ctx.output, {
    sendConversation: async (input) => {
      received = input;
      return { conversation_id: 'c1', current_node: 'n2' };
    }
  });
  assert.equal(result.exitCode, 0);
  assert.equal(received.transport, 'browser');
  fs.rmSync(ctx.dir, { recursive: true, force: true });
});

test('CLI maps browser AUTH_REQUIRED without fatal output', async () => {
  const ctx = setup();
  const result = await cli.run(['chatgpt', 'conversation', 'send', 'c1', 'hello'], ctx.env, ctx.output, {
    sendConversation: async () => {
      const error = new Error('AUTH_REQUIRED');
      error.code = 'AUTH_REQUIRED';
      throw error;
    }
  });
  assert.equal(result.exitCode, 6);
  assert.match(ctx.output.text, /status=AUTH_REQUIRED/);
  fs.rmSync(ctx.dir, { recursive: true, force: true });
});

test('CLI maps browser bridge unavailable without fatal output', async () => {
  const ctx = setup();
  const result = await cli.run(['chatgpt', 'conversation', 'send', 'c1', 'hello'], ctx.env, ctx.output, {
    sendConversation: async () => {
      const error = new Error('BRIDGE_UNAVAILABLE');
      error.code = 'BRIDGE_UNAVAILABLE';
      throw error;
    }
  });
  assert.equal(result.exitCode, 69);
  assert.match(ctx.output.text, /status=BRIDGE_UNAVAILABLE/);
  fs.rmSync(ctx.dir, { recursive: true, force: true });
});

test('CLI resolves an installed @connector into structured plugin selection', async () => {
  const ctx = setup();
  const hint = 'plugin:asdk_app_6a057d268ebc81919918d37eec718425';
  let received = null;
  const result = await cli.run([
    'chatgpt', 'project', 'conversation', 'new', 'g-p-1',
    '@Remote Desktop Commander run list_devices'
  ], ctx.env, ctx.output, {
    listConnectors: async () => [{
      id: 'plugin_asdk_app_6a057d268ebc81919918d37eec718425',
      displayName: 'Remote Desktop Commander',
      enabled: true,
      disabledSkillNames: []
    }],
    createConversation: async (input) => {
      received = input;
      return { conversation_id: 'c-plugin', current_node: 'n-plugin' };
    }
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(received.systemHints, [hint]);
  assert.deepEqual(received.systemHintMentions, [
    { id: hint, startIndex: 0, endIndex: 25 }
  ]);
  fs.rmSync(ctx.dir, { recursive: true, force: true });
});
