const test = require('node:test');
const assert = require('node:assert/strict');
const chatgptProvider = require('../src/providers/chatgpt');
const cli = require('../src/cli');

const capture = () => {
  let text = '';
  return { output: { write(value) { text += value; return true; } }, text: () => text };
};

test('ChatGPT provider descriptions state actual paging and send wait semantics', () => {
  const tools = new Map(chatgptProvider.listTools().map((tool) => [tool.name, tool]));
  const listText = tools.get('conversations_list').description;
  const sendText = tools.get('conversation_send').description;
  assert.doesNotMatch(listText, /ลิสต์ทุกห้อง/);
  assert.match(listText, /หนึ่ง global page/);
  assert.match(listText, /nextOffset/);
  assert.doesNotMatch(sendText, /คืนทันที/);
  assert.match(sendText, /direct/);
  assert.match(sendText, /response/);
  assert.match(sendText, /browser/);
  assert.match(sendText, /submission acknowledgement/);
});

test('ChatGPT CLI help does not claim all conversations or immediate direct send', async () => {
  const io = capture();
  const result = await cli.run(['chatgpt', 'bogus'], { ZERO_JOURNAL: 'off' }, io.output, {});
  assert.equal(result.exitCode, 64);
  const text = io.text();
  assert.doesNotMatch(text, /ลิสต์ทุกห้อง/);
  assert.doesNotMatch(text, /คืนทันที ไม่รอคำตอบ/);
  assert.match(text, /หนึ่ง global page/);
  assert.match(text, /direct รอ response/);
  assert.match(text, /คืนหลัง dispatch.*ไม่รอ worker จบ/);
});