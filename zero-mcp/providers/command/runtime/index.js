'use strict';

const fs = require('node:fs');
const path = require('node:path');

const mcpRoot = path.resolve(__dirname, '..', '..', '..');
const textDecoder = new TextDecoder('utf-8', { fatal: false });

const schema = (properties, required = []) => ({
  type: 'object',
  properties,
  ...(required.length ? { required } : {}),
  additionalProperties: false
});

const TOOLS = [
  ['readFile', 'Read a text file with line numbers.'],
  ['readFiles', 'Read multiple text files with line numbers.'],
  ['writeFile', 'Write or append text content to a file.'],
  ['replaceFile', 'Replace exact text inside a file.'],
  ['createDirectory', 'Create a directory under an allowed root.'],
  ['deleteFile', 'Delete one file under an allowed root.'],
  ['listDirectory', 'List files and directories under a path.'],
  ['getFileInfo', 'Get file or directory metadata.'],
  ['globFiles', 'Find files by wildcard pattern.'],
  ['grepFiles', 'Search text content in files.']
];
const toolSchemas = {
  readFile: schema({
    path: { type: 'string' },
    offset: { type: 'integer', default: 0 },
    length: { type: 'integer', minimum: 1, maximum: 1000, default: 200 }
  }, ['path']),
  readFiles: schema({
    paths: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 50 },
    files: {
      type: 'array', minItems: 1, maxItems: 50,
      items: schema({
        path: { type: 'string' },
        offset: { type: 'integer' },
        length: { type: 'integer', minimum: 1, maximum: 1000 }
      }, ['path'])
    },
    offset: { type: 'integer', default: 0 },
    length: { type: 'integer', minimum: 1, maximum: 1000, default: 200 }
  }),
  writeFile: schema({
    path: { type: 'string' },
    content: { type: 'string' },
    mode: { type: 'string', enum: ['overwrite', 'append'], default: 'overwrite' }
  }, ['path', 'content']),
  replaceFile: schema({
    path: { type: 'string' },
    oldString: { type: 'string' },
    newString: { type: 'string' },
    expectedReplacements: { type: 'integer', minimum: 0 }
  }, ['path', 'oldString', 'newString']),
  createDirectory: schema({
    path: { type: 'string' }
  }, ['path']),
  deleteFile: schema({
    path: { type: 'string' }
  }, ['path']),
  listDirectory: schema({
    path: { type: 'string' },
    depth: { type: 'integer', minimum: 1, maximum: 5, default: 2 }
  }, ['path'])
};
toolSchemas.getFileInfo = schema({ path: { type: 'string' } }, ['path']);
toolSchemas.globFiles = schema({
  path: { type: 'string' },
  pattern: { type: 'string' },
  maxResults: { type: 'integer', minimum: 1, maximum: 1000, default: 200 }
}, ['path', 'pattern']);
toolSchemas.grepFiles = schema({
  path: { type: 'string' },
  pattern: { type: 'string' },
  literal: { type: 'boolean', default: false },
  filePattern: { type: 'string' },
  maxResults: { type: 'integer', minimum: 1, maximum: 1000, default: 200 }
}, ['path', 'pattern']);

const err = (code, message) => Object.assign(new Error(message), { code });
const normalize = (value) => path.resolve(String(value)).toLowerCase();

const rootsFor = (context = {}, env = process.env) => {
  const roots = context.commandRoots || (env.ZERO_COMMAND_ROOTS || '').split(';').filter(Boolean);
  return (roots.length ? roots : [mcpRoot]).map((item) => path.resolve(String(item)));
};
const resolveAllowed = (inputPath, context) => {
  if (!inputPath || typeof inputPath !== 'string') throw err('INVALID_PATH', 'path is required');
  const roots = rootsFor(context);
  const target = path.isAbsolute(inputPath)
    ? path.resolve(inputPath)
    : path.resolve(roots[0], inputPath);
  const targetNorm = normalize(target);
  const ok = roots.some((root) => {
    const rootNorm = normalize(root);
    return targetNorm === rootNorm || targetNorm.startsWith(rootNorm + path.sep.toLowerCase());
  });
  if (!ok) throw err('PATH_NOT_ALLOWED', 'path is outside allowed roots');
  return target;
};

const readUtf8 = (file) => {
  const data = fs.readFileSync(file);
  if (data.includes(0)) throw err('BINARY_FILE', 'binary file is not supported');
  return textDecoder.decode(data);
};

const numbered = (lines, startIndex) => lines
  .map((line, index) => String(startIndex + index + 1).padStart(4, ' ') + '\t' + line)
  .join('\n');
const readFile = (args, context) => {
  const file = resolveAllowed(args.path, context);
  const text = readUtf8(file);
  const lines = text.split(/\r?\n/);
  const offset = Number.isInteger(args.offset) ? args.offset : 0;
  const length = Number.isInteger(args.length) ? args.length : 200;
  const start = offset < 0 ? Math.max(lines.length + offset, 0) : Math.max(offset, 0);
  const slice = lines.slice(start, start + length);
  return {
    ok: true,
    path: file,
    totalLines: lines.length,
    offset: start,
    length: slice.length,
    content: numbered(slice, start)
  };
};

const readFiles = (args = {}, context) => {
  const requests = Array.isArray(args.files) && args.files.length
    ? args.files.map((item) => ({ path: item.path, offset: item.offset, length: item.length }))
    : (Array.isArray(args.paths) ? args.paths : []).map((inputPath) => ({ path: inputPath, offset: args.offset, length: args.length }));
  if (!requests.length) throw err('INVALID_PATHS', 'paths or files must contain at least one file');
  if (requests.length > 50) throw err('TOO_MANY_PATHS', 'readFiles supports up to 50 files');
  const files = requests.map((request) => {
    try { return readFile(request, context); }
    catch (error) {
      return {
        ok: false,
        path: String(request.path),
        error: { code: error.code || 'READ_FAILED', message: error.message || String(error) }
      };
    }
  });
  const succeeded = files.filter((item) => item.ok).length;
  return { ok: succeeded === files.length, count: files.length, succeeded, failed: files.length - succeeded, files };
};

const writeFile = (args, context) => {
  const file = resolveAllowed(args.path, context);
  const mode = args.mode === 'append' ? 'append' : 'overwrite';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const data = String(args.content ?? '');
  if (mode === 'append') fs.appendFileSync(file, data, 'utf8');
  else fs.writeFileSync(file, data, 'utf8');
  return { ok: true, path: file, mode, bytes: Buffer.byteLength(data) };
};

const replaceFile = (args, context) => {
  const file = resolveAllowed(args.path, context);
  const oldString = String(args.oldString ?? '');
  if (!oldString) throw err('INVALID_REPLACE', 'oldString must not be empty');
  const newString = String(args.newString ?? '');
  const text = readUtf8(file);
  const replacements = text.split(oldString).length - 1;
  if (Number.isInteger(args.expectedReplacements) && replacements !== args.expectedReplacements) {
    throw err('REPLACE_COUNT_MISMATCH', `expected ${args.expectedReplacements} replacements, got ${replacements}`);
  }
  fs.writeFileSync(file, text.split(oldString).join(newString), 'utf8');
  return { ok: true, path: file, replacements };
};

const createDirectory = (args, context) => {
  const dir = resolveAllowed(args.path, context);
  fs.mkdirSync(dir, { recursive: true });
  return { ok: true, path: dir, created: fs.existsSync(dir) && fs.statSync(dir).isDirectory() };
};

const deleteFile = (args, context) => {
  const file = resolveAllowed(args.path, context);
  if (!fs.existsSync(file)) throw err('FILE_NOT_FOUND', 'file does not exist');
  const stat = fs.statSync(file);
  if (!stat.isFile()) throw err('NOT_A_FILE', 'deleteFile supports files only');
  fs.unlinkSync(file);
  return { ok: true, path: file, deleted: true };
};
const entry = (fullPath, root) => {
  const stat = fs.statSync(fullPath);
  return {
    path: fullPath,
    relativePath: path.relative(root, fullPath).replace(/\\/g, '/'),
    type: stat.isDirectory() ? 'directory' : 'file',
    size: stat.size
  };
};

const walk = (root, options = {}) => {
  const depth = options.depth ?? Infinity;
  const filesOnly = options.filesOnly === true;
  const out = [];
  const visit = (dir, level) => {
    if (level > depth) return;
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const item = entry(full, root);
      if (!filesOnly || item.type === 'file') out.push(item);
      if (item.type === 'directory') visit(full, level + 1);
    }
  };
  visit(root, 1);
  return out;
};
const listDirectory = (args, context) => {
  const root = resolveAllowed(args.path, context);
  const depth = Math.max(1, Math.min(args.depth || 2, 5));
  return { ok: true, path: root, depth, entries: walk(root, { depth }) };
};

const getFileInfo = (args, context) => {
  const target = resolveAllowed(args.path, context);
  const stat = fs.statSync(target);
  return {
    ok: true,
    path: target,
    type: stat.isDirectory() ? 'directory' : 'file',
    size: stat.size,
    createdAt: stat.birthtime.toISOString(),
    modifiedAt: stat.mtime.toISOString(),
    lineCount: stat.isFile() ? readUtf8(target).split(/\r?\n/).length : null
  };
};

const wildcard = (pattern) => new RegExp('^' + String(pattern)
  .replace(/[.+^${}()|[\]\\]/g, '\\$&')
  .replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
const globFiles = (args, context) => {
  const root = resolveAllowed(args.path, context);
  const rx = wildcard(args.pattern || '*');
  const max = Math.max(1, Math.min(args.maxResults || 200, 1000));
  const files = walk(root, { filesOnly: true })
    .filter((item) => rx.test(path.basename(item.path)) || rx.test(item.relativePath))
    .slice(0, max);
  return { ok: true, path: root, pattern: args.pattern, files };
};

const grepFiles = (args, context) => {
  const root = resolveAllowed(args.path, context);
  const max = Math.max(1, Math.min(args.maxResults || 200, 1000));
  const rx = args.literal ? null : new RegExp(String(args.pattern), 'i');
  const fileRx = args.filePattern ? wildcard(args.filePattern) : null;
  const matches = [];
  for (const file of walk(root, { filesOnly: true })) {
    if (fileRx && !fileRx.test(path.basename(file.path)) && !fileRx.test(file.relativePath)) continue;
    let text;
    try { text = readUtf8(file.path); } catch { continue; }
    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const hit = args.literal ? line.includes(String(args.pattern)) : rx.test(line);
      if (!hit) continue;
      matches.push({ path: file.path, relativePath: file.relativePath, line: index + 1, text: line });
      if (matches.length >= max) return { ok: true, path: root, pattern: args.pattern, matches };
    }
  }
  return { ok: true, path: root, pattern: args.pattern, matches };
};

const handlers = {
  readFile,
  readFiles,
  writeFile,
  replaceFile,
  createDirectory,
  deleteFile,
  listDirectory,
  getFileInfo,
  globFiles,
  grepFiles
};
exports.listTools = () => TOOLS.map(([name, description]) => ({
  name,
  description: `${description} Canonical: zero.command.${name}`,
  inputSchema: toolSchemas[name]
}));

exports.callTool = async (name, args = {}, context = {}) => {
  const handler = handlers[name];
  if (!handler) throw err('UNKNOWN_TOOL', 'unknown command tool: ' + name);
  return handler(args, context);
};

exports._private = { resolveAllowed, rootsFor, wildcard };
