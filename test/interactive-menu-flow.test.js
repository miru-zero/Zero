const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const interactiveMenu = require('../src/interactive-menu');
const chatgptProvider = require('../src/providers/chatgpt');

const capture = () => {
  let text = '';
  return { output: { write(value) { text += value; return true; } }, text: () => text };
};

const scriptedQuestion = (...answers) => {
  const queue = [...answers];
  return async () => queue.shift() ?? '';
};

const fallbackInput = () => Readable.from(['q\n']);

test('interactive menu stays open after provider tool execution', async () => {
  const io = capture();
  const calls = [];
  const result = await interactiveMenu.run({
    input: fallbackInput(), output: io.output,
    providers: [{ name: 'chatgpt', type: 'internal' }],
    question: scriptedQuestion('1', '1', '', 'b', 'q'),
    listTools: async () => [{ name: 'agent_list', description: 'list tasks', inputSchema: { type: 'object', properties: {} } }],
    executeTool: async (provider, tool, args) => { calls.push({ provider, tool, args }); return { tasks: [] }; }
  });  assert.equal(result.exitCode, 0);
  assert.equal(result.action, 'exit');
  assert.deepEqual(calls, [{ provider: 'chatgpt', tool: 'agent_list', args: {} }]);
  assert.match(io.text(), /chatgpt \[internal\]/);
  assert.match(io.text(), /agent_list/);
});

test('interactive menu prompts required tool args from inputSchema', async () => {
  const calls = [];
  await interactiveMenu.run({
    input: fallbackInput(), output: { write() { return true; } },
    providers: [{ name: 'chatgpt', type: 'internal' }],
    question: scriptedQuestion('1', '1', 'c-123', '', 'b', 'q'),
    listTools: async () => [{
      name: 'conversation_get', description: 'get room',
      inputSchema: {
        type: 'object',
        properties: { conversation_id: { type: 'string' } },
        required: ['conversation_id']
      }
    }],
    executeTool: async (provider, tool, args) => { calls.push({ provider, tool, args }); return {}; }
  });
  assert.deepEqual(calls[0], { provider: 'chatgpt', tool: 'conversation_get', args: { conversation_id: 'c-123' } });
});
test('chatgpt provider exposes machine-readable inputSchema for internal tools', () => {
  const tools = chatgptProvider.listTools();
  const get = tools.find((tool) => tool.name === 'conversation_get');
  const send = tools.find((tool) => tool.name === 'conversation_send');
  const spawn = tools.find((tool) => tool.name === 'agent_spawn');
  assert.ok(get?.inputSchema);
  assert.deepEqual(get.inputSchema.required, ['conversation_id']);
  assert.equal(get.inputSchema.properties.conversation_id.type, 'string');
  assert.deepEqual(send.inputSchema.required, ['conversation_id', 'message']);
  assert.deepEqual(spawn.inputSchema.required, ['worker_conversation_id', 'parent_conversation_id', 'message']);
});

const cli = require('../src/cli');

test('zero no-args wires provider list/call callbacks into the interactive menu', async () => {
  const calls = [];
  const hub = {
    listProviders: () => [{ name: 'plug-a', type: 'mcp-stdio' }],
    getProvider: () => ({ name: 'plug-a', type: 'mcp-stdio' }),
    listTools: async () => [{ name: 'ping', inputSchema: { type: 'object', properties: {} } }],
    callTool: async (provider, tool, args) => { calls.push({ provider, tool, args }); return { pong: true }; },
    close: () => {}
  };
  const result = await cli.run([], { ZERO_JOURNAL: 'off' }, { write() { return true; } }, {
    createHub: () => hub,
    interactiveMenu: async ({ listTools, executeTool }) => {
      const tools = await listTools('plug-a');
      assert.equal(tools[0].name, 'ping');
      assert.deepEqual(await executeTool('plug-a', 'ping', { x: 1 }), { pong: true });
      return { exitCode: 0, action: 'exit' };
    }
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(calls, [{ provider: 'plug-a', tool: 'ping', args: { x: 1 } }]);
});