const test = require('node:test');
const assert = require('node:assert/strict');
const mcp = require('../src/api/mcp');

const makeFakeHub = () => ({
  callTool: async (provider, tool, args) => ({ provider, tool, args }),
  close() {}
});

test('MCP exposes ZERO Command fixed filesystem tools', async () => {
  const listed = await mcp.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }, {});
  const names = listed.result.tools.map((tool) => tool.name);
  assert.ok(names.includes('zero.command.readFile'));
  assert.ok(names.includes('zero.command.readFiles'));
  assert.ok(names.includes('zero.command.writeFile'));
  assert.ok(names.includes('zero.command.replaceFile'));
  assert.ok(names.includes('zero.command.createDirectory'));
  assert.ok(names.includes('zero.command.deleteFile'));
  assert.ok(names.includes('zero.command.globFiles'));
  assert.ok(names.includes('zero.command.grepFiles'));
  assert.ok(names.includes('zero.command.listDirectory'));
  assert.ok(names.includes('zero.command.getFileInfo'));
});
test('MCP routes zero.command.readFile to command provider readFile', async () => {
  const reply = await mcp.handle({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'zero.command.readFile',
      arguments: { path: 'M:/Zero_MCP/README.md', offset: 0, length: 2 }
    }
  }, { createHub: () => makeFakeHub(), env: {}, context: {} });

  assert.equal(reply.result.structuredContent.provider, 'command');
  assert.equal(reply.result.structuredContent.tool, 'readFile');
  assert.deepEqual(reply.result.structuredContent.args, {
    path: 'M:/Zero_MCP/README.md',
    offset: 0,
    length: 2
  });
});

test('MCP routes zero.command.readFiles to command provider readFiles', async () => {
  const reply = await mcp.handle({
    jsonrpc: '2.0', id: 4, method: 'tools/call',
    params: {
      name: 'zero.command.readFiles',
      arguments: { paths: ['M:/Zero_MCP/README.md', 'M:/Zero_MCP/docs/zero-agent-ton-e2e-2026-09-24.md'], offset: 0, length: 2 }
    }
  }, { createHub: () => makeFakeHub(), env: {}, context: {} });
  assert.equal(reply.result.structuredContent.provider, 'command');
  assert.equal(reply.result.structuredContent.tool, 'readFiles');
  assert.deepEqual(reply.result.structuredContent.args.paths, [
    'M:/Zero_MCP/README.md',
    'M:/Zero_MCP/docs/zero-agent-ton-e2e-2026-09-24.md'
  ]);
});

test('MCP routes zero.command.deleteFile to command provider deleteFile', async () => {
  const reply = await mcp.handle({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'zero.command.deleteFile',
      arguments: { path: 'M:/Zero_MCP/tmp/delete-me.txt' }
    }
  }, { createHub: () => makeFakeHub(), env: {}, context: {} });

  assert.equal(reply.result.structuredContent.provider, 'command');
  assert.equal(reply.result.structuredContent.tool, 'deleteFile');
  assert.deepEqual(reply.result.structuredContent.args, {
    path: 'M:/Zero_MCP/tmp/delete-me.txt'
  });
});
