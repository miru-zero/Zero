'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const localTools = require('../src/local-tools');

test('local tools allow reads inside ZERO_AGENT_ROOTS', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-agent-root-'));
  fs.writeFileSync(path.join(root, 'hello.txt'), 'hello', 'utf8');
  const result = localTools.execute('command.listDirectory', { path: root, depth: 1 }, { ZERO_AGENT_ROOTS: root });
  assert.equal(result.ok, true);
  assert.deepEqual(result.entries.map((item) => item.relativePath), ['hello.txt']);
});

test('local tools read multiple files with per-file results', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-agent-multi-'));
  const a = path.join(root, 'a.txt');
  const b = path.join(root, 'b.txt');
  fs.writeFileSync(a, 'a1\na2', 'utf8');
  fs.writeFileSync(b, 'b1\nb2', 'utf8');
  const result = localTools.execute('command.readFiles', {
    paths: [a, b, path.join(root, 'missing.txt')],
    offset: 0,
    length: 1
  }, { ZERO_AGENT_ROOTS: root });
  assert.equal(result.count, 3);
  assert.equal(result.succeeded, 2);
  assert.equal(result.failed, 1);
  assert.match(result.files[0].content, /a1/);
  assert.match(result.files[1].content, /b1/);
  assert.equal(result.files[2].ok, false);

  const perFile = localTools.execute('command.readFiles', {
    files: [{ path: a, offset: 1, length: 1 }, { path: b, offset: 0, length: 1 }]
  }, { ZERO_AGENT_ROOTS: root });
  assert.equal(perFile.ok, true);
  assert.match(perFile.files[0].content, /a2/);
  assert.match(perFile.files[1].content, /b1/);
});

test('local tools reject paths outside ZERO_AGENT_ROOTS', () => {
  const allowed = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-agent-allowed-'));
  const denied = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-agent-denied-'));
  assert.throws(
    () => localTools.execute('command.listDirectory', { path: denied, depth: 1 }, { ZERO_AGENT_ROOTS: allowed }),
    (error) => error.code === 'PATH_NOT_ALLOWED'
  );
});
