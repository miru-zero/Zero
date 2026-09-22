#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const authLoader = require('./core/auth-loader');
const authStatus = require('./core/auth-status');
const authRefresh = require('./core/auth-refresh');
const sessionContext = require('./core/session-context');
const journalCore = require('./core/journal');
const reportCore = require('./core/report');
const toolsHub = require('./hub');
const interactiveMenu = require('./interactive-menu');

const resolveAuthFile = (env) => env.ZERO_CHATGPT_AUTH_FILE
  ? path.resolve(env.ZERO_CHATGPT_AUTH_FILE)
  : path.resolve(__dirname, '../runtime/auth-context.json');

const resolveSessionFile = (env) => env.ZERO_CHATGPT_SESSION_FILE
  ? path.resolve(env.ZERO_CHATGPT_SESSION_FILE)
  : path.resolve(__dirname, '../runtime/session-context.json');

const resolveAgentTaskFile = (env) => env.ZERO_AGENT_TASK_FILE
  ? path.resolve(env.ZERO_AGENT_TASK_FILE)
  : path.resolve(__dirname, '../runtime/agent-tasks.json');

const resolveAgentProjectId = (env) => {
  if (env.ZERO_AGENT_PROJECT_ID) return env.ZERO_AGENT_PROJECT_ID;
  const settingsFile = path.resolve(__dirname, '../runtime/agent-settings.json');
  if (!fs.existsSync(settingsFile)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    return typeof parsed?.project_id === 'string' && parsed.project_id.trim() ? parsed.project_id.trim() : null;
  } catch {
    return null;
  }
};

const exitCodes = { VALID: 0, MISSING: 2, EXPIRED: 3, INVALID: 4 };

const inspectAuth = (env) => {
  const loaded = authLoader.loadAccessToken(env, resolveAuthFile(env));
  return { loaded, result: authStatus.inspectAccessToken(loaded.token) };
};

// token EXPIRED ไม่ใช่จบ — ลอง refresh จาก cookie ใน session-context ก่อน 1 ครั้ง (auth ชุดเดียวของ zero)
const inspectAuthWithRefresh = async (env, dependencies = {}) => {
  const first = inspectAuth(env);
  if (first.result.status !== 'EXPIRED') return { ...first, refreshed: false };
  const refreshFn = dependencies.refreshAccessToken || authRefresh.refreshAccessToken;
  const refresh = await refreshFn({ authFile: resolveAuthFile(env), sessionFile: resolveSessionFile(env) });
  if (refresh.status !== 'REFRESHED') return { ...first, refreshed: false, refresh };
  return { ...inspectAuth(env), refreshed: true, refresh };
};

const authStatusLine = ({ loaded, result }) => {
  const expiresAt = result.expiresAt ? new Date(result.expiresAt * 1000).toISOString() : '-';
  const remaining = Number.isFinite(result.remainingSeconds) ? `${result.remainingSeconds}s` : '-';
  return `accessToken=${result.status} source=${loaded.source} expiresAt=${expiresAt} remaining=${remaining}`;
};
const formatConversations = (result) => {
  const lines = ['Zero-ChatGPT Conversations', '', '[Outside Projects]'];
  let index = 1;

  for (const item of result.outside) {
    lines.push(`[${index++}] ${item.title || '(untitled)'}`);
    lines.push(`    ${item.id}`);
  }

  if (result.outside.length === 0) lines.push('  (none)');

  for (const project of result.projects) {
    lines.push('', `[Project] ${project.name}`);
    lines.push(`    Project ID: ${project.id}`);
    for (const item of project.conversations) {
      lines.push(`[${index++}] ${item.title || '(untitled)'}`);
      lines.push(`    ${item.id}`);
    }
    if (project.conversations.length === 0) lines.push('  (none)');
  }

  const returned = Number.isFinite(result.returned)
    ? result.returned
    : result.outside.length + result.projects.reduce((sum, project) => sum + project.conversations.length, 0);
  if (Number.isFinite(result.total) && returned < result.total) {
    lines.push('', `Showing: ${returned} of ${result.total} conversations`);
    if (Number.isFinite(result.nextOffset)) lines.push(`Next offset: ${result.nextOffset}`);
  } else {
    lines.push('', `Total: ${result.total} conversations`);
  }
  lines.push(`Projects: ${result.projects.length}`);
  return `${lines.join('\n')}\n`;
};

const formatProjectConversations = (projectId, page) => {
  const lines = [`Project ID: ${projectId}`, ''];
  const items = Array.isArray(page.items) ? page.items : [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    lines.push(`[${index + 1}] ${item.title || '(untitled)'}`);
    lines.push(`    ${item.id}`);
  }
  if (items.length === 0) lines.push('(none)');
  lines.push('', `Showing: ${items.length} conversations`);
  if (page.nextCursor) lines.push(`Next cursor: ${page.nextCursor}`);
  return `${lines.join('\n')}\n`;
};

const formatSearchResults = (result) => {
  const items = Array.isArray(result?.items) ? result.items : [];
  const lines = [`Search results: ${items.length}`];
  items.forEach((item, index) => {
    const title = item?.title || item?.name || item?.conversation_title || item?.item?.title || '(untitled)';
    const payload = item?.payload && typeof item.payload === 'object' ? item.payload : {};
    const conversationId = payload.conversation_id || item?.conversation_id || null;
    const messageId = payload.message_id || item?.message_id || null;
    const rawId = item?.id || item?.item?.id || null;
    const type = item?.type || item?.result_type || item?.source_type || 'result';
    lines.push(`[${index + 1}] ${title}`);
    if (conversationId) lines.push(`    conversation_id=${conversationId}`);
    if (messageId) lines.push(`    message_id=${messageId}`);
    if (!conversationId && rawId) lines.push(`    id=${rawId}`);
    lines.push(`    type=${type}`);
    const snippet = item?.snippet || item?.text || item?.description || null;
    if (snippet) lines.push(`    ${String(snippet).replace(/\s+/g, ' ').trim().slice(0, 220)}`);
  });
  if (result?.cursor) lines.push(`Next cursor: ${result.cursor}`);
  return `${lines.join('\n')}\n`;
};
const formatConnectors = (items) => {
  const lines = [`Connectors: ${items.length} installed`, ''];
  items.forEach((item, index) => {
    lines.push(`[${index + 1}] ${item.displayName || item.name || '(unnamed)'}`);
    lines.push(`    name=${item.name || '-'} status=${item.status || '-'} enabled=${item.enabled}`);
    if (item.shortDescription) lines.push(`    ${item.shortDescription}`);
    if (item.disabledSkillNames.length) lines.push(`    disabled_skills=${item.disabledSkillNames.join(',')}`);
  });
  return `${lines.join('\n')}\n`;
};

const resolveSystemHintSelections = async ({ message, token, sessionHeaders, listConnectors }) => {
  const text = String(message || '');
  if (!text.includes('@')) return { systemHints: [], systemHintMentions: [] };
  const connectors = await listConnectors({ token, sessionHeaders });
  const hints = new Set();
  const systemHintMentions = [];
  for (const item of connectors) {
    if (item?.enabled === false || !item?.displayName || !item?.id?.startsWith('plugin_')) continue;
    const mentionText = `@${item.displayName}`;
    const hint = `plugin:${item.id.slice('plugin_'.length)}`;
    let startIndex = text.indexOf(mentionText);
    while (startIndex >= 0) {
      hints.add(hint);
      systemHintMentions.push({ id: hint, startIndex, endIndex: startIndex + mentionText.length });
      startIndex = text.indexOf(mentionText, startIndex + mentionText.length);
    }
  }
  return { systemHints: [...hints], systemHintMentions };
};

const parentIdFor = (messages, message) => {
  if (message?.parent_id) return message.parent_id;
  const index = messages.findIndex((item) => item?.id === message?.id);
  return index > 0 ? messages[index - 1]?.id || null : null;
};

const findEditableUser = (messages, tip) => {
  const byId = new Map(messages.filter((message) => message?.id).map((message) => [message.id, message]));
  let current = tip;
  const seen = new Set();
  while (current?.id && !seen.has(current.id)) {
    seen.add(current.id);
    if (current?.author?.role === 'user') return current;
    current = byId.get(parentIdFor(messages, current));
  }
  return null;
};

const formatConversation = (conversation, includeState = true) => {
  const messages = Array.isArray(conversation.messages) ? conversation.messages : [];
  const lines = [
    `title=${conversation.title || '(untitled)'}`,
    `conversation_id=${conversation.conversation_id || conversation.id || '-'}`,
    `project_id=${conversation.gizmo_id || conversation.conversation_template_id || '-'}`,
    `current_node=${conversation.current_node || '-'}`,
    `messages=${messages.length}`
  ];
  const currentMessage = messages.find((message) => message?.id === conversation.current_node);
  if (includeState && currentMessage?.id) {
    const editableUser = findEditableUser(messages, currentMessage);
    lines.push(`message_id=${currentMessage.id}`);
    lines.push(`parent_id=${parentIdFor(messages, currentMessage) || '-'}`);
    lines.push(`next_parent_message_id=${currentMessage.id}`);
    if (editableUser?.id) {
      lines.push(`edit_message_id=${editableUser.id}`);
      lines.push(`edit_parent_id=${parentIdFor(messages, editableUser) || '-'}`);
    }
  }
  lines.push('');
  return lines.join('\n');
};

const messageText = (message) => {
  const content = message?.content;
  if (!content) return '(non-text)';
  if (typeof content.content === 'string') return content.content;
  if (typeof content.text === 'string') return content.text;
  if (Array.isArray(content.parts)) {
    const parts = content.parts.map((part) => typeof part === 'string' ? part : part?.text).filter(Boolean);
    if (parts.length) return parts.join('\n');
  }
  return '(non-text)';
};

const debugValue = (value) => value == null ? '-' : typeof value === 'object' ? JSON.stringify(value) : String(value);

const messageDebugLines = (message, messages) => {
  const metadata = message?.metadata || {};
  return [
    '[DEBUG]',
    `id=${message?.id || '-'}`,
    `parent_id=${parentIdFor(messages, message) || '-'}`,
    `status=${message?.status || '-'}`,
    `end_turn=${debugValue(message?.end_turn)}`,
    `content_type=${message?.content?.content_type || '-'}`,
    `author_name=${message?.author?.name || '-'}`,
    `recipient=${message?.recipient || '-'}`,
    `channel=${message?.channel || '-'}`,
    `request_id=${metadata.request_id || '-'}`,
    `turn_id=${metadata.turn_id || '-'}`,
    `turn_exchange_id=${metadata.turn_exchange_id || '-'}`,
    `working_turn_id=${metadata.working_turn_id || '-'}`,
    `model_slug=${metadata.model_slug || '-'}`,
    `finish_details=${debugValue(metadata.finish_details)}`
  ];
};

const moderationDebugLines = (conversation) => {
  const messages = Array.isArray(conversation?.messages) ? conversation.messages : [];
  const byId = new Map(messages.filter((message) => message?.id).map((message) => [message.id, message]));
  const results = Array.isArray(conversation?.moderation_results) ? conversation.moderation_results : [];
  const lines = [];
  for (const result of results) {
    const matched = byId.get(result?.message_id);
    const metadata = result?.metadata || {};
    lines.push('[MODERATION]');
    lines.push(`message_id=${result?.message_id || '-'}`);
    lines.push(`matched_message=${Boolean(matched)}`);
    lines.push(`matched_role=${matched?.author?.role || '-'}`);
    lines.push(`blocked=${debugValue(result?.blocked)}`);
    lines.push(`flagged=${debugValue(result?.flagged)}`);
    lines.push(`should_disable_conversation=${debugValue(result?.should_disable_conversation)}`);
    lines.push(`safety_limited=${debugValue(metadata.safety_limited)}`);
    lines.push(`protection_type=${metadata.protection_type || '-'}`);
    lines.push(`block_reason=${metadata.safety_plugin_block_reason || result?.block_reason || '-'}`);
    lines.push(`disclaimers=${debugValue(result?.disclaimers)}`);
    lines.push(`metadata=${debugValue(metadata)}`, '');
  }
  return lines;
};

const groupUserTurns = (messages = []) => {
  const turns = [];
  let current = null;
  for (const message of messages) {
    const role = message?.author?.role || 'unknown';
    if (role === 'user') {
      current = { number: turns.length + 1, messages: [] };
      turns.push(current);
    }
    if (current) current.messages.push(message);
  }
  return turns;
};

const parseLimitSpec = (value) => {
  if (/^[1-9]\d*$/.test(value || '')) return { type: 'latest', count: Number(value) };
  const match = /^([1-9]\d*)-([1-9]\d*)$/.exec(value || '');
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  return end >= start ? { type: 'range', start, end } : null;
};

const formatUserTurns = (conversation, spec, debug = false) => {
  const turns = groupUserTurns(Array.isArray(conversation.messages) ? conversation.messages : []);
  const selected = spec.type === 'latest'
    ? turns.slice(-spec.count)
    : turns.slice(spec.start - 1, spec.end);
  const lines = [`user_turns=${turns.length}`];
  const visibleMessages = [];
  const allMessages = Array.isArray(conversation.messages) ? conversation.messages : [];
  let editableUser = null;
  for (const turn of selected) {
    let visibleIndex = 0;
    for (const message of turn.messages) {
      const rawRole = message?.author?.role || 'unknown';
      if (rawRole === 'user') editableUser = message;
      if (!debug && rawRole !== 'user' && rawRole !== 'assistant') continue;
      const role = rawRole.toUpperCase();
      lines.push(visibleIndex === 0 ? `[#${turn.number}] ${role}` : role);
      lines.push(messageText(message), '');
      if (debug) lines.push(...messageDebugLines(message, allMessages), '');
      visibleMessages.push(message);
      visibleIndex += 1;
    }
  }
  if (debug) lines.push(...moderationDebugLines(conversation));
  const lastMessage = visibleMessages.at(-1);
  if (lastMessage?.id) {
    lines.push(`message_id=${lastMessage.id}`);
    lines.push(`parent_id=${parentIdFor(allMessages, lastMessage) || '-'}`);
    lines.push(`current_node=${conversation.current_node || '-'}`);
    lines.push(`next_parent_message_id=${lastMessage.id}`);
    if (editableUser?.id) {
      lines.push(`edit_message_id=${editableUser.id}`);
      lines.push(`edit_parent_id=${parentIdFor(allMessages, editableUser) || '-'}`);
    }
  }
  return `${lines.join('\n')}\n`;
};

const handleRequestError = (error, output) => {
  if (error?.code === 'AUTH_REQUIRED') {
    output.write('status=AUTH_REQUIRED\n');
    return { exitCode: 6, status: 'AUTH_REQUIRED' };
  }
  if (error?.code === 'BRIDGE_UNAVAILABLE') {
    output.write('status=BRIDGE_UNAVAILABLE\n');
    return { exitCode: 69, status: 'BRIDGE_UNAVAILABLE' };
  }
  if (error?.status === 429) {
    output.write('RATE_LIMITED\nHTTP 429\n');
    return { exitCode: 75, status: 'RATE_LIMITED', httpStatus: 429 };
  }
  throw error;
};

const printTopUsage = (output, providers = []) => {
  output.write('Usage (กติกา: zero เข้าถึงอะไรไม่ได้ถ้าไม่ได้ประกาศ tool — ทุก capability อยู่ใต้ provider เท่านั้น):\n');
  output.write('  zero tools                                        ลิสต์ provider ที่ประกาศไว้ (config: runtime/zero.config.json)\n');
  output.write('  zero <provider>                                   ลิสต์ tools ของ provider\n');
  output.write("  zero <provider> call <tool> '<json>'              เรียก tool ตรงๆ (uniform ทุก provider)\n");
  output.write("  zero <provider mcp> <tool> '<json>'               ฟอร์มสั้นของ provider mcp (ไม่ต้องพิมพ์ call)\n");
  output.write('  zero auth status                                  เช็ค access token (กุญแจของ provider internal)\n');
  output.write('  zero auth refresh                                 ขอ token ใหม่จาก session cookie (token หมด → ไม่ต้อง login ใหม่ถ้า cookie ยังอยู่)\n');
  output.write('  zero report <provider> <title>                    สร้าง engineering feedback report (zero report เพื่อดู usage)\n');
  output.write('\n');
  output.write('  ฟอร์มเก่า zero conversation/project/agent/connectors ถูกย้ายไปไว้ใต้ zero chatgpt ... แล้ว\n');
  output.write('\n');
  if (providers.length) {
    output.write('provider ที่ประกาศไว้ตอนนี้:\n');
    for (const provider of providers) {
      output.write(`  ${provider.name} (${provider.type})${provider.command ? ` — ${provider.command}` : ''}\n`);
    }
  } else {
    output.write('provider: ประกาศใน runtime/zero.config.json (ดู docs/tools-hub.md)\n');
  }
};

const runReportCommand = (args, env, output) => {
  const journalFile = journalCore.resolveFile(env);
  const reportsDir = env.ZERO_REPORT_DIR ? path.resolve(env.ZERO_REPORT_DIR) : reportCore.defaultDir();
  const [action, ...rest] = args;
  const usage = () => {
    output.write('Usage (zero report — engineering feedback report จาก AI tester):\n');
    output.write('  zero report new <provider> <title>    สร้าง skeleton รายงาน (FACT ต้องอ้าง [J:id] เท่านั้น)\n');
    output.write('  zero report <provider> <title>        shorthand ของ new\n');
    output.write('  zero report log [N]                   ดู journal N รอบล่าสุด (เอา [J:id] ไปอ้างใน FACT/EVIDENCE)\n');
    output.write('  zero report check <file>              ตรวจสัญญา: FACT มีหลักฐานจริง · SUGGESTION ห้ามมี [J:]\n');
    output.write('\nกฎเหล็ก: FACT ทุก bullet ต้องอ้าง [J:<journal-id>] ที่มีจริง · SUGGESTION ห้ามมี [J:] เด็ดขาด\n');
    return { exitCode: 64 };
  };
  if (!action) return usage();
  if (action === 'log') {
    const limit = rest[0] ? Number(rest[0]) : 20;
    if (!Number.isInteger(limit) || limit < 1) return usage();
    const entries = journalCore.list({ file: journalFile, limit });
    output.write(`journal=${journalFile}\nentries=${entries.length}\n`);
    for (const entry of entries) {
      output.write(`[J:${entry.id}] exit=${entry.exitCode} ${entry.durationMs}ms  ${entry.argv.join(' ')}\n`);
      const firstLine = String(entry.stdout || '').split('\n').find((line) => line.trim());
      if (firstLine) output.write(`    → ${firstLine.slice(0, 140)}${firstLine.length > 140 ? '…' : ''}\n`);
    }
    return { exitCode: 0, entries };
  }
  if (action === 'check') {
    const file = rest[0];
    if (!file) return usage();
    const result = reportCore.validate({ file: path.resolve(file), journalFile });
    if (result.ok) {
      output.write(`status=OK report=${file}\n`);
      output.write('FACT ทุก bullet มีหลักฐานใน journal จริง · SUGGESTION สะอาด (แยกเลเยอร์ผ่าน)\n');
      return { exitCode: 0 };
    }
    output.write(`status=FAIL report=${file} errors=${result.errors.length}\n`);
    for (const error of result.errors) output.write(`  - ${error}\n`);
    return { exitCode: 1, errors: result.errors };
  }
  const provider = action === 'new' ? rest[0] : action;
  const titleParts = action === 'new' ? rest.slice(1) : rest;
  if (!provider || titleParts.length === 0) return usage();
  const file = reportCore.newReport({ provider, title: titleParts.join(' '), reportsDir });
  output.write(`status=OK\nreport=${file}\n`);
  output.write('ขั้นต่อไป: zero report log เพื่อเลือก [J:id] หลักฐาน → เติม FACT/EVIDENCE → zero report check ก่อนส่ง\n');
  return { exitCode: 0, file };
};

exports.run = async (args = process.argv.slice(2), env = process.env, output = process.stdout, dependencies = {}) => {
  const journalWriter = dependencies.journal
    || (env.ZERO_JOURNAL !== 'off' && env.ZERO_JOURNAL_FILE ? journalCore.createWriter({ file: journalCore.resolveFile(env) }) : null);
  if (!journalWriter) return runInner(args, env, output, dependencies);
  const started = Date.now();
  let captured = '';
  const tee = { write(value) { captured += value; return output.write(value); } };
  try {
    const result = await runInner(args, env, tee, dependencies);
    journalWriter.write({ argv: args, exitCode: result?.exitCode ?? 0, durationMs: Date.now() - started, stdout: captured });
    return result;
  } catch (error) {
    journalWriter.write({ argv: args, exitCode: 1, durationMs: Date.now() - started, stdout: captured, error: error.message });
    throw error;
  }
};

const runInner = async (args = process.argv.slice(2), env = process.env, output = process.stdout, dependencies = {}) => {
  const [rootCommand, rootAction] = args;

  if (!rootCommand) {
    const menu = dependencies.interactiveMenu || interactiveMenu.run;
    const createHubForMenu = dependencies.createHub || ((options) => toolsHub.createHub(options));
    let menuHub = null;
    let providers = [];
    try {
      menuHub = createHubForMenu({ env });
      providers = dependencies.listProviders ? dependencies.listProviders() : menuHub.listProviders();
      const listTools = (name) => dependencies.listTools
        ? dependencies.listTools(name, {})
        : menuHub.listTools(name, {});
      const executeTool = async (name, tool, toolArgs) => {
        const provider = menuHub.getProvider(name);
        if (!provider) throw Object.assign(new Error('provider not found: ' + name), { code: 'UNKNOWN_PROVIDER' });
        let context = {};
        if (provider.type === 'internal') {
          const auth = await inspectAuthWithRefresh(env, dependencies);
          if (auth.result.status !== 'VALID') throw Object.assign(new Error(authStatusLine(auth)), { code: 'AUTH_REQUIRED' });
          const loadSession = dependencies.loadSession || sessionContext.load;
          const session = loadSession(resolveSessionFile(env));
          if (session.status !== 'READY') throw Object.assign(new Error('session=' + session.status), { code: 'SESSION_NOT_READY' });
          context = { token: auth.loaded.token, sessionHeaders: session.headers, taskFile: resolveAgentTaskFile(env) };
        }
        const fn = dependencies.callTool || ((providerName, toolName, argsInput, ctx) => menuHub.callTool(providerName, toolName, argsInput, ctx));
        return fn(name, tool, toolArgs, context);
      };
      const executeCore = (coreArgs) => runInner(coreArgs, env, output, dependencies);
      const selected = await menu({ input: dependencies.input || process.stdin, output, providers, listTools, executeTool, executeCore });
      if (!selected?.args) return { exitCode: selected?.exitCode ?? 0 };
      return runInner(selected.args, env, output, dependencies);
    } catch (error) {
      output.write(`warning=${error.code || 'HUB_ERROR'} ${error.message}\n`);
      return { exitCode: 70 };
    } finally {
      if (menuHub && typeof menuHub.close === 'function') menuHub.close();
    }
  }

  if (rootCommand === 'auth' && rootAction === 'status') {
    const inspected = inspectAuth(env);
    output.write(`${authStatusLine(inspected)}\n`);
    if (inspected.result.reason) output.write(`reason=${inspected.result.reason}\n`);
    if (inspected.result.status === 'EXPIRED') output.write('hint: zero auth refresh — ลองขอ token ใหม่จาก session cookie ก่อน\n');
    return { exitCode: exitCodes[inspected.result.status] ?? 1 };
  }

  if (rootCommand === 'auth' && rootAction === 'refresh') {
    const fn = dependencies.refreshAccessToken || authRefresh.refreshAccessToken;
    const refreshed = await fn({ authFile: resolveAuthFile(env), sessionFile: resolveSessionFile(env) });
    if (refreshed.status === 'REFRESHED') {
      output.write(`refresh=REFRESHED ${authStatusLine(inspectAuth(env))}\n`);
      if (refreshed.cookieRotated) output.write('session_cookie=ROTATED (set-cookie ใหม่ถูก merge กลับ session-context)\n');
      return { exitCode: 0 };
    }
    output.write(`refresh=${refreshed.status}`);
    if (refreshed.httpStatus) output.write(` http=${refreshed.httpStatus}`);
    if (refreshed.sessionStatus) output.write(` session=${refreshed.sessionStatus}`);
    if (refreshed.error) output.write(` error=${refreshed.error}`);
    output.write('\n');
    if (refreshed.status === 'SESSION_DEAD') output.write('session cookie ตายแล้ว — ต้อง login ใหม่เพื่ออัปเดต runtime/session-context.json\n');
    const refreshExit = { NO_SESSION: 5, SESSION_DEAD: 3 };
    return { exitCode: refreshExit[refreshed.status] ?? 1 };
  }

  if (rootCommand === 'report') {
    return runReportCommand(args.slice(1), env, output);
  }

  // === provider dispatch: zero เข้าถึง capability ได้เฉพาะผ่าน provider ที่ประกาศ tool เท่านั้น ===
  const legacyTargets = {
    conversation: 'chatgpt conversation',
    conversations: 'chatgpt conversations',
    project: 'chatgpt project',
    agent: 'chatgpt agent',
    connectors: 'chatgpt connectors'
  };
  if (legacyTargets[rootCommand]) {
    output.write(`ย้ายแล้ว: zero ${rootCommand} ... ใช้ไม่ได้อีก — zero เข้าถึง capability ได้เฉพาะผ่าน provider ที่ประกาศ tool\n`);
    output.write(`ใช้แทน: zero ${legacyTargets[rootCommand]}${args.length > 1 ? ` ${args.slice(1).join(' ')}` : ''}\n`);
    return { exitCode: 64 };
  }

  const createHub = dependencies.createHub || ((options) => toolsHub.createHub(options));
  let hub;
  try {
    hub = createHub({ env });
  } catch (error) {
    output.write(`error=${error.code || 'HUB_ERROR'} ${error.message}\n`);
    return { exitCode: 70 };
  }

  const providerName = rootCommand;
  const provider = providerName ? hub.getProvider(providerName) : null;
  const handledByHub = !providerName || providerName === 'help' || providerName === 'tools'
    || !provider || args.length === 1 || args[1] === 'call' || provider.type !== 'internal';
  if (handledByHub) {
    try {
      if (!providerName || providerName === 'help') {
        printTopUsage(output, hub.listProviders());
        return { exitCode: 64 };
      }
      if (providerName === 'tools') {
        if (args.length !== 1) {
          output.write('Usage: zero tools   (ดู provider ที่ประกาศไว้) แล้ว zero <provider> เพื่อดู tools\n');
          return { exitCode: 64 };
        }
        const providers = dependencies.listProviders ? dependencies.listProviders() : hub.listProviders();
        output.write(`config=${hub.configFile || '-'}\nproviders=${providers.length}\n`);
        for (const item of providers) {
          output.write(`  ${item.name}  type=${item.type}${item.command ? `  command=${item.command}` : ''}\n`);
        }
        return { exitCode: 0, providers };
      }
      if (!provider) {
        output.write(`error=UNKNOWN_PROVIDER ไม่มี provider "${providerName}" — zero เข้าถึงได้เฉพาะ provider ที่ประกาศ tool ไว้เท่านั้น (zero tools เพื่อดูรายชื่อ)\n`);
        return { exitCode: 71 };
      }
      if (args.length === 1) {
        const fn = dependencies.listTools || ((name, ctx) => hub.listTools(name, ctx));
        const items = await fn(providerName, {});
        output.write(`provider=${providerName} type=${provider.type} tools=${items.length}\n`);
        for (const item of items) {
          output.write(`  ${item.name}${item.description ? `  — ${item.description}` : ''}\n`);
          const schema = item.inputSchema;
          const properties = schema?.properties && typeof schema.properties === 'object' ? schema.properties : {};
          const required = Array.isArray(schema?.required) ? schema.required : [];
          const names = Object.keys(properties);
          if (names.length) {
            const rendered = names.map((param) => {
              const type = properties[param]?.type || 'any';
              return required.includes(param) ? `${param}:${type}*` : `${param}:${type}`;
            });
            output.write(`      args: ${rendered.join(', ')}  (* = required)\n`);
          }
        }
        return { exitCode: 0, tools: items };
      }
      // uniform call: zero <provider> call <tool> '<json>' · mcp sugar: zero <provider> <tool> '<json>'
      const isRawCall = args[1] === 'call';
      const toolName = isRawCall ? args[2] : args[1];
      const jsonArg = isRawCall ? args[3] : args[2];
      const validCallShape = isRawCall
        ? Boolean(toolName) && (args.length === 3 || args.length === 4)
        : Boolean(toolName) && (args.length === 2 || args.length === 3);
      if (!validCallShape) {
        output.write(`Usage: zero ${providerName} call <tool> '<json>'${provider.type !== 'internal' ? `  หรือ  zero ${providerName} <tool> '<json>'` : ''}\n`);
        return { exitCode: 64 };
      }
      let toolArgs = {};
      if (jsonArg) {
        try {
          toolArgs = JSON.parse(jsonArg);
        } catch {
          output.write('error=INVALID_JSON args ต้องเป็น JSON เช่น \'{"key":"value"}\'\n');
          return { exitCode: 65 };
        }
      }
      const context = {};
      if (provider.type === 'internal') {
        const toolsAuth = await inspectAuthWithRefresh(env, dependencies);
        if (toolsAuth.result.status !== 'VALID') {
          output.write(`${authStatusLine(toolsAuth)}\n`);
          if (toolsAuth.refresh && toolsAuth.refresh.status !== 'REFRESHED') output.write(`refresh=${toolsAuth.refresh.status}\n`);
          return { exitCode: exitCodes[toolsAuth.result.status] ?? 1 };
        }
        const toolsSession = sessionContext.load(resolveSessionFile(env));
        if (toolsSession.status !== 'READY') {
          output.write(`session=${toolsSession.status}\n`);
          return { exitCode: 5 };
        }
        context.token = toolsAuth.loaded.token;
        context.sessionHeaders = toolsSession.headers;
        context.taskFile = resolveAgentTaskFile(env);
      }
      try {
        const fn = dependencies.callTool || ((name, tool, toolArgsInput, ctx) => hub.callTool(name, tool, toolArgsInput, ctx));
        const result = await fn(providerName, toolName, toolArgs, context);
        output.write(`${JSON.stringify(result, null, 2)}\n`);
        return { exitCode: 0, result };
      } catch (error) {
        if (error?.code === 'UNKNOWN_TOOL') {
          output.write(`error=UNKNOWN_TOOL ${error.message}\n`);
          return { exitCode: 72 };
        }
        if (error?.code === 'MCP_TIMEOUT' || error?.code === 'MCP_EXITED' || error?.code === 'MCP_SPAWN_FAILED' || error?.code === 'MCP_ERROR') {
          output.write(`error=${error.code} ${error.message}\n`);
          return { exitCode: 73 };
        }
        return handleRequestError(error, output);
      }
    } finally {
      if (hub && typeof hub.close === 'function') hub.close();
    }
  }
  hub = null; // chatgpt sugar ไม่แตะ mcp provider — ไม่ต้อง close

  // === provider chatgpt (internal) sugar: zero chatgpt <subcommand> ... ===
  args = args.slice(1);
  const [command, action] = args;

  const isConversationGet = command === 'conversation' && action === 'get' && Boolean(args[2]);
  const isConversationInit = command === 'conversation' && action === 'init' && Boolean(args[2]) && args.length === 3;
  const isConversationStreamStatus = command === 'conversation' && action === 'stream-status' && Boolean(args[2]) && args.length === 3;
  const isConversationResume = command === 'conversation' && action === 'resume' && Boolean(args[2]) && args.length === 3;
  const modelOptFor = (modelIndex, baseLength) => args.length === baseLength || (args.length === baseLength + 2 && args[modelIndex] === 'model' && Boolean(args[modelIndex + 1]));
  const isConversationNew = command === 'conversation' && action === 'new' && Boolean(args[2]) && modelOptFor(3, 3);
  const isConversationSend = command === 'conversation' && action === 'send' && Boolean(args[2]) && Boolean(args[3]) && modelOptFor(4, 4);
  const isProjectConversationNew = command === 'project' && action === 'conversation' && args[2] === 'new'
    && Boolean(args[3]) && Boolean(args[4]) && modelOptFor(5, 5);
  const isProjectConversations = command === 'project' && action === 'conversations' && Boolean(args[2]) && args.length === 3;
  const isConversationRename = command === 'conversation' && action === 'rename' && Boolean(args[2]) && Boolean(args[3]) && args.length === 4;
  const isConversationDel = command === 'conversation' && action === 'del' && Boolean(args[2]) && args.length === 3;
  const isConversationMove = command === 'conversation' && action === 'move' && Boolean(args[2]) && Boolean(args[3]) && args.length === 4;
  const isProjectNew = command === 'project' && action === 'new' && Boolean(args[2]) && args.length === 3;
  const isProjectRename = command === 'project' && action === 'rename' && Boolean(args[2]) && Boolean(args[3]) && args.length === 4;
  const isProjectDel = command === 'project' && action === 'del' && Boolean(args[2]) && args.length === 3;
  const isProjectSave = command === 'project' && action === 'save' && Boolean(args[2]) && Boolean(args[3]) && Boolean(args[4]) && args.length === 5;
  const isAgentTakeover = command === 'agent' && action === 'takeover' && Boolean(args[2]) && Boolean(args[3]) && args.length === 4;
  const isAgentResume = command === 'agent' && action === 'resume' && Boolean(args[2]) && args.length === 3;
  const isAgentSpawn = command === 'agent' && action === 'spawn' && Boolean(args[2]) && Boolean(args[3]) && Boolean(args[4]) && args.length === 5;
  const isAgentReturn = command === 'agent' && action === 'return' && Boolean(args[2]) && Boolean(args[3]) && args.length === 4;
  const isAgentSay = command === 'agent' && action === 'say' && Boolean(args[2]) && Boolean(args[3]) && args.length === 4;
  const isAgentReply = command === 'agent' && action === 'reply' && Boolean(args[2]) && Boolean(args[3]) && args.length === 4;
  const isAgentStatus = command === 'agent' && action === 'status' && Boolean(args[2]) && args.length === 3;
  const isAgentCheck = command === 'agent' && action === 'check' && Boolean(args[2]) && args.length === 3;
  const isAgentList = command === 'agent' && action === 'list' && args.length === 2;
  const isAgentCommand = isAgentTakeover || isAgentResume || isAgentSpawn || isAgentReturn || isAgentSay || isAgentReply || isAgentStatus || isAgentCheck || isAgentList;
  const isConnectors = command === 'connectors' && args.length === 1;
  const isSearch = command === 'search' && args.length >= 2;
  const isManagement = isConversationNew || isConversationSend || isProjectConversationNew || isConversationRename
    || isConversationDel || isConversationMove || isProjectNew || isProjectRename || isProjectDel || isProjectSave;
  const allMode = isConversationGet && args[3] === 'all' && args.length === 4;
  const limitSpec = isConversationGet && args[3] === 'limit' ? parseLimitSpec(args[4]) : null;
  const debugMode = isConversationGet && args[5] === 'debug';
  const validGetOptions = !isConversationGet || args.length === 3
    || allMode
    || (args[3] === 'limit' && limitSpec && (args.length === 5 || (args.length === 6 && debugMode)));
  if ((command !== 'conversations' && !isSearch && !isConnectors && !isConversationGet && !isConversationInit && !isConversationStreamStatus && !isConversationResume && !isProjectConversations && !isManagement && !isAgentCommand) || !validGetOptions) {
    output.write('Usage (provider chatgpt · internal):\n');
    output.write('  zero chatgpt                                      ลิสต์ tools ของ provider นี้\n');
    output.write('  zero chatgpt call <tool> \'<json>\'                 เรียก tool ตรงๆ (uniform เหมือน provider อื่น)\n');
    output.write('  zero chatgpt conversations                        ลิสต์ conversation หนึ่ง global page (default 50) แยกตาม project; ดู nextOffset ถ้ามีหน้าถัดไป\n');
    output.write('  zero chatgpt connectors                           ลิสต์ connector/plugin ที่ติดตั้งใน account\n');
    output.write('\n');
    output.write('ห้อง (conversation):\n');
    output.write('  zero chatgpt conversation new <message> [model <slug>]    สร้างห้องใหม่นอก project พร้อมข้อความแรก (model default=gpt-5-6-thinking + thinking_effort=extended สูงสุดตามเว็บ, init อัตโนมัติ)\n');
    output.write('  zero chatgpt conversation send <conversation_id> <message> [model <slug>]  ส่งข้อความต่อ; direct รอ response stream จบและ fetch state หลังส่ง; browser รอ submission acknowledgement\n');
    output.write('  zero chatgpt conversation get <conversation_id>           อ่าน metadata ห้อง (current_node ฯลฯ)\n');
    output.write('  zero chatgpt conversation get <conversation_id> all       อ่านทุก historical page แบบ raw page boundaries\n');
    output.write('  zero chatgpt conversation init <conversation_id>          อ่าน init metadata ห้อง (default model + limits ตามเว็บจริง)\n');
    output.write('  zero chatgpt conversation stream-status <conversation_id> อ่านสถานะ completion stream ปัจจุบัน\n');
    output.write('  zero chatgpt conversation resume <conversation_id>        resume completion stream เดิมจาก backend\n');
    output.write('  zero chatgpt conversation get <conversation_id> limit <N|A-B> [debug]\n');
    output.write('                                                            อ่าน N เทิร์นล่าสุด หรือเทิร์น A ถึง B; debug เห็น system/tool nodes\n');
    output.write('  zero chatgpt conversation rename <conversation_id> <title>  เปลี่ยนชื่อห้อง\n');
    output.write('  zero chatgpt conversation del <conversation_id>           ลบห้อง (archive)\n');
    output.write('  zero chatgpt conversation move <conversation_id> <project_id|exit>  ย้ายห้องเข้า/ออก project\n');
    output.write('\n');
    output.write('โปรเจ็ค (project):\n');
    output.write('  zero chatgpt project new <name>                           สร้าง project ใหม่\n');
    output.write('  zero chatgpt project rename <project_id> <name>           เปลี่ยนชื่อ project\n');
    output.write('  zero chatgpt project del <project_id>                     ลบ project\n');
    output.write('  zero chatgpt project save <project_id> <conversation_id> <message_id>  บันทึก message ลง Project saves\n');
    output.write('  zero chatgpt project conversations <project_id>           ลิสต์ห้องใน project\n');
    output.write('  zero chatgpt project conversation new <project_id> <message> [model <slug>]  สร้างห้องใน project พร้อมข้อความแรก\n');
    output.write('\n');
    output.write('เอเจนต์ (ห้องคุยกันผ่าน zero):\n');
    output.write('  zero chatgpt agent takeover <source_conversation_id> <message>\n');
    output.write('                                                            สร้าง worker ใหม่เอง → audit source → ทำงานต่อหลัง gate เปิด\n');
    output.write('  zero chatgpt agent resume <task_id>                     resume takeover เดิมจาก cursor เดิม; ไม่สร้าง worker ใหม่\n');
    output.write('  zero chatgpt agent spawn <worker_conversation_id> <parent_conversation_id> <message>\n');
    output.write('                                                            สั่งงาน worker พร้อมฝัง task_id + return rule (คืนหลัง dispatch สำเร็จ; ไม่รอ worker จบ)\n');
    output.write('  zero chatgpt agent say <task_id> <message>                parent ส่งข้อความต่อเข้าห้อง worker (คุยต่อได้ไม่ปิดงาน)\n');
    output.write('  zero chatgpt agent reply <task_id> <message>              worker ถาม/รายงานกลับ parent ระหว่างทาง (ไม่ปิดงาน)\n');
    output.write('  zero chatgpt agent return <task_id> <report>              worker ส่งรายงานสุดท้ายกลับ parent + ปิดงาน (FACT / VERIFIED / BLOCKER / STATE / NEXT)\n');
    output.write('  zero chatgpt agent check <task_id>                        เก็บผล worker ที่จบเงียบๆ + ส่งเข้าห้อง parent\n');
    output.write('  zero chatgpt agent status <task_id> / agent list          ดูสถานะงาน/ทุกงาน\n');
    output.write('\n');
    output.write('Howto:\n');
    output.write('  - สร้างห้องใน project แล้วอ่านคำตอบ:\n');
    output.write('      zero chatgpt project conversation new g-p-xxx "งานที่จะสั่ง"\n');
    output.write('      zero chatgpt conversation get <conversation_id> limit 1\n');
    output.write('  - ให้ห้องรันคำสั่งบนเครื่อง ต้องระบุชื่อ tool ในข้อความ เช่น:\n');
    output.write('      "ใช้ Remote Desktop Commander รัน: <cmd> ห้ามตอบว่าไม่มี tool ถ้ายังไม่ได้เรียก list_devices"\n');
    output.write('  - chain worker: zero chatgpt agent spawn <worker> <main> "งาน" แล้ว worker จบสั่ง zero chatgpt agent return <task_id> "สรุป"\n');
    output.write('  - เรียก tool ผ่าน hub (มือของ zero):\n');
    output.write('      zero tools                                        ดูว่ามี provider อะไรบ้าง\n');
    output.write('      zero computeruse                                  ดู tool ทั้งหมดของ provider\n');
    output.write('      zero computeruse call shell \'{"command":"echo hi"}\'\n');
    output.write('      zero computeruse call screenshot \'{"monitorIndex":0}\'\n');
    output.write('      zero chatgpt call connectors_list \'{}\'            internal ต้อง auth VALID ก่อน (zero auth status)\n');
    output.write('  - เพิ่ม provider ใหม่: แก้ runtime/zero.config.json เพิ่ม block แล้ว zero <ชื่อ> เช็ค — ดู docs/tools-hub.md\n');
    output.write('\n');
    output.write('Env:\n');
    output.write('  ZERO_CHATGPT_SEND_TRANSPORT=browser               ใช้ browser bridge แทน direct API (default=direct)\n');
    output.write('  ZERO_AGENT_TASK_FILE=<path>                       ที่เก็บ task registry (default runtime/agent-tasks.json)\n');
    output.write('  ZERO_AGENT_PROJECT_ID=<g-p-...>                   Project ปลายทางสำหรับ worker takeover (override runtime/agent-settings.json)\n');
    output.write('  ZERO_CONFIG_FILE=<path>                           config ของ tools hub (default runtime/zero.config.json)\n');
    return { exitCode: 64 };
  }

  const inspected = await inspectAuthWithRefresh(env, dependencies);
  if (inspected.refreshed) output.write('auth=REFRESHED token หมดอายุ → ขอ token ใหม่จาก session cookie สำเร็จ\n');
  if (inspected.result.status !== 'VALID') {
    output.write(`${authStatusLine(inspected)}\n`);
    if (inspected.refresh && inspected.refresh.status !== 'REFRESHED') output.write(`refresh=${inspected.refresh.status}\n`);
    return { exitCode: exitCodes[inspected.result.status] ?? 1 };
  }

  const loadSession = dependencies.loadSession || sessionContext.load;
  const session = loadSession(resolveSessionFile(env));
  if (session.status !== 'READY') {
    output.write(`session=${session.status}\n`);
    return { exitCode: 5 };
  }

  const chatgptContext = {
    token: inspected.loaded.token,
    sessionHeaders: session.headers,
    taskFile: resolveAgentTaskFile(env)
  };
  const callChatgptTool = async (toolName, toolArgs = {}) => {
    if (typeof dependencies.callChatgptTool === 'function') {
      return dependencies.callChatgptTool(toolName, toolArgs, chatgptContext);
    }
    const providerHub = createHub({ env });
    try {
      return await providerHub.callTool('chatgpt', toolName, toolArgs, chatgptContext);
    } finally {
      if (providerHub && typeof providerHub.close === 'function') providerHub.close();
    }
  };

  if (isSearch) {
    try {
      const query = args.slice(1).join(' ').trim();
      const result = dependencies.searchGlobal
        ? await dependencies.searchGlobal({
          query,
          source: 'conversation',
          token: inspected.loaded.token,
          sessionHeaders: session.headers
        })
        : await callChatgptTool('global_search', { query, source: 'conversation' });
      output.write(formatSearchResults(result));
      return { exitCode: 0, search: result };
    } catch (error) {
      return handleRequestError(error, output);
    }
  }  if (isConnectors) {
    try {
      const items = dependencies.listConnectors
        ? await dependencies.listConnectors({ token: inspected.loaded.token, sessionHeaders: session.headers })
        : await callChatgptTool('connectors_list');
      output.write(formatConnectors(items));
      return { exitCode: 0, connectors: items };
    } catch (error) {
      return handleRequestError(error, output);
    }
  }
  if (isAgentCommand) {
    const base = { token: inspected.loaded.token, sessionHeaders: session.headers, taskFile: resolveAgentTaskFile(env) };
    try {
      if (isAgentTakeover) {
        const result = dependencies.spawnTakeover
          ? await dependencies.spawnTakeover({
            ...base,
            parentConversationId: args[2],
            workerProjectId: resolveAgentProjectId(env),
            parentTaskId: env.ZERO_AGENT_PARENT_TASK_ID || null,
            taskMessage: args[3]
          })
          : await callChatgptTool('agent_takeover', {
            parent_conversation_id: args[2],
            worker_project_id: resolveAgentProjectId(env),
            parent_task_id: env.ZERO_AGENT_PARENT_TASK_ID || null,
            message: args[3]
          });
        output.write(`status=${result.status}\ntask_id=${result.task_id}\nagent_id=${result.agent_id}\nsource_conversation_id=${result.source_conversation_id}\nworker_project_id=${result.worker_project_id || '-'}\noutput_dir=${result.output_dir}\n`);
        if (result.audit_cursor !== undefined) output.write(`audit_cursor=${result.audit_cursor}/${result.audit_total_user_turns || 0}\n`);
        if (result.audit_next_window) output.write(`audit_next_window=${result.audit_next_window}\n`);
        if (result.http_status) output.write(`http_status=${result.http_status}\n`);
        if (result.retry_after_ms !== undefined && result.retry_after_ms !== null) output.write(`retry_after_ms=${result.retry_after_ms}\n`);
        if (result.retry_not_before) output.write(`retry_not_before=${result.retry_not_before}\n`);
        if (result.current_node) output.write(`current_node=${result.current_node}\n`);
      } else if (isAgentResume) {
        const result = dependencies.resumeTakeover
          ? await dependencies.resumeTakeover({ ...base, taskId: args[2] })
          : await callChatgptTool('agent_resume', { task_id: args[2] });
        output.write(`status=${result.status}\ntask_id=${result.task_id}\nagent_id=${result.agent_id}\nsource_conversation_id=${result.source_conversation_id}\noutput_dir=${result.output_dir}\n`);
        if (result.audit_cursor !== undefined) output.write(`audit_cursor=${result.audit_cursor}/${result.audit_total_user_turns || 0}\n`);
        if (result.audit_next_window) output.write(`audit_next_window=${result.audit_next_window}\n`);
        if (result.http_status) output.write(`http_status=${result.http_status}\n`);
        if (result.retry_after_ms !== undefined && result.retry_after_ms !== null) output.write(`retry_after_ms=${result.retry_after_ms}\n`);
        if (result.retry_not_before) output.write(`retry_not_before=${result.retry_not_before}\n`);
        if (result.current_node) output.write(`current_node=${result.current_node}\n`);
      } else if (isAgentSpawn) {
        const result = dependencies.spawnAgent
          ? await dependencies.spawnAgent({
            ...base,
            workerConversationId: args[2],
            parentConversationId: args[3],
            parentTaskId: env.ZERO_AGENT_PARENT_TASK_ID || null,
            taskMessage: args[4]
          })
          : await callChatgptTool('agent_spawn', {
            worker_conversation_id: args[2],
            parent_conversation_id: args[3],
            parent_task_id: env.ZERO_AGENT_PARENT_TASK_ID || null,
            message: args[4]
          });
        output.write(`status=${result.status}\ntask_id=${result.task_id}\nagent_id=${result.agent_id}\n`);
        if (result.current_node) output.write(`current_node=${result.current_node}\n`);
      } else if (isAgentReturn) {
        const result = dependencies.returnAgent
          ? await dependencies.returnAgent({ ...base, taskId: args[2], report: args[3] })
          : await callChatgptTool('agent_return', { task_id: args[2], report: args[3] });
        output.write(`status=${result.status}\ntask_id=${result.task_id}\nparent_conversation_id=${result.parent_conversation_id}\n`);
        if (result.current_node) output.write(`current_node=${result.current_node}\n`);
      } else if (isAgentSay) {
        const result = dependencies.sendMessage
          ? await dependencies.sendMessage({ ...base, taskId: args[2], message: args[3] })
          : await callChatgptTool('agent_say', { task_id: args[2], message: args[3] });
        output.write(`status=${result.status}\ntask_id=${result.task_id}\nagent_id=${result.agent_id}\n`);
        if (result.current_node) output.write(`current_node=${result.current_node}\n`);
      } else if (isAgentReply) {
        const result = dependencies.replyAgent
          ? await dependencies.replyAgent({ ...base, taskId: args[2], message: args[3] })
          : await callChatgptTool('agent_reply', { task_id: args[2], message: args[3] });
        output.write(`status=${result.status}\ntask_id=${result.task_id}\nparent_conversation_id=${result.parent_conversation_id}\n`);
        if (result.current_node) output.write(`current_node=${result.current_node}\n`);
      } else if (isAgentCheck) {
        const result = dependencies.checkAgent
          ? await dependencies.checkAgent({ ...base, taskId: args[2] })
          : await callChatgptTool('agent_check', { task_id: args[2] });
        output.write(`status=${result.task.status}\ntask_id=${result.task.task_id}\ndelivered=${result.delivered}\n`);
        if (result.task.delivery_status) output.write(`delivery=${result.task.delivery_status}\n`);
      } else if (isAgentStatus) {
        const task = dependencies.agentStatus
          ? await dependencies.agentStatus({ ...base, taskId: args[2] })
          : await callChatgptTool('agent_status', { task_id: args[2] });
        output.write(`task_id=${task.task_id}\nstatus=${task.status}\nworker=${task.worker_conversation_id}\nparent=${task.parent_conversation_id}\n`);
        if (task.delivery_status) output.write(`delivery=${task.delivery_status}\n`);
        if (task.result_text) output.write(`result=${task.result_text.slice(0, 200)}\n`);
      } else {
        const tasks = dependencies.listAgents
          ? await dependencies.listAgents({ ...base })
          : await callChatgptTool('agent_list');
        output.write(`tasks=${tasks.length}\n`);
        for (const task of tasks) {
          output.write(`  ${task.task_id}  ${task.status}  worker=${task.worker_conversation_id}  parent=${task.parent_conversation_id}  delivery=${task.delivery_status || '-'}\n`);
        }
      }
      return { exitCode: 0 };
    } catch (error) { return handleRequestError(error, output); }
  }
  if (isManagement) {
    const base = { token: inspected.loaded.token, sessionHeaders: session.headers };
    try {
      if (isConversationNew || isProjectConversationNew) {
        const projectId = isProjectConversationNew ? args[3] : null;
        const message = isProjectConversationNew ? args[4] : args[2];
        const modelIndex = isProjectConversationNew ? 5 : 3;
        const model = args[modelIndex] === 'model' ? args[modelIndex + 1] : undefined;
        const listConnectors = dependencies.listConnectors
          || (() => callChatgptTool('connectors_list'));
        const selection = await resolveSystemHintSelections({ message, ...base, listConnectors });
        const created = dependencies.createConversation
          ? await dependencies.createConversation({ ...base, message, projectId, model, ...selection })
          : await callChatgptTool('conversation_new', {
            message,
            project_id: projectId,
            model,
            system_hints: selection.systemHints,
            system_hint_mentions: selection.systemHintMentions
          });
        const conversationId = created?.conversation_id || created?.id || '-';
        output.write(`status=OK\nconversation_id=${conversationId}\n`);
        if (projectId) output.write(`project_id=${projectId}\n`);
        if (model) output.write(`model=${model}\n`);
        if (created?.init) {
          output.write('init=OK\n');
          if (created.init.default_model_slug) output.write(`default_model_slug=${created.init.default_model_slug}\n`);
        } else if (created?.init_error) {
          output.write(`init=FAILED ${created.init_error}\n`);
        }
        if (created?.current_node) output.write(`current_node=${created.current_node}\n`);
      } else if (isConversationSend) {
        const model = args[4] === 'model' ? args[5] : undefined;
        const transport = env.ZERO_CHATGPT_SEND_TRANSPORT === 'browser' ? 'browser' : 'direct';
        const sent = dependencies.sendConversation
          ? await dependencies.sendConversation({
            ...base,
            conversationId: args[2],
            message: args[3],
            model,
            transport
          })
          : await callChatgptTool('conversation_send', {
            conversation_id: args[2],
            message: args[3],
            model,
            transport
          });
        output.write(`status=DISPATCHED\nconversation_id=${sent?.conversation_id || sent?.id || args[2]}\n`);
        if (args[4] === 'model') output.write(`model=${args[5]}\n`);
        if (sent?.current_node) output.write(`current_node=${sent.current_node}\n`);
      } else if (isConversationRename) {
        if (dependencies.renameConversation) {
          await dependencies.renameConversation({ ...base, conversationId: args[2], title: args[3] });
        } else {
          await callChatgptTool('conversation_rename', { conversation_id: args[2], title: args[3] });
        }
        output.write(`status=OK\nconversation_id=${args[2]}\n`);
      } else if (isConversationDel) {
        if (dependencies.deleteConversation) {
          await dependencies.deleteConversation({ ...base, conversationId: args[2] });
        } else {
          await callChatgptTool('conversation_delete', { conversation_id: args[2] });
        }
        output.write(`status=OK\nconversation_id=${args[2]}\n`);
      } else if (isConversationMove) {
        const projectId = args[3] === 'exit' ? null : args[3];
        if (dependencies.moveConversation) {
          await dependencies.moveConversation({ ...base, conversationId: args[2], projectId });
        } else {
          await callChatgptTool('conversation_move', { conversation_id: args[2], project_id: projectId });
        }
        output.write(`status=OK\nconversation_id=${args[2]}\nproject_id=${projectId || '-'}\n`);
      } else if (isProjectNew) {
        const result = dependencies.createProject
          ? await dependencies.createProject({ ...base, name: args[2] })
          : await callChatgptTool('project_create', { name: args[2] });
        const projectId = result?.id || result?.project_id || result?.gizmo?.id || result?.gizmo?.gizmo?.id || '-';
        output.write(`status=OK\nproject_id=${projectId}\n`);
      } else if (isProjectRename) {
        if (dependencies.renameProject) {
          await dependencies.renameProject({ ...base, projectId: args[2], name: args[3] });
        } else {
          await callChatgptTool('project_rename', { project_id: args[2], name: args[3] });
        }
        output.write(`status=OK\nproject_id=${args[2]}\n`);
      } else if (isProjectDel) {
        if (dependencies.deleteProject) {
          await dependencies.deleteProject({ ...base, projectId: args[2] });
        } else {
          await callChatgptTool('project_delete', { project_id: args[2] });
        }
        output.write(`status=OK\nproject_id=${args[2]}\n`);
      } else if (isProjectSave) {
        if (dependencies.saveProjectMessage) {
          await dependencies.saveProjectMessage({ ...base, projectId: args[2], conversationId: args[3], messageId: args[4] });
        } else {
          await callChatgptTool('project_save', {
            project_id: args[2], conversation_id: args[3], message_id: args[4]
          });
        }
        output.write(`status=OK\nproject_id=${args[2]}\nconversation_id=${args[3]}\nmessage_id=${args[4]}\n`);
      }
      return { exitCode: 0 };
    } catch (error) { return handleRequestError(error, output); }
  }
  if (isProjectConversations) {
    try {
      const page = dependencies.listProjectConversationPage
        ? await dependencies.listProjectConversationPage({
          projectId: args[2],
          token: inspected.loaded.token,
          sessionHeaders: session.headers
        })
        : await callChatgptTool('project_conversations', { project_id: args[2] });
      output.write(formatProjectConversations(args[2], page));
      return { exitCode: 0, projectId: args[2], conversations: page };
    } catch (error) {
      return handleRequestError(error, output);
    }
  }
  if (isConversationGet) {
    if (allMode) {
      try {
        const history = dependencies.getConversationHistory
          ? await dependencies.getConversationHistory({
            conversationId: args[2],
            token: inspected.loaded.token,
            sessionHeaders: session.headers
          })
          : await callChatgptTool('conversation_all', { conversation_id: args[2] });
        output.write(JSON.stringify(history, null, 2) + '\n');
        return { exitCode: 0, history };
      } catch (error) {
        return handleRequestError(error, output);
      }
    }
    try {
      const conversation = dependencies.getConversation
        ? await dependencies.getConversation({
          conversationId: args[2],
          token: inspected.loaded.token,
          sessionHeaders: session.headers
        })
        : await callChatgptTool('conversation_get', { conversation_id: args[2] });
      output.write(formatConversation(conversation, !limitSpec));
      if (limitSpec) output.write(formatUserTurns(conversation, limitSpec, debugMode));
      return { exitCode: 0, conversation };
    } catch (error) {
      return handleRequestError(error, output);
    }
  }
  if (isConversationInit) {
    try {
      const init = dependencies.initConversation
        ? await dependencies.initConversation({
          conversationId: args[2],
          token: inspected.loaded.token,
          sessionHeaders: session.headers
        })
        : await callChatgptTool('conversation_init', { conversation_id: args[2] });
      output.write(`status=OK\nconversation_id=${args[2]}\n`);
      output.write(`default_model_slug=${init?.default_model_slug || '-'}\n`);
      output.write(`intended_default_model_slug=${init?.intended_default_model_slug || '-'}\n`);
      const limits = Array.isArray(init?.limits_progress) ? init.limits_progress : [];
      output.write(`limits=${limits.length}\n`);
      for (const item of limits) {
        output.write(`  ${item?.feature_name || '-'} remaining=${item?.remaining ?? '-'} reset_after=${item?.reset_after || '-'}\n`);
      }
      return { exitCode: 0, init };
    } catch (error) {
      return handleRequestError(error, output);
    }
  }

  if (isConversationStreamStatus) {
    try {
      const status = dependencies.getConversationStreamStatus
        ? await dependencies.getConversationStreamStatus({
          conversationId: args[2],
          token: inspected.loaded.token,
          sessionHeaders: session.headers
        })
        : await callChatgptTool('conversation_stream_status', { conversation_id: args[2] });
      output.write(`status=${status?.status || '-'}\nconversation_id=${args[2]}\n`);
      return { exitCode: 0, streamStatus: status };
    } catch (error) {
      return handleRequestError(error, output);
    }
  }
  if (isConversationResume) {
    try {
      const resumed = dependencies.resumeConversation
        ? await dependencies.resumeConversation({
          conversationId: args[2],
          token: inspected.loaded.token,
          sessionHeaders: session.headers
        })
        : await callChatgptTool('conversation_resume', { conversation_id: args[2] });
      output.write(`status=OK\nconversation_id=${resumed?.conversation_id || args[2]}\n`);
      output.write(`http_status=${resumed?.status ?? '-'}\n`);
      output.write(`content_type=${resumed?.content_type || '-'}\n`);
      if (resumed?.text) output.write(resumed.text.endsWith('\n') ? resumed.text : `${resumed.text}\n`);
      return { exitCode: 0, resume: resumed };
    } catch (error) {
      return handleRequestError(error, output);
    }
  }

  output.write('Loading conversations...\n');
  try {
    const result = dependencies.listAll
      ? await dependencies.listAll({
        token: inspected.loaded.token,
        sessionHeaders: session.headers,
        onProgress: (event) => {
          if (event.type === 'conversation-page') {
            output.write(`  Indexed ${event.count} conversations...\n`);
          } else if (event.type === 'standalone-loaded') {
            output.write(`[OK] Conversation index: ${event.count}\n`);
          } else if (event.type === 'projects-loaded') {
            output.write(`[OK] Projects: ${event.count}\n`);
          } else if (event.type === 'done') {
            output.write(`[OK] Loaded ${event.returned ?? event.total} conversations from this page\n\n`);
          }
        }
      })
      : await callChatgptTool('conversations_list');

    output.write(formatConversations(result));
    return { exitCode: 0, conversations: result };
  } catch (error) {
    return handleRequestError(error, output);
  }
};

if (require.main === module) {
  // journal เฉพาะตอนรันจริง — ตอน unit test เรียก exports.run ตรงจะไม่มี writer นี้
  // และตอนถูก spawn จาก test runner (NODE_TEST_CONTEXT ถูกสืบทอดมาอัตโนมัติ) ก็ไม่ journal (ไม่มีพลุใน repo)
  const mainJournal = process.env.ZERO_JOURNAL === 'off' || process.env.NODE_TEST_CONTEXT
    ? null
    : journalCore.createWriter({ file: journalCore.resolveFile(process.env) });
  exports.run(process.argv.slice(2), process.env, process.stdout, mainJournal ? { journal: mainJournal } : {})
    .then((result) => {
      process.exitCode = result.exitCode;
    })
    .catch((error) => {
      console.error(`[Zero-ChatGPT] fatal: ${error.message}`);
      process.exitCode = 1;
    });
}
