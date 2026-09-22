const test = require('node:test');
const assert = require('node:assert/strict');

test('ChatGPT SSE parser extracts assistant append patches across chunk boundaries', () => {
  const stream = require('../src/llm/chatgpt-sse');
  const deltas = [];
  let done = 0;
  const parser = stream.createParser({
    onDelta: (text) => deltas.push(text),
    onDone: () => { done += 1; }
  });

  const first = 'data: {"o":"patch","v":[{"p":"/message/content/parts/0","o":"append","v":"Hel';
  const second = 'lo"}]}\n\ndata: {"o":"patch","v":[{"p":"/message/content/parts/0","o":"append","v":" world"}]}\n\n';
  parser.push(Buffer.from(first));
  assert.deepEqual(deltas, []);
  parser.push(Buffer.from(second));

  assert.deepEqual(deltas, ['Hello', ' world']);
  assert.equal(done, 0);
});

test('ChatGPT SSE parser ignores non-content events and finishes once', () => {
  const stream = require('../src/llm/chatgpt-sse');
  const deltas = [];
  let done = 0;
  const parser = stream.createParser({
    onDelta: (text) => deltas.push(text),
    onDone: () => { done += 1; }
  });

  parser.push(Buffer.from('data: {"type":"message_marker","marker":"last_token"}\n\n'));
  parser.push(Buffer.from('data: {"type":"message_stream_complete","conversation_id":"c1"}\n\n'));
  parser.push(Buffer.from('data: [DONE]\n\n'));

  assert.deepEqual(deltas, []);
  assert.equal(done, 1);
});

test('ChatGPT SSE parser does not report completion for a truncated transport', () => {
  const stream = require('../src/llm/chatgpt-sse');
  let done = 0;
  const parser = stream.createParser({ onDone: () => { done += 1; } });
  parser.push(Buffer.from('data: {"type":"message_stream_complete","conversation_id":"c1"}\n\n'));
  parser.end();
  assert.equal(done, 0);
});

test('ChatGPT SSE parser preserves initial final-message snapshot before append patches', () => {
  const stream = require('../src/llm/chatgpt-sse');
  const deltas = [];
  const parser = stream.createParser({
    onDelta: (text) => deltas.push(text)
  });

  parser.push(Buffer.from(
    'data: {"v":{"message":{"id":"m1","author":{"role":"assistant"},' +
    '"content":{"content_type":"text","parts":["NODE_STREAM"]},' +
    '"channel":"final"}}}\n\n'
  ));
  parser.push(Buffer.from(
    'data: {"o":"patch","v":[{"p":"/message/content/parts/0",' +
    '"o":"append","v":"_OK"}]}\n\n'
  ));
  parser.push(Buffer.from('data: [DONE]\n\n'));

  assert.deepEqual(deltas, ['NODE_STREAM', '_OK']);
  assert.equal(deltas.join(''), 'NODE_STREAM_OK');
});

test('ChatGPT SSE parser surfaces conversation_id before stream completion', () => {
  const stream = require('../src/llm/chatgpt-sse');
  const ids = [];
  let done = 0;
  const parser = stream.createParser({
    onConversationId: (id) => ids.push(id),
    onDone: () => { done += 1; }
  });

  parser.push(Buffer.from(
    'data: {"type":"resume_conversation_token","conversation_id":"conv-stream-id"}\n\n'
  ));
  parser.push(Buffer.from(
    'data: {"type":"message_stream_complete","conversation_id":"conv-stream-id"}\n\n'
  ));
  parser.push(Buffer.from('data: [DONE]\n\n'));

  assert.deepEqual(ids, ['conv-stream-id']);
  assert.equal(done, 1);
});

test('ChatGPT SSE parser handles direct delta append operations', () => {
  const stream = require('../src/llm/chatgpt-sse');
  const deltas = [];
  const parser = stream.createParser({
    onDelta: (text) => deltas.push(text)
  });

  parser.push(Buffer.from(
    'event: delta\n' +
    'data: {"p":"/message/content/parts/0","o":"append","v":"OR"}\n\n'
  ));
  parser.push(Buffer.from(
    'event: delta\n' +
    'data: {"o":"patch","v":[{"p":"/message/content/parts/0","o":"append","v":"BIT-MINT-842"}]}\n\n'
  ));
  parser.push(Buffer.from('data: [DONE]\n\n'));

  assert.deepEqual(deltas, ['OR', 'BIT-MINT-842']);
  assert.equal(deltas.join(''), 'ORBIT-MINT-842');
});

test('ChatGPT SSE parser emits only the new suffix for cumulative replace patches', () => {
  const stream = require('../src/llm/chatgpt-sse');
  const deltas = [];
  const parser = stream.createParser({
    onDelta: (text) => deltas.push(text)
  });

  parser.push(Buffer.from(
    'data: {"v":{"message":{"author":{"role":"assistant"},' +
    '"content":{"content_type":"text","parts":["A"]},"channel":"final"}}}\n\n'
  ));
  parser.push(Buffer.from(
    'data: {"o":"patch","v":[{"p":"/message/content/parts/0",' +
    '"o":"replace","v":"AQUA"}]}\n\n'
  ));
  parser.push(Buffer.from(
    'data: {"o":"patch","v":[{"p":"/message/content/parts/0",' +
    '"o":"replace","v":"AQUA-MOON-417"}]}\n\n'
  ));
  parser.push(Buffer.from('data: [DONE]\n\n'));

  assert.deepEqual(deltas, ['A', 'QUA', '-MOON-417']);
  assert.equal(deltas.join(''), 'AQUA-MOON-417');
});
