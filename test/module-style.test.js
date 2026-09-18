const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('src modules use direct CommonJS exports like zero.js', () => {
  const src = path.resolve(__dirname, '../src');
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
  const files = walk(src);
  const violations = [];

  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const rel = path.relative(src, file);
    if (/module\.exports\s*=/.test(text)) violations.push(`${rel}: module.exports`);
    if (/Object\.assign\s*\(\s*exports\s*,/.test(text)) {
      violations.push(`${rel}: Object.assign(exports, ...)`);
    }
  }

  assert.ok(files.length >= 20, 'ต้องเจอไฟล์ src ครบทุกโฟลเดอร์ (walk recursive)');
  assert.deepEqual(violations, []);
});
