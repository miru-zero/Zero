const test = require('node:test');
const assert = require('node:assert/strict');
const conversations = require('../src/providers/chatgpt/conversations');
const chatgptProvider = require('../src/providers/chatgpt');

test('conversation_new exposes neutral Web protocol context controls', () => {
  const tool = chatgptProvider.listTools().find((item) => item.name === 'conversation_new');
  const p = tool.inputSchema.properties;
  assert.equal(p.system_hints.type, 'array');
  assert.equal(p.local_function_names.type, 'array');
  assert.equal(p.timezone.type, 'string');
  assert.equal(p.timezone_offset_min.type, 'integer');
  assert.equal(p.enable_message_followups.type, 'boolean');
  assert.equal(p.client_contextual_info.type, 'object');
  assert.equal(p.model_response_contracts.type, 'array');
  assert.equal(p.force_parallel_switch.type, 'string');
  assert.equal(p.paragen_cot_summary_display_override.type, 'string');
});

test('conversation_send exposes neutral Web protocol context controls', () => {
  const tool = chatgptProvider.listTools().find((item) => item.name === 'conversation_send');
  const p = tool.inputSchema.properties;
  assert.equal(p.system_hints.type, 'array');
  assert.equal(p.local_function_names.type, 'array');
  assert.equal(p.timezone.type, 'string');
  assert.equal(p.timezone_offset_min.type, 'integer');
  assert.equal(p.enable_message_followups.type, 'boolean');
  assert.equal(p.client_contextual_info.type, 'object');
  assert.equal(p.model_response_contracts.type, 'array');
  assert.equal(p.force_parallel_switch.type, 'string');
  assert.equal(p.paragen_cot_summary_display_override.type, 'string');
});

test('conversation_new maps Web protocol context to low-level API', async () => {
  const original = conversations.createConversation;
  let seen;
  conversations.createConversation = async (args) => { seen = args; return { conversation_id: 'c-new' }; };
  try {
    await chatgptProvider.callTool('conversation_new', {
      message: 'hello',
      system_hints: ['agent'],
      local_function_names: ['local.example'],
      timezone: 'Asia/Bangkok',
      timezone_offset_min: -420,
      enable_message_followups: true,
      client_contextual_info: { app_name: 'chatgpt.com', is_dark_mode: true },
      model_response_contracts: [{ id: 'custom.v1', protocol_version: 1 }],
      force_parallel_switch: 'auto',
      paragen_cot_summary_display_override: 'allow'
    }, { token: 't', sessionHeaders: {} });

    assert.deepEqual(seen.systemHints, ['agent']);
    assert.deepEqual(seen.localFunctionNames, ['local.example']);
    assert.equal(seen.timezone, 'Asia/Bangkok');
    assert.equal(seen.timezoneOffsetMin, -420);
    assert.equal(seen.enableMessageFollowups, true);
    assert.deepEqual(seen.clientContextualInfo, { app_name: 'chatgpt.com', is_dark_mode: true });
    assert.deepEqual(seen.modelResponseContracts, [{ id: 'custom.v1', protocol_version: 1 }]);
    assert.equal(seen.forceParallelSwitch, 'auto');
    assert.equal(seen.paragenCotSummaryDisplayOverride, 'allow');
  } finally {
    conversations.createConversation = original;
  }
});

test('conversation_send maps Web protocol context to low-level API', async () => {
  const original = conversations.sendConversation;
  let seen;
  conversations.sendConversation = async (args) => { seen = args; return { conversation_id: 'c1' }; };
  try {
    await chatgptProvider.callTool('conversation_send', {
      conversation_id: 'c1',
      message: 'hello',
      system_hints: ['agent'],
      local_function_names: ['local.example'],
      timezone: 'Asia/Bangkok',
      timezone_offset_min: -420,
      enable_message_followups: false,
      client_contextual_info: { app_name: 'chatgpt.com', page_width: 890 },
      model_response_contracts: [{ id: 'custom.v1', protocol_version: 1 }],
      force_parallel_switch: 'auto',
      paragen_cot_summary_display_override: 'allow'
    }, { token: 't', sessionHeaders: {} });

    assert.deepEqual(seen.systemHints, ['agent']);
    assert.deepEqual(seen.localFunctionNames, ['local.example']);
    assert.equal(seen.timezone, 'Asia/Bangkok');
    assert.equal(seen.timezoneOffsetMin, -420);
    assert.equal(seen.enableMessageFollowups, false);
    assert.deepEqual(seen.clientContextualInfo, { app_name: 'chatgpt.com', page_width: 890 });
    assert.deepEqual(seen.modelResponseContracts, [{ id: 'custom.v1', protocol_version: 1 }]);
    assert.equal(seen.forceParallelSwitch, 'auto');
    assert.equal(seen.paragenCotSummaryDisplayOverride, 'allow');
  } finally {
    conversations.sendConversation = original;
  }
});
