// report: engineering feedback report จาก AI tester
// zero เป็น integrity layer: FACT ต้องอ้าง [J:<journal-id>] ที่มีจริงใน journal เท่านั้น
// SUGGESTION ห้ามมี [J:] — ส่วนนี้คือการวิเคราะห์ของ AI ต้องแยกจากหลักฐานเด็ดขาด
const fs = require('node:fs');
const path = require('node:path');
const journal = require('./journal');

const SECTIONS = ['SOURCE', 'FACT', 'ISSUE', 'ACTUAL', 'EXPECTED', 'EVIDENCE', 'IMPACT', 'SUGGESTION', 'CONFIDENCE', 'NEXT TEST'];
const CITATION = /\[J:([0-9]{8}-[0-9]{6}-[0-9a-f]{4})\]/g;

const normalizeSection = (raw) => {
  const name = String(raw || '').trim().toUpperCase();
  if (name.startsWith('EXPECTED')) return 'EXPECTED';
  if (name.startsWith('NEXT TEST')) return 'NEXT TEST';
  return name;
};

const defaultDir = () => path.resolve(__dirname, '../../reports');

const slugify = (text) => String(text || '')
  .toLowerCase()
  .replace(/[^a-z0-9ก-๙]+/gi, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 40) || 'report';

const template = ({ provider, title, created }) => `# ZERO REPORT ${provider}

title: ${title}
created: ${created}

## SOURCE
- conversation_id: 
- test: 

## FACT
- (ข้อเท็จจริงที่ verify แล้วจากการรันจริงเท่านั้น — ทุก bullet ต้องอ้าง [J:<id>] จาก \`zero report log\`)

## ISSUE
- (ปัญหาที่พบ — วิเคราะห์จาก FACT)

## ACTUAL
\`\`\`
(พฤติกรรมจริงที่เกิด — command + result)
\`\`\`

## EXPECTED / INTENT
- (พฤติกรรมที่ตั้งใจ/ควรจะเป็น)

## EVIDENCE
- [J:<id>] command: ... → result: ...

## IMPACT
- (ผลกระทบถ้าไม่แก้)

## SUGGESTION
- (ข้อเสนอจากการวิเคราะห์ของ AI — ห้ามมี [J:] ในส่วนนี้เด็ดขาด)

## CONFIDENCE
- FACT: verified
- SUGGESTION: AI analysis

## NEXT TEST
- (สิ่งที่ต้องเทสต่อ)
`;

const newReport = ({ provider, title, reportsDir = defaultDir(), now = new Date() }) => {
  if (!provider) throw new Error('provider is required');
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
  const file = path.join(reportsDir, provider, `${stamp}-${slugify(title)}.md`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, template({ provider, title: title || '(untitled)', created: now.toISOString() }));
  return file;
};

const parseSections = (text) => {
  const sections = [];
  let current = null;
  String(text || '').split('\n').forEach((line, index) => {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      current = { name: normalizeSection(heading[1]), line: index + 1, body: [] };
      sections.push(current);
    } else if (current) {
      current.body.push({ line: index + 1, text: line });
    }
  });
  return sections;
};

const validate = ({ file, journalFile = journal.defaultFile() }) => {
  const errors = [];
  if (!fs.existsSync(file)) return { ok: false, errors: [`report not found: ${file}`] };
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n');

  if (!lines.some((line) => /^# ZERO REPORT \S+/.test(line))) {
    errors.push('missing header "# ZERO REPORT <provider>"');
  }

  const sections = parseSections(text);
  const names = sections.map((section) => section.name);
  for (const required of SECTIONS) {
    if (!names.includes(required)) errors.push(`missing section: ${required}`);
  }
  const presentOrder = names.filter((name) => SECTIONS.includes(name));
  const expectedOrder = SECTIONS.filter((name) => presentOrder.includes(name));
  if (presentOrder.join('|') !== expectedOrder.join('|')) {
    errors.push(`section order wrong: got ${presentOrder.join(' → ')} (ต้องเป็น ${expectedOrder.join(' → ')})`);
  }

  const journalIds = journal.ids({ file: journalFile });
  lines.forEach((line, index) => {
    for (const match of line.matchAll(CITATION)) {
      if (!journalIds.has(match[1])) {
        errors.push(`line ${index + 1}: citation [J:${match[1]}] ไม่มีใน journal (${journalFile}) — FACT ต้องมาจากการรันจริงเท่านั้น`);
      }
    }
  });

  const fact = sections.find((section) => section.name === 'FACT');
  if (fact) {
    for (const item of fact.body) {
      if (!/^\s*-\s+/.test(item.text)) continue;
      if (/^\s*-\s*\(/.test(item.text)) continue; // placeholder ใน skeleton
      CITATION.lastIndex = 0;
      if (!CITATION.test(item.text)) {
        errors.push(`line ${item.line}: FACT bullet ต้องอ้าง [J:<id>] — ถ้าไม่มีหลักฐานจากการรันจริง ให้ย้ายไป SUGGESTION`);
      }
    }
  }

  const suggestion = sections.find((section) => section.name === 'SUGGESTION');
  if (suggestion) {
    for (const item of suggestion.body) {
      CITATION.lastIndex = 0;
      if (CITATION.test(item.text)) {
        errors.push(`line ${item.line}: SUGGESTION ห้ามมี [J:] — ส่วนนี้คือการวิเคราะห์ของ AI ต้องแยกจากหลักฐาน`);
      }
    }
  }

  const confidence = sections.find((section) => section.name === 'CONFIDENCE');
  if (confidence && !confidence.body.some((item) => item.text.trim() && !item.text.trim().startsWith('('))) {
    errors.push('CONFIDENCE section ว่าง — ต้องประกาศระดับความมั่นใจของแต่ละส่วน');
  }

  return { ok: errors.length === 0, errors };
};

exports.SECTIONS = SECTIONS;
exports.CITATION = CITATION;
exports.defaultDir = defaultDir;
exports.slugify = slugify;
exports.template = template;
exports.newReport = newReport;
exports.parseSections = parseSections;
exports.validate = validate;
