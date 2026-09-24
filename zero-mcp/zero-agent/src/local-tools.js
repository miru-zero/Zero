'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const textDecoder = new TextDecoder('utf-8', { fatal: false });
const err = (code, message) => Object.assign(new Error(message), { code });
const normalize = (value) => path.resolve(String(value)).toLowerCase();

const rootsFor = (env = process.env) => {
  const configured = String(env.ZERO_AGENT_ROOTS || '')
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean);
  const roots = configured.length ? configured : [os.homedir(), process.cwd()];
  return roots.map((item) => path.resolve(item));
};

const resolveAllowed = (inputPath, env = process.env) => {
  if (!inputPath || typeof inputPath !== 'string') throw err('INVALID_PATH', 'path is required');
  const roots = rootsFor(env);
  const target = path.resolve(inputPath);
  const targetNorm = normalize(target);
  const ok = roots.some((root) => {
    const rootNorm = normalize(root);
    return targetNorm === rootNorm || targetNorm.startsWith(rootNorm + path.sep.toLowerCase());
  });
  if (!ok) throw err('PATH_NOT_ALLOWED', 'path is outside agent allowed roots');
  return target;
};

const readUtf8 = (file) => {
  const data = fs.readFileSync(file);
  if (data.includes(0)) throw err('BINARY_FILE', 'binary file is not supported');
  return textDecoder.decode(data);
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

const wildcard = (pattern) => new RegExp('^' + String(pattern)
  .replace(/[.+^${}()|[\]\\]/g, '\\$&')
  .replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');

const numbered = (lines, startIndex) => lines
  .map((line, index) => String(startIndex + index + 1).padStart(4, ' ') + '\t' + line)
  .join('\n');

const listDirectory = (args, env) => {
  const root = resolveAllowed(args.path, env);
  const depth = Math.max(1, Math.min(args.depth || 2, 5));
  return { ok: true, path: root, depth, entries: walk(root, { depth }) };
};

const getFileInfo = (args, env) => {
  const target = resolveAllowed(args.path, env);
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

const readFile = (args, env) => {
  const file = resolveAllowed(args.path, env);
  const lines = readUtf8(file).split(/\r?\n/);
  const offset = Number.isInteger(args.offset) ? args.offset : 0;
  const length = Number.isInteger(args.length) ? args.length : 200;
  const start = offset < 0 ? Math.max(lines.length + offset, 0) : Math.max(offset, 0);
  const slice = lines.slice(start, start + length);
  return { ok: true, path: file, totalLines: lines.length, offset: start, length: slice.length, content: numbered(slice, start) };
};

const readFiles = (args = {}, env) => {
  const requests = Array.isArray(args.files) && args.files.length
    ? args.files.map((item) => ({ path: item.path, offset: item.offset, length: item.length }))
    : (Array.isArray(args.paths) ? args.paths : []).map((inputPath) => ({ path: inputPath, offset: args.offset, length: args.length }));
  if (!requests.length) throw err('INVALID_PATHS', 'paths or files must contain at least one file');
  if (requests.length > 50) throw err('TOO_MANY_PATHS', 'readFiles supports up to 50 files');
  const files = requests.map((request) => {
    try { return readFile(request, env); }
    catch (error) { return { ok: false, path: String(request.path), error: { code: error.code || 'READ_FAILED', message: error.message || String(error) } }; }
  });
  const succeeded = files.filter((item) => item.ok).length;
  return { ok: succeeded === files.length, count: files.length, succeeded, failed: files.length - succeeded, files };
};

const globFiles = (args, env) => {
  const root = resolveAllowed(args.path, env);
  const rx = wildcard(args.pattern || '*');
  const max = Math.max(1, Math.min(args.maxResults || 200, 1000));
  const files = walk(root, { filesOnly: true })
    .filter((item) => rx.test(path.basename(item.path)) || rx.test(item.relativePath))
    .slice(0, max);
  return { ok: true, path: root, pattern: args.pattern, files };
};

const grepFiles = (args, env) => {
  const root = resolveAllowed(args.path, env);
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

const handlers = { listDirectory, getFileInfo, readFile, readFiles, globFiles, grepFiles };

const schemaObject = (properties, required = []) => ({ type: 'object', properties, required });
const toolSchemas = [
  { name: 'listDirectory', description: 'List files and folders inside ZERO_AGENT_ROOTS.', inputSchema: schemaObject({ path: { type: 'string' }, depth: { type: 'number' } }, ['path']) },
  { name: 'getFileInfo', description: 'Get metadata for a file or directory inside ZERO_AGENT_ROOTS.', inputSchema: schemaObject({ path: { type: 'string' } }, ['path']) },
  { name: 'readFile', description: 'Read a UTF-8 text file inside ZERO_AGENT_ROOTS with line pagination.', inputSchema: schemaObject({ path: { type: 'string' }, offset: { type: 'number' }, length: { type: 'number' } }, ['path']) },
  { name: 'readFiles', description: 'Read multiple UTF-8 text files inside ZERO_AGENT_ROOTS. Accept paths[] or files[].', inputSchema: schemaObject({ paths: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 50 }, files: { type: 'array', minItems: 1, maxItems: 50, items: schemaObject({ path: { type: 'string' }, offset: { type: 'number' }, length: { type: 'number' } }, ['path']) }, offset: { type: 'number' }, length: { type: 'number' } }) },
  { name: 'globFiles', description: 'Find files by wildcard pattern inside ZERO_AGENT_ROOTS.', inputSchema: schemaObject({ path: { type: 'string' }, pattern: { type: 'string' }, maxResults: { type: 'number' } }, ['path']) },
  { name: 'grepFiles', description: 'Search text files inside ZERO_AGENT_ROOTS.', inputSchema: schemaObject({ path: { type: 'string' }, pattern: { type: 'string' }, literal: { type: 'boolean' }, filePattern: { type: 'string' }, maxResults: { type: 'number' } }, ['path', 'pattern']) }
];

const execute = (tool, args = {}, env = process.env) => {
  const cleanTool = String(tool || '').replace(/^command\./, '');
  const handler = handlers[cleanTool];
  if (!handler) throw err('UNKNOWN_AGENT_TOOL', 'unknown or unsafe agent tool: ' + tool);
  return handler(args, env);
};
const listTools = () => toolSchemas.map((tool) => ({ ...tool }));

const localTools = { execute, listTools, _private: { rootsFor, resolveAllowed, wildcard } };
Object.assign(exports, localTools);
