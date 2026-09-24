'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const caps = require('../src/capabilities');

test('buildCapabilities scans Zero_MCP providers and hashes catalog', () => {
  const result = caps.buildCapabilities({ ZERO_MCP_ROOT: 'M:/Zero_MCP' });
  assert.equal(result.mcp_root, 'M:\\Zero_MCP');
  assert.ok(result.providers.some((item) => item.name === 'chatgpt'));
  assert.match(result.capability_hash, /^[a-f0-9]{64}$/);
});

test('chatgpt internal tools include conversation_get when runtime is present', () => {
  const result = caps.buildCapabilities({ ZERO_MCP_ROOT: 'M:/Zero_MCP' });
  const chatgpt = result.providers.find((item) => item.name === 'chatgpt');
  assert.ok(chatgpt);
  assert.ok(chatgpt.tools.some((tool) => tool.name === 'conversation_get'));
});

test('buildCapabilities always advertises built-in agent local tools', () => {
  const result = caps.buildCapabilities({ ZERO_MCP_ROOT: 'M:/Zero_MCP/does-not-exist' });
  const local = result.providers.find((item) => item.name === 'zero-agent-local');
  assert.ok(local);
  assert.equal(local.type, 'internal');
  assert.ok(local.tools.some((tool) => tool.name === 'listDirectory'));
  assert.ok(local.tools.some((tool) => tool.name === 'readFile'));
  assert.equal(local.tool_count, local.tools.length);
});
