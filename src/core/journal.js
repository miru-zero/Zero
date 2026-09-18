// journal: บันทึกทุกคำสั่งที่ zero รันจริง (argv + exitCode + stdout) เป็นหลักฐานให้ zero report อ้างอิง
// หลักการ: zero เป็น integrity layer — FACT ใน report ต้องชี้กลับมาที่ record ใน journal เสมอ ปลอมไม่ได้
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const STDOUT_CAP = 64 * 1024;
const HALF_CAP = STDOUT_CAP / 2;

const pad = (n) => String(n).padStart(2, '0');

const defaultFile = () => path.resolve(__dirname, '../../.zero/journal.jsonl');

const resolveFile = (env = {}) => {
  if (env.ZERO_JOURNAL_FILE) return path.resolve(env.ZERO_JOURNAL_FILE);
  return defaultFile();
};

const newId = (date = new Date()) => {
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `${stamp}-${crypto.randomBytes(2).toString('hex')}`;
};

const buildRecord = ({ argv = [], exitCode = 0, durationMs = 0, stdout = '', error = null, ts = new Date() }) => {
  const when = ts instanceof Date ? ts : new Date(ts);
  const record = {
    id: newId(when),
    ts: when.toISOString(),
    argv: [...argv],
    exitCode,
    durationMs
  };
  if (error) record.error = String(error);
  const text = String(stdout || '');
  if (text.length > STDOUT_CAP) {
    record.truncated = true;
    record.sha256 = crypto.createHash('sha256').update(text).digest('hex');
    record.stdout = `${text.slice(0, HALF_CAP)}\n…[truncated ${text.length - STDOUT_CAP} chars, sha256=${record.sha256}]…\n${text.slice(-HALF_CAP)}`;
  } else {
    record.stdout = text;
  }
  return record;
};

const createWriter = ({ file }) => {
  if (!file) throw new Error('journal file is required');
  return {
    file,
    write: (entry) => {
      const record = buildRecord(entry);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.appendFileSync(file, `${JSON.stringify(record)}\n`);
      return record;
    }
  };
};

const readAll = ({ file }) => {
  if (!file || !fs.existsSync(file)) return [];
  const entries = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try { entries.push(JSON.parse(trimmed)); } catch { /* ข้ามบรรทัดเสีย */ }
  }
  return entries;
};

const list = ({ file, limit = 20 }) => readAll({ file }).slice(-limit);

const ids = ({ file }) => new Set(readAll({ file }).map((entry) => entry.id));

exports.defaultFile = defaultFile;
exports.resolveFile = resolveFile;
exports.newId = newId;
exports.buildRecord = buildRecord;
exports.createWriter = createWriter;
exports.readAll = readAll;
exports.list = list;
exports.ids = ids;
