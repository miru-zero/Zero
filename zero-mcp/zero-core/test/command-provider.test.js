const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const commandProvider = require('../../providers/command/runtime');

const tmpRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'zero-command-'));

test('command provider exposes basic filesystem tools', () => {
  const names = commandProvider.listTools().map((tool) => tool.name);
  assert.deepEqual(names, [
    'readFile',
    'readFiles',
    'writeFile',
    'replaceFile',
    'createDirectory',
    'deleteFile',
    'listDirectory',
    'getFileInfo',
    'globFiles',
    'grepFiles'
  ]);
});

test('command provider reads, writes and replaces text files with line metadata', async () => {
  const root = tmpRoot();
  const file = path.join(root, 'demo.txt');
  const ctx = { commandRoots: [root] };

  const written = await commandProvider.callTool('writeFile', {
    path: file,
    content: 'alpha\nbeta\nalpha',
    mode: 'overwrite'
  }, ctx);
  assert.equal(written.ok, true);
  assert.equal(written.mode, 'overwrite');

  const read = await commandProvider.callTool('readFile', { path: file }, ctx);
  assert.equal(read.totalLines, 3);
  assert.match(read.content, /1\s+alpha/);
  assert.match(read.content, /2\s+beta/);

  const replaced = await commandProvider.callTool('replaceFile', {
    path: file,
    oldString: 'alpha',
    newString: 'gamma',
    expectedReplacements: 2
  }, ctx);
  assert.equal(replaced.replacements, 2);
  assert.equal(fs.readFileSync(file, 'utf8'), 'gamma\nbeta\ngamma');
});

test('command provider reads multiple files and keeps per-file failures', async () => {
  const root = tmpRoot();
  const ctx = { commandRoots: [root] };
  const a = path.join(root, 'a.txt');
  const b = path.join(root, 'b.txt');
  fs.writeFileSync(a, 'a1\na2', 'utf8');
  fs.writeFileSync(b, 'b1\nb2', 'utf8');
  const result = await commandProvider.callTool('readFiles', {
    paths: [a, b, path.join(root, 'missing.txt')],
    offset: 0,
    length: 1
  }, ctx);
  assert.equal(result.ok, false);
  assert.equal(result.count, 3);
  assert.equal(result.succeeded, 2);
  assert.equal(result.failed, 1);
  assert.match(result.files[0].content, /a1/);
  assert.match(result.files[1].content, /b1/);
  assert.equal(result.files[2].ok, false);

  const perFile = await commandProvider.callTool('readFiles', {
    files: [{ path: a, offset: 1, length: 1 }, { path: b, offset: 0, length: 1 }]
  }, ctx);
  assert.equal(perFile.ok, true);
  assert.match(perFile.files[0].content, /a2/);
  assert.match(perFile.files[1].content, /b1/);
});

test('command provider lists, globs and greps inside allowed roots', async () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'a.js'), 'const token = "ZERO";\n');
  fs.writeFileSync(path.join(root, 'src', 'b.txt'), 'plain text\n');
  const ctx = { commandRoots: [root] };

  const listed = await commandProvider.callTool('listDirectory', { path: root, depth: 2 }, ctx);
  assert.ok(listed.entries.some((entry) => entry.relativePath === 'src/a.js'));

  const globbed = await commandProvider.callTool('globFiles', { path: root, pattern: '*.js' }, ctx);
  assert.deepEqual(globbed.files.map((item) => path.basename(item.path)), ['a.js']);

  const grepped = await commandProvider.callTool('grepFiles', { path: root, pattern: 'ZERO', literal: true }, ctx);
  assert.equal(grepped.matches[0].line, 1);
});

test('command provider creates directories and deletes files only inside allowed roots', async () => {
  const root = tmpRoot();
  const nested = path.join(root, 'tmp', 'nested');
  const ctx = { commandRoots: [root] };

  const created = await commandProvider.callTool('createDirectory', { path: nested }, ctx);
  assert.equal(created.ok, true);
  assert.equal(fs.statSync(nested).isDirectory(), true);

  const file = path.join(nested, 'delete-me.txt');
  fs.writeFileSync(file, 'temporary');
  const deleted = await commandProvider.callTool('deleteFile', { path: file }, ctx);
  assert.equal(deleted.ok, true);
  assert.equal(fs.existsSync(file), false);

  await assert.rejects(
    () => commandProvider.callTool('deleteFile', { path: nested }, ctx),
    /deleteFile supports files only/
  );
});
