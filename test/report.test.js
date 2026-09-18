const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const journal = require('../src/core/journal');
const report = require('../src/core/report');
const cli = require('../src/cli');

const setup = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-report-'));
  return { dir, journalFile: path.join(dir, 'journal.jsonl'), reportsDir: path.join(dir, 'reports'), cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
};

const writeEntry = (ctx, over = {}) => {
  const writer = journal.createWriter({ file: ctx.journalFile });
  return writer.write({ argv: ['chatgpt', 'conversation', 'get', 'c1'], exitCode: 0, durationMs: 12, stdout: 'status=OK\n', ...over });
};

const validReportText = (jid) => `# ZERO REPORT chatgpt

title: t
created: 2026-09-16T00:00:00.000Z

## SOURCE
- conversation_id: c1
- test: spawn

## FACT
- conversation get คืน current_node จริง [J:${jid}]

## ISSUE
- ชื่อ parent_conversation_id กำกวม

## ACTUAL
actual

## EXPECTED / INTENT
- สื่อทั้ง routing และ lineage

## EVIDENCE
- [J:${jid}] command: conversation get c1 → exit=0

## IMPACT
- เลือก UUID ผิดชนิดได้

## SUGGESTION
- แยก vocabulary routing กับ lineage

## CONFIDENCE
- FACT: verified
- SUGGESTION: AI analysis

## NEXT TEST
- เทสใหม่หลังแก้ contract
`;

// --- journal ---

test('journal: write แล้วอ่านกลับได้ id ไม่ซ้ำ', (ctx) => {
  const t = setup();
  const a = writeEntry(t);
  const b = writeEntry(t);
  assert.notEqual(a.id, b.id);
  const entries = journal.readAll({ file: t.journalFile });
  assert.equal(entries.length, 2);
  assert.equal(entries[0].exitCode, 0);
  assert.match(a.id, /^[0-9]{8}-[0-9]{6}-[0-9a-f]{4}$/);
  t.cleanup();
});

test('journal: stdout เกิน 64KB ถูก cap พร้อม truncated + sha256 ของเต็ม', () => {
  const big = 'x'.repeat(200 * 1024);
  const record = journal.buildRecord({ argv: ['a'], exitCode: 0, durationMs: 1, stdout: big });
  assert.equal(record.truncated, true);
  assert.equal(record.sha256, crypto.createHash('sha256').update(big).digest('hex'));
  assert.ok(record.stdout.length < 70 * 1024);
  assert.ok(record.stdout.startsWith('x'.repeat(100)));
  assert.ok(record.stdout.endsWith('x'.repeat(100)));
});

test('journal: ไฟล์ไม่มี → readAll คืน [] ไม่พัง', () => {
  assert.deepEqual(journal.readAll({ file: 'M:/no/such/file.jsonl' }), []);
});

// --- report validate ---

test('report: skeleton จาก newReport มี section ครบ', (ctx) => {
  const t = setup();
  const file = report.newReport({ provider: 'chatgpt', title: 'agent spawn naming', reportsDir: t.reportsDir });
  assert.ok(fs.existsSync(file));
  const sections = report.parseSections(fs.readFileSync(file, 'utf8')).map((s) => s.name);
  assert.deepEqual(sections, report.SECTIONS);
  t.cleanup();
});

test('report validate: รายงานดีผ่าน (FACT อ้าง [J:id] จริง, SUGGESTION สะอาด)', () => {
  const t = setup();
  const entry = writeEntry(t);
  const file = path.join(t.dir, 'r.md');
  fs.writeFileSync(file, validReportText(entry.id));
  const result = report.validate({ file, journalFile: t.journalFile });
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
  t.cleanup();
});

test('report validate: FACT ไม่อ้าง [J:] = fail', () => {
  const t = setup();
  const entry = writeEntry(t);
  const file = path.join(t.dir, 'r.md');
  fs.writeFileSync(file, validReportText(entry.id).replace(` [J:${entry.id}]\n\n## ISSUE`, '\n\n## ISSUE'));
  const result = report.validate({ file, journalFile: t.journalFile });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('FACT bullet ต้องอ้าง')));
  t.cleanup();
});

test('report validate: citation ที่ไม่มีใน journal = fail (กัน FACT ปลอม)', () => {
  const t = setup();
  writeEntry(t);
  const file = path.join(t.dir, 'r.md');
  fs.writeFileSync(file, validReportText('20990101-000000-dead'));
  const result = report.validate({ file, journalFile: t.journalFile });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('ไม่มีใน journal')));
  t.cleanup();
});

test('report validate: SUGGESTION มี [J:] = fail (เลเยอร์รั่ว)', () => {
  const t = setup();
  const entry = writeEntry(t);
  const file = path.join(t.dir, 'r.md');
  fs.writeFileSync(file, validReportText(entry.id).replace('- แยก vocabulary routing กับ lineage', `- แยก vocabulary [J:${entry.id}]`));
  const result = report.validate({ file, journalFile: t.journalFile });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('SUGGESTION ห้ามมี')));
  t.cleanup();
});

test('report validate: ขาด section = fail + บอกชื่อ', () => {
  const t = setup();
  const entry = writeEntry(t);
  const file = path.join(t.dir, 'r.md');
  fs.writeFileSync(file, validReportText(entry.id).replace('## IMPACT\n- เลือก UUID ผิดชนิดได้\n\n', ''));
  const result = report.validate({ file, journalFile: t.journalFile });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('missing section: IMPACT')));
  t.cleanup();
});

// --- cli wiring ---

const cliEnv = (t) => ({ ZERO_JOURNAL: 'off', ZERO_JOURNAL_FILE: t.journalFile, ZERO_REPORT_DIR: t.reportsDir });

test('cli: zero report ไม่ใส่อะไร = usage exit 64', async () => {
  const t = setup();
  const output = { text: '', write(v) { this.text += v; } };
  const result = await cli.run(['report'], cliEnv(t), output, {});
  assert.equal(result.exitCode, 64);
  assert.match(output.text, /zero report new <provider>/);
  t.cleanup();
});

test('cli: zero report <provider> <title> สร้างไฟล์ skeleton จริง', async () => {
  const t = setup();
  const output = { text: '', write(v) { this.text += v; } };
  const result = await cli.run(['report', 'chatgpt', 'agent', 'spawn', 'naming'], cliEnv(t), output, {});
  assert.equal(result.exitCode, 0);
  const file = result.file;
  assert.ok(file.includes(path.join('reports', 'chatgpt')));
  assert.match(fs.readFileSync(file, 'utf8'), /# ZERO REPORT chatgpt/);
  t.cleanup();
});

test('cli: zero report log แสดง entry จาก journal พร้อม [J:id]', async () => {
  const t = setup();
  const entry = writeEntry(t, { argv: ['auth', 'status'] });
  const output = { text: '', write(v) { this.text += v; } };
  const result = await cli.run(['report', 'log', '5'], cliEnv(t), output, {});
  assert.equal(result.exitCode, 0);
  assert.match(output.text, new RegExp(`\\[J:${entry.id}\\] exit=0`));
  assert.match(output.text, /auth status/);
  t.cleanup();
});

test('cli: zero report check ผ่าน/ไม่ผ่าน ออก exit code ถูก', async () => {
  const t = setup();
  const entry = writeEntry(t);
  const good = path.join(t.dir, 'good.md');
  fs.writeFileSync(good, validReportText(entry.id));
  const bad = path.join(t.dir, 'bad.md');
  fs.writeFileSync(bad, validReportText('20990101-000000-dead'));
  const output = { text: '', write(v) { this.text += v; } };
  const okResult = await cli.run(['report', 'check', good], cliEnv(t), output, {});
  assert.equal(okResult.exitCode, 0);
  const failResult = await cli.run(['report', 'check', bad], cliEnv(t), output, {});
  assert.equal(failResult.exitCode, 1);
  t.cleanup();
});

test('cli: journal hook — รันจริงผ่าน dependencies.journal แล้วมี record (argv+exitCode+stdout)', async () => {
  const t = setup();
  const written = [];
  const fakeWriter = { write: (entry) => { written.push(journal.buildRecord(entry)); } };
  const output = { text: '', write(v) { this.text += v; } };
  const result = await cli.run(['report', 'log'], { ZERO_JOURNAL: 'off', ZERO_JOURNAL_FILE: t.journalFile }, output, { journal: fakeWriter });
  assert.equal(result.exitCode, 0);
  assert.equal(written.length, 1);
  assert.deepEqual(written[0].argv, ['report', 'log']);
  assert.equal(written[0].exitCode, 0);
  assert.match(written[0].stdout, /journal=/);
  t.cleanup();
});

test('cli: ไม่มี journal writer = ไม่เขียน journal (กันพลุตอน test)', async () => {
  const t = setup();
  const output = { text: '', write(v) { this.text += v; } };
  await cli.run(['report', 'log'], { ZERO_JOURNAL: 'off', ZERO_JOURNAL_FILE: t.journalFile }, output, {});
  assert.equal(fs.existsSync(t.journalFile), false);
  t.cleanup();
});
