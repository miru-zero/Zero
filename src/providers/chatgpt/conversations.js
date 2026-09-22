const crypto = require('node:crypto');
const chatgptClient = require('./chatgpt-client');
const sentinel = require('./sentinel');
const browserBridge = require('./browser-bridge');

const requireOk = (response, target) => {
  if (!response || response.status !== 200 || !response.json) {
    const error = new Error(`ChatGPT request failed (${response?.status || 'no-status'}): ${target}`);
    error.status = response?.status || null;
    error.target = target;
    error.retryAfterMs = chatgptClient.parseRetryAfterMs(response?.headers || {});
    if (error.status === 429) error.code = 'RATE_LIMITED';
    throw error;
  }
  return response.json;
};

exports.listConversationPage = async ({
  token,
  sessionHeaders,
  offset = 0,
  limit = 50,
  requestJson = chatgptClient.requestJson,
  onProgress = () => {}
}) => {
  const target = `/backend-api/conversations?offset=${offset}&limit=${limit}&order=updated&is_archived=false&is_starred=false`;
  const page = requireOk(await requestJson(target, token, sessionHeaders), target);
  const items = Array.isArray(page.items) ? page.items : [];
  const totalValue = Number(page.total);
  const total = Number.isFinite(totalValue) ? totalValue : items.length;
  const pageLimit = Number(page.limit) || limit;
  const pageOffset = Number(page.offset) || offset;
  const nextOffset = items.length > 0 && pageOffset + pageLimit < total
    ? pageOffset + pageLimit
    : null;
  onProgress({ type: 'conversation-page', count: items.length, pageCount: items.length, offset: pageOffset, total });
  return { items, total, limit: pageLimit, offset: pageOffset, nextOffset };
};

exports.listStandalone = async ({
  token,
  sessionHeaders,
  requestJson = chatgptClient.requestJson,
  onProgress = () => {}
}) => {
  const items = [];
  let offset = 0;
  const limit = 50;

  while (true) {
    const target = `/backend-api/conversations?offset=${offset}&limit=${limit}&order=updated&is_archived=false&is_starred=false`;
    const page = requireOk(await requestJson(target, token, sessionHeaders), target);
    const pageItems = Array.isArray(page.items) ? page.items : [];
    items.push(...pageItems);
    onProgress({ type: 'conversation-page', count: items.length, pageCount: pageItems.length, offset });

    const total = Number(page.total);
    const pageLimit = Number(page.limit) || limit;
    offset += pageLimit;
    if (!Number.isFinite(total) || offset >= total || pageItems.length === 0) break;
  }
  return items;
};
exports.listProjects = async ({ token, sessionHeaders, requestJson = chatgptClient.requestJson }) => {
  const projects = [];
  let cursor = null;

  while (true) {
    const cursorPart = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
    const target = `/backend-api/gizmos/snorlax/sidebar?owned_only=true&conversations_per_gizmo=5&limit=20${cursorPart}`;
    const page = requireOk(await requestJson(target, token, sessionHeaders), target);

    for (const item of Array.isArray(page.items) ? page.items : []) {
      const gizmo = item?.gizmo?.gizmo;
      if (!gizmo?.id) continue;
      projects.push({
        id: gizmo.id,
        name: gizmo.display?.name || gizmo.short_url || gizmo.id
      });
    }

    if (!page.cursor || page.cursor === cursor) break;
    cursor = page.cursor;
  }
  return projects;
};

exports.listProjectConversationPage = async ({
  projectId,
  token,
  sessionHeaders,
  cursor = '0',
  limit = 50,
  requestJson = chatgptClient.requestJson
}) => {
  if (!projectId) throw new Error('projectId is required');
  const target = `/backend-api/gizmos/${encodeURIComponent(projectId)}/conversations?cursor=${encodeURIComponent(cursor)}&limit=${limit}&owned_only=true`;
  const page = requireOk(await requestJson(target, token, sessionHeaders, {
    route: '/backend-api/gizmos/{gizmo_id}/conversations'
  }), target);
  return {
    items: Array.isArray(page.items) ? page.items : [],
    cursor,
    nextCursor: page.cursor && page.cursor !== cursor ? page.cursor : null
  };
};

exports.listProjectConversations = async ({ projectId, token, sessionHeaders, requestJson = chatgptClient.requestJson }) => {
  const items = [];
  let cursor = '0';

  while (true) {
    const target = `/backend-api/gizmos/${encodeURIComponent(projectId)}/conversations?cursor=${encodeURIComponent(cursor)}&limit=50&owned_only=true`;
    const page = requireOk(await requestJson(target, token, sessionHeaders, {
      route: '/backend-api/gizmos/{gizmo_id}/conversations'
    }), target);
    const pageItems = Array.isArray(page.items) ? page.items : [];
    items.push(...pageItems);

    if (!page.cursor || page.cursor === cursor) break;
    cursor = page.cursor;
  }
  return items;
};

exports.listAll = async ({
  token,
  sessionHeaders,
  requestJson = chatgptClient.requestJson,
  onProgress = () => {}
}) => {
  const conversationPromise = exports.listConversationPage({
    token,
    sessionHeaders,
    requestJson,
    onProgress
  }).then((page) => {
    onProgress({ type: 'standalone-loaded', count: page.items.length, total: page.total });
    return page;
  });
  const projectPromise = exports.listProjects({ token, sessionHeaders, requestJson })
    .then((items) => {
      onProgress({ type: 'projects-loaded', count: items.length });
      return items;
    });

  const [conversationPage, projectList] = await Promise.all([conversationPromise, projectPromise]);
  const allConversations = conversationPage.items;
  const projects = projectList.map((project) => ({ ...project, conversations: [] }));
  const projectsById = new Map(projects.map((project) => [project.id, project]));
  const outside = [];

  for (const item of allConversations) {
    const project = item.gizmo_id ? projectsById.get(item.gizmo_id) : null;
    if (project) project.conversations.push(item);
    else outside.push(item);
  }

  const result = {
    outside,
    projects,
    returned: allConversations.length,
    total: conversationPage.total,
    offset: conversationPage.offset,
    limit: conversationPage.limit,
    nextOffset: conversationPage.nextOffset
  };
  onProgress({ type: 'done', returned: result.returned, total: result.total });
  return result;
};

exports.searchGlobal = async ({
  query,
  cursor = null,
  limit = 20,
  source = 'conversation',
  token,
  sessionHeaders,
  requestJson = chatgptClient.requestJson
}) => {
  const normalized = String(query || '').trim();
  if (!normalized) throw new Error('query is required');
  const params = new URLSearchParams({ query: normalized, limit: String(limit) });
  if (cursor) params.set('cursor', cursor);
  if (source) params.set('sources', source);
  const target = `/backend-api/global/search?${params.toString()}`;
  return requireOk(await requestJson(target, token, sessionHeaders, {
    route: '/backend-api/global/search'
  }), target);
};
exports.getConversation = async ({
  conversationId,
  token,
  sessionHeaders,
  requestJson = chatgptClient.requestJson
}) => {
  if (!conversationId) throw new Error('conversationId is required');
  const target = `/backend-api/conversations/${encodeURIComponent(conversationId)}`;
  return requireOk(await requestJson(target, token, sessionHeaders, {
    route: '/backend-api/conversations/{conversation_id}'
  }), target);
};

exports.getConversationStreamStatus = async ({
  conversationId,
  token,
  sessionHeaders,
  requestJson = chatgptClient.requestJson
}) => {
  if (!conversationId) throw new Error('conversationId is required');
  const target = `/backend-api/conversation/${encodeURIComponent(conversationId)}/stream_status`;
  return requireOk(await requestJson(target, token, sessionHeaders, {
    route: '/backend-api/conversation/{conversation_id}/stream_status'
  }), target);
};

exports.resumeConversation = async ({
  conversationId,
  offset = 0,
  conduitToken = null,
  turnTraceId = null,
  onChunk = null,
  token,
  sessionHeaders,
  requestText = chatgptClient.requestText
}) => {
  if (!conversationId) throw new Error('conversationId is required');
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('offset must be a non-negative integer');
  const target = '/backend-api/f/conversation/resume';
  const response = await requestText(target, token, sessionHeaders, {
    method: 'POST',
    body: { conversation_id: conversationId, offset },
    route: target,
    headers: {
      accept: 'text/event-stream',
      origin: sessionHeaders?.origin || sessionHeaders?.Origin || 'https://chatgpt.com',
      'x-openai-web-frontend': sessionHeaders?.['x-openai-web-frontend'] || 'core_web',
      ...(conduitToken ? { 'x-conduit-token': conduitToken } : {}),
      ...(turnTraceId ? { 'x-oai-turn-trace-id': turnTraceId } : {})
    },
    retry: false,
    idleTimeoutMs: 60_000,
    onChunk
  });
  if (!response || response.status < 200 || response.status >= 300) {
    const error = new Error(`ChatGPT request failed (${response?.status || 'no-status'}): ${target}`);
    error.status = response?.status || null;
    error.target = target;
    error.body = response?.text || null;
    throw error;
  }
  return {
    conversation_id: conversationId,
    status: response.status,
    content_type: response.contentType || null,
    text: response.text || ''
  };
};

exports.getConversationMessagesPage = async ({
  conversationId, before, numTurns = 10, includeHasVersions = true,
  token, sessionHeaders, requestJson = chatgptClient.requestJson
}) => {
  if (!conversationId) throw new Error('conversationId is required');
  if (!before) throw new Error('before is required');
  const params = new URLSearchParams({
    before: String(before),
    include_has_versions: includeHasVersions ? 'true' : 'false',
    num_turns: String(numTurns)
  });
  const target = `/backend-api/conversations/${encodeURIComponent(conversationId)}/messages?${params}`;
  return requireOk(await requestJson(target, token, sessionHeaders, {
    route: '/backend-api/conversations/{conversation_id}/messages'
  }), target);
};
exports.findConversationMessage = async ({
  conversationId, messageId, numTurns = 10, includeHasVersions = true,
  token, sessionHeaders, requestJson = chatgptClient.requestJson,
  getConversation = exports.getConversation, getMessagesPage = exports.getConversationMessagesPage
}) => {
  if (!conversationId) throw new Error('conversationId is required');
  if (!messageId) throw new Error('messageId is required');
  const current = await getConversation({ conversationId, token, sessionHeaders, requestJson });
  let pagesScanned = 1;
  let nodesScanned = Array.isArray(current?.messages) ? current.messages.length : 0;
  const currentMatch = Array.isArray(current?.messages) ? current.messages.find((item) => item?.id === messageId) : null;
  if (currentMatch) return { found: true, conversation_id: conversationId, message_id: messageId, source: 'current_window', page_info: current?.page_info || null, message: currentMatch, pages_scanned: pagesScanned, nodes_scanned: nodesScanned };
  let pageInfo = current?.page_info || {};
  let before = pageInfo.start_cursor || null;
  let hasPrevious = pageInfo.has_previous_page === true;
  const seen = new Set();
  while (hasPrevious && before) {
    if (seen.has(before)) throw Object.assign(new Error('conversation history cursor stalled'), { code: 'PAGINATION_STALLED' });
    seen.add(before);
    const page = await getMessagesPage({ conversationId, before, numTurns, includeHasVersions, token, sessionHeaders, requestJson });
    pagesScanned += 1;
    const messages = Array.isArray(page?.messages) ? page.messages : [];
    nodesScanned += messages.length;
    const match = messages.find((item) => item?.id === messageId);
    if (match) return { found: true, conversation_id: conversationId, message_id: messageId, source: 'historical_page', before, page_info: page?.page_info || null, message: match, pages_scanned: pagesScanned, nodes_scanned: nodesScanned };
    pageInfo = page?.page_info || {};
    hasPrevious = pageInfo.has_previous_page === true;
    const nextBefore = pageInfo.start_cursor || null;
    if (hasPrevious && (!nextBefore || nextBefore === before)) throw Object.assign(new Error('conversation history cursor stalled'), { code: 'PAGINATION_STALLED' });
    before = nextBefore;
  }
  return { found: false, conversation_id: conversationId, message_id: messageId, source: null, page_info: pageInfo, message: null, pages_scanned: pagesScanned, nodes_scanned: nodesScanned };
};

exports.getConversationHistory = async ({
  conversationId, numTurns = 10, includeHasVersions = true,
  token, sessionHeaders, requestJson = chatgptClient.requestJson,
  getConversation = exports.getConversation, getMessagesPage = exports.getConversationMessagesPage
}) => {
  if (!conversationId) throw new Error('conversationId is required');
  const current = await getConversation({ conversationId, token, sessionHeaders, requestJson });
  const pages = [{ ...current, kind: 'current_window', before: null }];
  let messageCount = Array.isArray(current?.messages) ? current.messages.length : 0;
  let pageInfo = current?.page_info || {};
  let before = pageInfo.start_cursor || null;
  let hasPrevious = pageInfo.has_previous_page === true;
  const seen = new Set();
  while (hasPrevious && before) {
    if (seen.has(before)) throw Object.assign(new Error('conversation history cursor stalled'), { code: 'PAGINATION_STALLED' });
    seen.add(before);
    const page = await getMessagesPage({ conversationId, before, numTurns, includeHasVersions, token, sessionHeaders, requestJson });
    pages.push({ ...page, kind: 'historical_page', before });
    messageCount += Array.isArray(page?.messages) ? page.messages.length : 0;
    pageInfo = page?.page_info || {};
    hasPrevious = pageInfo.has_previous_page === true;
    const nextBefore = pageInfo.start_cursor || null;
    if (hasPrevious && (!nextBefore || nextBefore === before)) throw Object.assign(new Error('conversation history cursor stalled'), { code: 'PAGINATION_STALLED' });
    before = nextBefore;
  }
  return {
    conversation_id: current?.conversation_id || current?.id || conversationId,
    title: current?.title || null,
    project_id: current?.gizmo_id || current?.conversation_template_id || null,
    current_node: current?.current_node || null,
    complete: true,
    direction: 'current_to_older',
    page_count: pages.length,
    message_count: messageCount,
    pages
  };
};

exports.initConversation = async ({
  conversationId,
  projectId = null,
  model = null,
  token,
  sessionHeaders,
  requestJson = chatgptClient.requestJson
}) => {
  if (!conversationId) throw new Error('conversationId is required');
  const target = '/backend-api/conversation/init';
  const body = {
    gizmo_id: projectId || null,
    requested_default_model: model || null,
    conversation_id: conversationId,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
    timezone_offset_min: new Date().getTimezoneOffset(),
    conversation_origin: null
  };
  return requireSuccess(await requestJson(target, token, sessionHeaders, {
    method: 'POST', body, route: target
  }), target);
};

const requireSuccess = (response, target) => {
  if (!response || response.status < 200 || response.status >= 300) {
    const error = new Error(`ChatGPT request failed (${response?.status || 'no-status'}): ${target}`);
    error.status = response?.status || null;
    error.target = target;
    error.retryAfterMs = chatgptClient.parseRetryAfterMs(response?.headers || {});
    if (error.status === 429) error.code = 'RATE_LIMITED';
    throw error;
  }
  return response.json || { success: true };
};

const mutateConversation = async ({ conversationId, body, token, sessionHeaders, requestJson }) => {
  if (!conversationId) throw new Error('conversationId is required');
  const target = `/backend-api/conversation/${encodeURIComponent(conversationId)}`;
  return requireSuccess(await requestJson(target, token, sessionHeaders, {
    method: 'PATCH', body, route: '/backend-api/conversation/{conversation_id}'
  }), target);
};

exports.renameConversation = ({ conversationId, title, token, sessionHeaders, requestJson = chatgptClient.requestJson }) =>
  mutateConversation({ conversationId, body: { title }, token, sessionHeaders, requestJson });

exports.deleteConversation = ({ conversationId, token, sessionHeaders, requestJson = chatgptClient.requestJson }) =>
  mutateConversation({ conversationId, body: { is_visible: false }, token, sessionHeaders, requestJson });

exports.moveConversation = ({ conversationId, projectId, token, sessionHeaders, requestJson = chatgptClient.requestJson }) =>
  mutateConversation({ conversationId, body: { gizmo_id: projectId || null }, token, sessionHeaders, requestJson });

exports.getProject = async ({ projectId, token, sessionHeaders, requestJson = chatgptClient.requestJson }) => {
  if (!projectId) throw new Error('projectId is required');
  const target = `/backend-api/gizmos/${encodeURIComponent(projectId)}`;
  return requireOk(await requestJson(target, token, sessionHeaders, { route: '/backend-api/gizmos/{gizmo_id}' }), target);
};

exports.saveProjectMessage = async ({ projectId, conversationId, messageId, token, sessionHeaders, requestJson = chatgptClient.requestJson }) => {
  if (!projectId) throw new Error('projectId is required');
  if (!conversationId) throw new Error('conversationId is required');
  if (!messageId) throw new Error('messageId is required');
  const target = `/backend-api/projects/${encodeURIComponent(projectId)}/saves`;
  return requireSuccess(await requestJson(target, token, sessionHeaders, {
    method: 'POST',
    body: { conversation_id: conversationId, message_id: messageId },
    route: '/backend-api/projects/{project_id}/saves',
    retry: false
  }), target);
};

exports.createProject = async ({ name, token, sessionHeaders, requestJson = chatgptClient.requestJson }) => {
  const target = '/backend-api/projects';
  return requireSuccess(await requestJson(target, token, sessionHeaders, {
    method: 'POST', body: { name, instructions: '', memory_scope: 'project_v2' }, route: target
  }), target);
};

exports.renameProject = async ({ projectId, name, token, sessionHeaders, requestJson = chatgptClient.requestJson }) => {
  const raw = await exports.getProject({ projectId, token, sessionHeaders, requestJson });
  const g = raw?.gizmo?.gizmo || raw?.gizmo || raw || {};
  const display = g.display || {};
  const target = `/backend-api/projects/${encodeURIComponent(projectId)}`;
  const body = { name, instructions: g.instructions || '', emoji: display.emoji ?? null, theme: display.theme ?? null };
  return requireSuccess(await requestJson(target, token, sessionHeaders, {
    method: 'PATCH', body, route: '/backend-api/projects/{project_id}'
  }), target);
};

exports.deleteProject = async ({ projectId, token, sessionHeaders, requestJson = chatgptClient.requestJson }) => {
  const target = `/backend-api/gizmos/${encodeURIComponent(projectId)}`;
  return requireSuccess(await requestJson(target, token, sessionHeaders, { method: 'DELETE', route: '/backend-api/gizmos/{gizmo_id}' }), target);
};

exports.listConnectors = async ({ token, sessionHeaders, requestJson = chatgptClient.requestJson }) => {
  const target = '/backend-api/ps/plugins/installed?limit=1000';
  const raw = requireOk(await requestJson(target, token, sessionHeaders, {
    route: '/backend-api/ps/plugins/installed',
    headers: { connection: 'close' }
  }), target);
  const plugins = Array.isArray(raw?.plugins) ? raw.plugins : [];
  return plugins.map((plugin) => ({
    id: plugin?.id || null,
    name: plugin?.name || null,
    displayName: plugin?.release?.display_name || plugin?.name || null,
    shortDescription: plugin?.release?.interface?.short_description || plugin?.release?.description || null,
    status: plugin?.status || null,
    enabled: plugin?.enabled ?? null,
    disabledSkillNames: Array.isArray(plugin?.disabled_skill_names) ? plugin.disabled_skill_names : []
  }));
};

exports.resolveSystemHintSelections = async ({ message, token, sessionHeaders, listConnectors = exports.listConnectors }) => {
  const text = String(message || '');
  if (!text.includes('@')) return { systemHints: [], systemHintMentions: [] };
  const connectors = await listConnectors({ token, sessionHeaders });
  const hints = new Set();
  const systemHintMentions = [];
  for (const item of connectors) {
    if (item?.enabled === false || !item?.displayName || !item?.id?.startsWith('plugin_')) continue;
    const mentionText = '@' + item.displayName;
    const hint = 'plugin:' + item.id.slice('plugin_'.length);
    let startIndex = text.indexOf(mentionText);
    while (startIndex >= 0) { hints.add(hint); systemHintMentions.push({ id: hint, startIndex, endIndex: startIndex + mentionText.length }); startIndex = text.indexOf(mentionText, startIndex + mentionText.length); }
  }
  return { systemHints: [...hints], systemHintMentions };
};

const sentinelHeaderNames = [
  'openai-sentinel-chat-requirements-token',
  'openai-sentinel-proof-token',
  'openai-sentinel-turnstile-token'
];

const takeSentinelHeaders = (headers = {}) => Object.fromEntries(
  sentinelHeaderNames
    .filter((name) => typeof headers[name] === 'string' && headers[name])
    .map((name) => [name, headers[name]])
);

const observationFromUpdate = (value, phase = 'r') => {
  const parts = String(value || '').split('.');
  return parts[0] === 'ois1' && parts[2] ? `v1.${phase}.p.${parts[2]}` : null;
};

const applyIntegrityUpdate = (headers, responseHeaders, phase = 'r') => {
  const observation = observationFromUpdate(responseHeaders?.['x-oai-is-update'], phase);
  if (observation) headers['x-oai-is-client-observation'] = observation;
  return observation;
};

const streamObservation = (value) => String(value || '').replace(/^v1\.[rs]\.p\./, 'v1.s.p.');

const createUserMessage = (text, id = crypto.randomUUID(), metadata = {}) => ({
  id,
  author: { role: 'user' },
  create_time: Date.now() / 1000,
  content: { content_type: 'text', parts: [String(text)] },
  metadata: {
    selected_sources: [],
    serialization_metadata: { custom_symbol_offsets: [] },
    submission_mode: 'manual_send',
    ...metadata
  }
});

// targeted_reply (quote chip ของเว็บ): user message แปะ metadata + hidden system message ตามหลัง
// spec จากซอร์สเว็บ (Hzi/_Pi) + capture จริง — label ตัดยาวสุด 80 ตัวอักษร
const targetedReplyLabel = (text) => {
  const trimmed = String(text).trim();
  return trimmed.length <= 80 ? trimmed : `${trimmed.slice(0, 77).trimEnd()}...`;
};

const targetedReplyMetadata = (targetedReply) => {
  if (!targetedReply || !targetedReply.text) return {};
  return {
    targeted_reply: String(targetedReply.text),
    targeted_reply_label: targetedReply.label || targetedReplyLabel(targetedReply.text),
    ...(targetedReply.sourceMessageId ? { targeted_reply_source_message_id: targetedReply.sourceMessageId } : {}),
    ...(targetedReply.sourceRange ? { targeted_reply_source_range: targetedReply.sourceRange } : {})
  };
};

const createHiddenSystemMessage = (text) => ({
  id: crypto.randomUUID(),
  author: { role: 'system' },
  content: { content_type: 'text', parts: [String(text)] },
  metadata: { exclude_after_next_user_message: true, is_visually_hidden_from_conversation: true }
});

const createHiddenTargetedReplyMessage = (text) =>
  createHiddenSystemMessage(`The user is referring to this in particular:\n${String(text)}`);

const systemHintMetadata = (systemHints = [], mentions = []) => ({
  ...(systemHints.length ? { system_hints: systemHints } : {}),
  ...(mentions.length ? { serialization_metadata: { custom_symbol_offsets: mentions.map(({ id, startIndex, endIndex }) => ({ id, symbol: 'ecosystemMention', startIndex, endIndex })) } } : {})
});

const conversationMode = (projectId) => projectId
  ? { kind: 'gizmo_interaction', gizmo_id: projectId }
  : { kind: 'primary_assistant' };

const extractConversationId = (text) => {
  for (const line of String(text || '').split(/\r?\n/)) {
    const raw = line.startsWith('data:') ? line.slice(5).trim() : line.trim();
    if (!raw || raw === '[DONE]') continue;
    try {
      const payload = JSON.parse(raw);
      const id = payload?.conversation_id || payload?.conversation?.id;
      if (typeof id === 'string' && id) return id;
    } catch {}
  }
  return null;
};

const createStreamProgress = () => {
  let pending = '';
  let conversationId = null;
  let resumeToken = null;
  let completed = false;
  let sawChunk = false;
  const acceptLine = (line) => {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (data === '[DONE]') {
      completed = true;
      return;
    }
    let event;
    try { event = JSON.parse(data); } catch { return; }
    const id = event?.conversation_id || event?.v?.conversation_id;
    if (typeof id === 'string' && id) conversationId = id;
    if (event?.type === 'resume_conversation_token' && typeof event.token === 'string' && event.token) {
      resumeToken = event.token;
    }
  };
  return {
    push(chunk) {
      sawChunk = true;
      pending += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk || '');
      const lines = pending.split(/\r?\n/);
      pending = lines.pop();
      for (const line of lines) acceptLine(line);
    },
    get conversationId() { return conversationId; },
    get resumeToken() { return resumeToken; },
    get completed() { return completed; },
    get sawChunk() { return sawChunk; }
  };
};

const sendWithRecovery = async ({
  target, options, conversationId = null, conduitToken, turnTraceId,
  token, sessionHeaders, requestText
}) => {
  const progress = createStreamProgress();
  let response = null;
  let upstreamError = null;
  try {
    response = await requestText(target, token, sessionHeaders, {
      ...options,
      retry: false,
      idleTimeoutMs: 60_000,
      onChunk: (chunk) => {
        progress.push(chunk);
        if (typeof options.onChunk === 'function') options.onChunk(chunk);
      }
    });
  } catch (error) {
    upstreamError = error;
  }
  if (response && (response.status < 200 || response.status >= 300)) requireSuccess(response, target);
  if (response?.text && !progress.sawChunk) progress.push(response.text);
  const observedId = progress.conversationId || conversationId;
  if (progress.completed) return { response: response || { status: 200, text: '' }, conversationId: observedId };
  if (!observedId) {
    if (upstreamError) throw upstreamError;
    const error = new Error('conversation stream ended before conversation_id was available');
    error.code = 'STREAM_INCOMPLETE';
    throw error;
  }
  const resumedProgress = createStreamProgress();
  const resumed = await exports.resumeConversation({
    conversationId: observedId,
    offset: 0,
    conduitToken: progress.resumeToken || conduitToken,
    turnTraceId,
    token,
    sessionHeaders,
    requestText,
    onChunk: (chunk) => {
      resumedProgress.push(chunk);
      if (typeof options.onChunk === 'function') options.onChunk(chunk);
    }
  });
  if (resumed.text && !resumedProgress.sawChunk) resumedProgress.push(resumed.text);
  if (!resumedProgress.completed) {
    const error = new Error('resumed conversation stream ended before [DONE]');
    error.code = 'STREAM_INCOMPLETE';
    throw error;
  }
  return { response: response || { status: 200, text: '' }, conversationId: observedId };
};
// ค่าสูงสุดตามเว็บจริง (capture OSSGPT: model + thinking_effort ที่เว็บส่ง)
const DEFAULT_MODEL = 'gpt-5-6-thinking';
const DEFAULT_THINKING_EFFORT = 'extended';
const DEFAULT_MODEL_RESPONSE_CONTRACTS = Object.freeze([{
  id: 'photo_upload_action.v1',
  protocol_version: 1,
  presets: ['cap:image', 'cap:file', 'placement:end']
}]);

const resolveWebProtocolContext = ({ timezone = null, timezoneOffsetMin = null, modelResponseContracts = null, clientContextualInfo = null } = {}) => ({
  timezone: timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || null,
  timezone_offset_min: Number.isFinite(timezoneOffsetMin) ? timezoneOffsetMin : new Date().getTimezoneOffset(),
  model_response_contracts: Array.isArray(modelResponseContracts) ? modelResponseContracts : DEFAULT_MODEL_RESPONSE_CONTRACTS,
  client_contextual_info: clientContextualInfo && typeof clientContextualInfo === 'object'
    ? { ...clientContextualInfo }
    : { app_name: 'chatgpt.com' }
});

const newConversationPrepareBody = ({
  projectId = null,
  model = DEFAULT_MODEL,
  thinkingEffort = DEFAULT_THINKING_EFFORT,
  systemHints = [],
  localFunctionNames = null,
  timezone = null,
  timezoneOffsetMin = null,
  modelResponseContracts = null,
  clientContextualInfo = null,
  includeForkFromSharedPost = false
}) => ({
  action: 'next',
  ...(includeForkFromSharedPost ? { fork_from_shared_post: false } : {}),
  parent_message_id: 'client-created-root',
  model,
  thinking_effort: thinkingEffort,
  client_prepare_state: 'none',
  conversation_mode: conversationMode(projectId),
  system_hints: systemHints,
  supports_buffering: true,
  supported_encodings: ['v1'],
  ...resolveWebProtocolContext({ timezone, timezoneOffsetMin, modelResponseContracts, clientContextualInfo }),
  ...(Array.isArray(localFunctionNames) && localFunctionNames.length ? { local_function_names: [...localFunctionNames] } : {}),
  client_prepare_dispatch: 'debounced',
  client_prepare_source: 'window_focus'
});

const newConversationSendBody = ({
  message,
  projectId = null,
  model = DEFAULT_MODEL,
  thinkingEffort = DEFAULT_THINKING_EFFORT,
  systemHints = [],
  systemHintMentions = [],
  targetedReply = null,
  hiddenSystemMessages = [],
  hideUserMessage = false,
  timezone = null,
  timezoneOffsetMin = null,
  modelResponseContracts = null,
  clientContextualInfo = null,
  localFunctionNames = null,
  enableMessageFollowups = true,
  historyAndTrainingDisabled = false,
  forceUseSse = null,
  forceUseSearch = null,
  forceParagen = false,
  isOnboardingConversation = false,
  stream = null,
  serviceTier = null,
  forceParallelSwitch = 'auto',
  paragenCotSummaryDisplayOverride = 'allow',
  includeForkFromSharedPost = false
}) => ({
  action: 'next',
  ...(includeForkFromSharedPost ? { fork_from_shared_post: false } : {}),
  ...(historyAndTrainingDisabled === true ? { history_and_training_disabled: true } : {}),
  parent_message_id: 'client-created-root',
  model,
  thinking_effort: thinkingEffort,
  client_prepare_state: 'success',
  conversation_mode: conversationMode(projectId),
  enable_message_followups: enableMessageFollowups,
  ...(forceUseSse != null ? { force_use_sse: forceUseSse } : {}),
  ...(forceUseSearch != null ? { force_use_search: forceUseSearch } : {}),
  ...(forceParagen === true ? { force_paragen: true } : {}),
  system_hints: systemHints,
  ...(isOnboardingConversation === true ? { is_onboarding_conversation: true } : {}),
  supports_buffering: true,
  supported_encodings: ['v1'],
  ...resolveWebProtocolContext({ timezone, timezoneOffsetMin, modelResponseContracts, clientContextualInfo }),
  ...(Array.isArray(localFunctionNames) && localFunctionNames.length ? { local_function_names: [...localFunctionNames] } : {}),
  ...(serviceTier ? { service_tier: serviceTier } : {}),
  ...(forceParallelSwitch ? { force_parallel_switch: forceParallelSwitch } : {}),
  ...(paragenCotSummaryDisplayOverride ? { paragen_cot_summary_display_override: paragenCotSummaryDisplayOverride } : {}),
  ...(stream != null ? { stream } : {}),
  messages: [
    createUserMessage(message, undefined, {
      ...(projectId ? { gizmo_id: projectId } : {}),
      ...(serviceTier ? { service_tier: serviceTier } : {}),
      ...systemHintMetadata(systemHints, systemHintMentions),
      ...targetedReplyMetadata(targetedReply),
      ...(hideUserMessage ? {
        exclude_after_next_user_message: true,
        is_visually_hidden_from_conversation: true
      } : {})
    }),
    ...(Array.isArray(hiddenSystemMessages)
      ? hiddenSystemMessages
        .filter((text) => typeof text === 'string' && text.trim())
        .map((text) => createHiddenSystemMessage(text))
      : []),
    ...(targetedReply?.text ? [createHiddenTargetedReplyMessage(targetedReply.text)] : [])
  ]
});

exports.createConversation = async ({
  message,
  projectId = null,
  model = DEFAULT_MODEL,
  thinkingEffort = DEFAULT_THINKING_EFFORT,
  systemHints = null,
  systemHintMentions = null,
  targetedReply = null,
  hiddenSystemMessages = [],
  hideUserMessage = false,
  localFunctionNames = null,
  timezone = null,
  timezoneOffsetMin = null,
  modelResponseContracts = null,
  clientContextualInfo = null,
  enableMessageFollowups = true,
  forceParallelSwitch = 'auto',
  paragenCotSummaryDisplayOverride = 'allow',
  onChunk = null,
  recoverStream = false,
  token,
  sessionHeaders,
  listConnectors = exports.listConnectors,
  requestJson = chatgptClient.requestJson,
  requestText = chatgptClient.requestText
}) => {
  if (!message) throw new Error('message is required');
  if (!Array.isArray(systemHints) && !Array.isArray(systemHintMentions)) ({ systemHints, systemHintMentions } = await exports.resolveSystemHintSelections({ message, token, sessionHeaders, listConnectors }));
  systemHints = Array.isArray(systemHints) ? systemHints : [];
  systemHintMentions = Array.isArray(systemHintMentions) ? systemHintMentions : [];
  const traceId = crypto.randomUUID();
  const prepareTarget = '/backend-api/f/conversation/prepare';
  const prepareResponse = await requestJson(prepareTarget, token, sessionHeaders, {
    method: 'POST',
    body: newConversationPrepareBody({ projectId, model, thinkingEffort, systemHints, localFunctionNames, timezone, timezoneOffsetMin, modelResponseContracts, clientContextualInfo }),
    route: prepareTarget,
    headers: { 'x-oai-turn-trace-id': traceId }
  });
  if (!prepareResponse || prepareResponse.status < 200 || prepareResponse.status >= 300) {
    requireSuccess(prepareResponse, prepareTarget);
  }
  const conduitToken = prepareResponse?.json?.conduit_token
    || prepareResponse?.headers?.['x-conduit-token'];
  if (!conduitToken) throw new Error('conversation prepare response missing conduit token');
  let sentinelHeaders = takeSentinelHeaders(sessionHeaders || {});
  try {
    const fresh = await sentinel.fetchChatRequirements({ token, sessionHeaders: sessionHeaders || {}, requestJson });
    if (fresh?.token) sentinelHeaders = { ...sentinelHeaders, 'openai-sentinel-chat-requirements-token': fresh.token };
    if (fresh?.proofToken) sentinelHeaders = { ...sentinelHeaders, 'openai-sentinel-proof-token': fresh.proofToken };
  } catch {
    // fallback: ใช้ sentinel headers จาก session เดิมถ้า fetch สดไม่สำเร็จ
  }
  const sendTarget = '/backend-api/f/conversation';
  const sendOptions = {
    method: 'POST',
    body: newConversationSendBody({ message, projectId, model, thinkingEffort, systemHints, systemHintMentions, targetedReply, hiddenSystemMessages, hideUserMessage, timezone, timezoneOffsetMin, modelResponseContracts, clientContextualInfo, localFunctionNames, enableMessageFollowups, forceParallelSwitch, paragenCotSummaryDisplayOverride }),
    route: sendTarget,
    headers: {
      ...sentinelHeaders,
      'x-conduit-token': conduitToken,
      'x-oai-turn-trace-id': traceId,
      accept: 'text/event-stream'
    },
    onChunk
  };
  const sent = recoverStream
    ? await sendWithRecovery({
      target: sendTarget, options: sendOptions, conduitToken, turnTraceId: traceId,
      token, sessionHeaders, requestText
    })
    : { response: await requestText(sendTarget, token, sessionHeaders, sendOptions) };
  const sendResponse = sent.response;
  if (!sendResponse || sendResponse.status < 200 || sendResponse.status >= 300) {
    requireSuccess(sendResponse, sendTarget);
  }
  const conversationId = sent.conversationId || extractConversationId(sendResponse.text);
  if (!conversationId) throw new Error('conversation response missing conversation_id');
  const conversation = await exports.getConversation({ conversationId, token, sessionHeaders, requestJson });
  try {
    conversation.init = await exports.initConversation({ conversationId, projectId, model: model === 'auto' ? null : model, token, sessionHeaders, requestJson });
  } catch (initError) {
    conversation.init_error = initError.message || String(initError);
  }
  return conversation;
};

const sendConversationDirect = async ({
  conversationId,
  message,
  model = DEFAULT_MODEL,
  thinkingEffort = DEFAULT_THINKING_EFFORT,
  systemHints = null,
  systemHintMentions = null,
  targetedReply = null,
  hiddenSystemMessages = [],
  hideUserMessage = false,
  localFunctionNames = null,
  timezone = null,
  timezoneOffsetMin = null,
  modelResponseContracts = null,
  clientContextualInfo = null,
  enableMessageFollowups = true,
  forceParallelSwitch = 'auto',
  paragenCotSummaryDisplayOverride = 'allow',
  onChunk = null,
  recoverStream = false,
  token,
  sessionHeaders,
  listConnectors = exports.listConnectors,
  requestJson = chatgptClient.requestJson,
  requestText = chatgptClient.requestText
}) => {
  if (!conversationId) throw new Error('conversationId is required');
  if (!message) throw new Error('message is required');
  if (!Array.isArray(systemHints) && !Array.isArray(systemHintMentions)) ({ systemHints, systemHintMentions } = await exports.resolveSystemHintSelections({ message, token, sessionHeaders, listConnectors }));
  systemHints = Array.isArray(systemHints) ? systemHints : [];
  systemHintMentions = Array.isArray(systemHintMentions) ? systemHintMentions : [];
  const before = await exports.getConversation({ conversationId, token, sessionHeaders, requestJson });
  const parentMessageId = before.current_node;
  if (!parentMessageId) throw new Error('conversation current_node is required');
  const projectId = before.gizmo_id || null;
  let sentinelHeaders = takeSentinelHeaders(sessionHeaders);
  try {
    const fresh = await sentinel.fetchChatRequirements({ token, sessionHeaders, requestJson });
    if (fresh?.token) sentinelHeaders = { ...sentinelHeaders, 'openai-sentinel-chat-requirements-token': fresh.token };
    if (fresh?.proofToken) sentinelHeaders = { ...sentinelHeaders, 'openai-sentinel-proof-token': fresh.proofToken };
  } catch {
    // fallback: ใช้ sentinel headers จาก session เดิมถ้า fetch สดไม่สำเร็จ
  }
  const turnHeaders = { ...sessionHeaders };
  for (const name of sentinelHeaderNames) delete turnHeaders[name];
  const traceId = crypto.randomUUID();
  const prepareTarget = '/backend-api/f/conversation/prepare';
  const prepareBody = {
    ...newConversationPrepareBody({ projectId, model, thinkingEffort, systemHints, localFunctionNames, timezone, timezoneOffsetMin, modelResponseContracts, clientContextualInfo, includeForkFromSharedPost: false }),
    conversation_id: conversationId,
    parent_message_id: parentMessageId,
    client_prepare_dispatch: 'immediate',
    client_prepare_source: 'context_change'
  };
  const prepareResponse = await requestJson(prepareTarget, token, turnHeaders, {
    method: 'POST', body: prepareBody, route: prepareTarget,
    headers: { 'x-oai-turn-trace-id': traceId }
  });
  if (!prepareResponse || prepareResponse.status < 200 || prepareResponse.status >= 300) requireSuccess(prepareResponse, prepareTarget);
  applyIntegrityUpdate(turnHeaders, prepareResponse.headers, 'r');
  let conduitToken = prepareResponse?.json?.conduit_token || prepareResponse?.headers?.['x-conduit-token'];
  if (!conduitToken) throw new Error('conversation prepare response missing conduit token');
  const preparedBody = {
    ...prepareBody,
    client_prepare_state: 'success',
    client_prepare_dispatch: 'debounced',
    client_prepare_source: 'composer_editor_state'
  };
  const preparedResponse = await requestJson(prepareTarget, token, turnHeaders, {
    method: 'POST', body: preparedBody, route: prepareTarget,
    headers: {
      'x-conduit-token': conduitToken,
      'x-oai-turn-trace-id': traceId,
      'x-oai-is-client-observation': turnHeaders['x-oai-is-client-observation']
    }
  });
  if (!preparedResponse || preparedResponse.status < 200 || preparedResponse.status >= 300) requireSuccess(preparedResponse, prepareTarget);
  applyIntegrityUpdate(turnHeaders, preparedResponse.headers, 'r');
  conduitToken = preparedResponse?.headers?.['x-conduit-token'] || conduitToken;
  const sendTarget = '/backend-api/f/conversation';
  const sendBody = {
    ...newConversationSendBody({ message, projectId, model, thinkingEffort, systemHints, systemHintMentions, targetedReply, hiddenSystemMessages, hideUserMessage, timezone, timezoneOffsetMin, modelResponseContracts, clientContextualInfo, localFunctionNames, enableMessageFollowups, forceParallelSwitch, paragenCotSummaryDisplayOverride }),
    conversation_id: conversationId,
    parent_message_id: parentMessageId
  };
  const sendOptions = {
    method: 'POST', body: sendBody, route: sendTarget,
    headers: {
      ...sentinelHeaders,
      'x-conduit-token': conduitToken,
      'x-oai-turn-trace-id': traceId,
      'x-oai-is-client-observation': streamObservation(turnHeaders['x-oai-is-client-observation']),
      accept: 'text/event-stream'
    },
    onChunk
  };
  const sent = recoverStream
    ? await sendWithRecovery({
      target: sendTarget, options: sendOptions, conversationId, conduitToken, turnTraceId: traceId,
      token, sessionHeaders: turnHeaders, requestText
    })
    : { response: await requestText(sendTarget, token, turnHeaders, sendOptions) };
  const sendResponse = sent.response;
  if (!sendResponse || sendResponse.status < 200 || sendResponse.status >= 300) requireSuccess(sendResponse, sendTarget);
  const after = await exports.getConversation({ conversationId, token, sessionHeaders, requestJson });
  // previous_node = current_node ก่อนส่ง (baseline สำหรับเช็คว่าห้องมีข้อความใหม่หลัง dispatch หรือยัง)
  // กันเคส current_node หลังส่งชนกับ reply ของ worker แล้ว agent check มองไม่เห็นผล
  if (after && typeof after === 'object') after.previous_node = parentMessageId;
  return after;
};exports.sendConversation = async ({
  conversationId,
  message,
  transport = 'direct',
  waitForFinal = false,
  browserSend = browserBridge.send,
  ...direct
}) => {
  if (transport === 'direct') {
    return sendConversationDirect({ conversationId, message, ...direct });
  }
  const result = await browserSend({ conversationId, message, waitForFinal, ...(direct.sessionHeaders ? { sessionHeaders: direct.sessionHeaders } : {}), ...(direct.token ? { token: direct.token } : {}) });
  if (!result?.success) {
    const error = new Error(result?.status || 'browser send failed');
    error.code = result?.status || 'BRIDGE_UNAVAILABLE';
    throw error;
  }
  return {
    conversation_id: result.conversationId || conversationId,
    current_node: result.currentNode || null,
    previous_node: result.previousNode || null
  };
};
