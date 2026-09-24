const test = require('node:test');
const assert = require('node:assert/strict');
const mcp = require('../src/api/mcp');

const makeFakeHub = () => ({
  callTool: async (provider, tool, args) => ({ provider, tool, args }),
  close() {}
});

test('MCP exposes fixed ZERO devices tools', async () => {
  const listed = await mcp.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }, {});
  const names = listed.result.tools.map((tool) => tool.name);
  assert.ok(names.includes('zero.devices.list'));
  assert.ok(names.includes('zero.devices.status'));
  assert.ok(names.includes('zero.devices.heartbeat'));
  assert.ok(names.includes('zero.devices.exec'));
});

test('MCP routes zero.devices.list to devices provider list', async () => {
  const reply = await mcp.handle({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name: 'zero.devices.list', arguments: { onlineOnly: true } }
  }, { createHub: () => makeFakeHub(), env: {}, context: {} });

  assert.equal(reply.result.structuredContent.provider, 'devices');
  assert.equal(reply.result.structuredContent.tool, 'list');
  assert.deepEqual(reply.result.structuredContent.args, { onlineOnly: true });
});

test('MCP routes zero.devices.status to devices provider status', async () => {
  const reply = await mcp.handle({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'zero.devices.status', arguments: { name: 'MiruZero' } }
  }, { createHub: () => makeFakeHub(), env: {}, context: {} });

  assert.equal(reply.result.structuredContent.provider, 'devices');
  assert.equal(reply.result.structuredContent.tool, 'status');
  assert.deepEqual(reply.result.structuredContent.args, { name: 'MiruZero' });
});

test('MCP routes zero.devices.heartbeat to devices provider heartbeat', async () => {
  const reply = await mcp.handle({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: { name: 'zero.devices.heartbeat', arguments: { device_id: 'dev_1' } }
  }, { createHub: () => makeFakeHub(), env: {}, context: {} });

  assert.equal(reply.result.structuredContent.provider, 'devices');
  assert.equal(reply.result.structuredContent.tool, 'heartbeat');
  assert.deepEqual(reply.result.structuredContent.args, { device_id: 'dev_1' });
});


test('MCP routes zero.devices.exec to devices provider exec', async () => {
  const reply = await mcp.handle({
    jsonrpc: '2.0',
    id: 5,
    method: 'tools/call',
    params: { name: 'zero.devices.exec', arguments: { name: 'TON', tool: 'command.listDirectory', arguments: { path: 'C:/tmp' } } }
  }, { createHub: () => makeFakeHub(), env: {}, context: {} });

  assert.equal(reply.result.structuredContent.provider, 'devices');
  assert.equal(reply.result.structuredContent.tool, 'exec');
  assert.equal(reply.result.structuredContent.args.name, 'TON');
});
