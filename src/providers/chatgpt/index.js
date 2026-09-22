// internal provider: ห่อ zero-chatgpt เดิมให้เรียกผ่าน tools hub ได้
const conversations = require('./conversations');
const orchestrator = require('./agents/orchestrator');

const textArg = (description) => ({ type: 'string', ...(description ? { description } : {}) });
const stringArrayArg = (description) => ({ type: 'array', items: { type: 'string' }, ...(description ? { description } : {}) });
const objectArg = (description) => ({ type: 'object', additionalProperties: true, ...(description ? { description } : {}) });
const objectArrayArg = (description) => ({ type: 'array', items: { type: 'object', additionalProperties: true }, ...(description ? { description } : {}) });
const toolSchema = (properties = {}, required = []) => ({
  type: 'object', properties, required, additionalProperties: false
});

const tools = {
  conversations_list: {
    description: 'ลิสต์ conversation หนึ่ง global page (default limit 50) แล้วจัดกลุ่มตาม project; คืน nextOffset ถ้ามีหน้าถัดไป',
    inputSchema: toolSchema(),
    run: (args, ctx) => conversations.listAll({ token: ctx.token, sessionHeaders: ctx.sessionHeaders })
  },
  global_search: {
    description: 'ค้น ChatGPT global search (conversation/project/library ตาม source ที่ระบุ)',
    inputSchema: toolSchema({ query: textArg('Search query'), cursor: textArg('Pagination cursor'), limit: { type: 'integer', minimum: 1 }, source: textArg('Search source; default conversation') }, ['query']),
    run: (args, ctx) => conversations.searchGlobal({ query: args.query, cursor: args.cursor || null, limit: args.limit ?? 20, source: args.source || 'conversation', token: ctx.token, sessionHeaders: ctx.sessionHeaders })
  },
  conversation_get: {
    description: 'อ่านห้องเดียว (metadata + messages)',
    inputSchema: toolSchema({ conversation_id: textArg('Conversation UUID') }, ['conversation_id']),
    run: (args, ctx) => {
      if (!args.conversation_id) throw Object.assign(new Error('ต้องระบุ conversation_id'), { code: 'BAD_ARGS' });
      return conversations.getConversation({
        conversationId: args.conversation_id,
        token: ctx.token,
        sessionHeaders: ctx.sessionHeaders
      });
    }
  },
  conversation_stream_status: {
    description: 'อ่านสถานะ stream ปัจจุบันของ conversation จาก ChatGPT Web backend',
    inputSchema: toolSchema({ conversation_id: textArg('Conversation UUID') }, ['conversation_id']),
    run: (args, ctx) => conversations.getConversationStreamStatus({
      conversationId: args.conversation_id,
      token: ctx.token,
      sessionHeaders: ctx.sessionHeaders
    })
  },
  conversation_resume: {
    description: 'ขอ resume completion stream ของ conversation เดิมผ่าน ChatGPT Web backend',
    inputSchema: toolSchema({ conversation_id: textArg('Conversation UUID') }, ['conversation_id']),
    run: (args, ctx) => conversations.resumeConversation({
      conversationId: args.conversation_id,
      token: ctx.token,
      sessionHeaders: ctx.sessionHeaders
    })
  },
  conversation_messages: {
    description: 'อ่าน historical messages หนึ่งหน้าก่อน cursor ที่ระบุ',
    inputSchema: toolSchema({ conversation_id: textArg('Conversation UUID'), before: textArg('History cursor'), num_turns: { type: 'integer', minimum: 1 }, include_has_versions: { type: 'boolean' } }, ['conversation_id', 'before']),
    run: (args, ctx) => conversations.getConversationMessagesPage({ conversationId: args.conversation_id, before: args.before, numTurns: args.num_turns ?? 10, includeHasVersions: args.include_has_versions !== false, token: ctx.token, sessionHeaders: ctx.sessionHeaders })
  },
  conversation_message_get: {
    description: 'ค้น message ตาม conversation_id + message_id โดยไล่ history ย้อนหลังจริง',
    inputSchema: toolSchema({ conversation_id: textArg('Conversation UUID'), message_id: textArg('Message UUID'), num_turns: { type: 'integer', minimum: 1 }, include_has_versions: { type: 'boolean' } }, ['conversation_id', 'message_id']),
    run: (args, ctx) => conversations.findConversationMessage({ conversationId: args.conversation_id, messageId: args.message_id, numTurns: args.num_turns ?? 10, includeHasVersions: args.include_has_versions !== false, token: ctx.token, sessionHeaders: ctx.sessionHeaders })
  },
  conversation_all: {
    description: 'อ่าน conversation ครบทุก historical page แบบ raw page boundaries',
    inputSchema: toolSchema({ conversation_id: textArg('Conversation UUID'), num_turns: { type: 'integer', minimum: 1 }, include_has_versions: { type: 'boolean' } }, ['conversation_id']),
    run: (args, ctx) => conversations.getConversationHistory({ conversationId: args.conversation_id, numTurns: args.num_turns ?? 10, includeHasVersions: args.include_has_versions !== false, token: ctx.token, sessionHeaders: ctx.sessionHeaders })
  },
  conversation_init: {
    description: 'อ่าน init metadata ห้อง (default model + limits ตามเว็บจริง)',
    inputSchema: toolSchema({ conversation_id: textArg('Conversation UUID'), project_id: textArg('Project ID'), model: textArg('Model slug') }, ['conversation_id']),
    run: (args, ctx) => {
      if (!args.conversation_id) throw Object.assign(new Error('ต้องระบุ conversation_id'), { code: 'BAD_ARGS' });
      return conversations.initConversation({
        conversationId: args.conversation_id,
        projectId: args.project_id || null,
        model: args.model || null,
        token: ctx.token,
        sessionHeaders: ctx.sessionHeaders
      });
    }
  },
  conversation_new: {
    description: 'สร้างห้องใหม่พร้อมข้อความแรก (project_id ไม่ใส่ = นอก project, model ไม่ใส่ = gpt-5-6-thinking + thinking_effort=extended สูงสุดตามเว็บ)',
    inputSchema: toolSchema({ message: textArg('ข้อความแรก'), project_id: textArg('Project ID'), model: textArg('Model slug'), thinking_effort: textArg('Thinking effort'), system_hints: stringArrayArg('ChatGPT Web system_hints'), system_hint_mentions: objectArrayArg('Structured mentions for system_hints'), local_function_names: stringArrayArg('Client local function names; ไม่มีค่า default ของ Work'), timezone: textArg('IANA timezone เช่น Asia/Bangkok'), timezone_offset_min: { type: 'integer' }, enable_message_followups: { type: 'boolean' }, client_contextual_info: objectArg('ChatGPT Web client_contextual_info passthrough'), model_response_contracts: objectArrayArg('ChatGPT Web model_response_contracts passthrough'), force_parallel_switch: textArg('ChatGPT Web force_parallel_switch passthrough'), paragen_cot_summary_display_override: textArg('ChatGPT Web paragen COT summary display override passthrough') }, ['message']),
    run: (args, ctx) => conversations.createConversation({
      message: args.message,
      projectId: args.project_id || null,
      model: args.model,
      thinkingEffort: args.thinking_effort,
      systemHints: args.system_hints,
      systemHintMentions: args.system_hint_mentions,
      localFunctionNames: args.local_function_names,
      timezone: args.timezone,
      timezoneOffsetMin: args.timezone_offset_min,
      enableMessageFollowups: args.enable_message_followups,
      clientContextualInfo: args.client_contextual_info,
      modelResponseContracts: args.model_response_contracts,
      forceParallelSwitch: args.force_parallel_switch,
      paragenCotSummaryDisplayOverride: args.paragen_cot_summary_display_override,
      token: ctx.token,
      sessionHeaders: ctx.sessionHeaders
    })
  },
  conversation_send: {
    description: 'ส่งข้อความต่อในห้องเดิม; direct รอ response stream จบและ fetch state หลังส่งก่อนคืน; browser รอ submission acknowledgement ไม่รอ final assistant',
    inputSchema: toolSchema({ conversation_id: textArg('Conversation UUID'), message: textArg('ข้อความที่จะส่ง'), model: textArg('Model slug'), thinking_effort: textArg('Thinking effort'), transport: { type: 'string', enum: ['direct', 'browser'] }, system_hints: stringArrayArg('ChatGPT Web system_hints'), system_hint_mentions: objectArrayArg('Structured mentions for system_hints'), local_function_names: stringArrayArg('Client local function names; ไม่มีค่า default ของ Work'), timezone: textArg('IANA timezone เช่น Asia/Bangkok'), timezone_offset_min: { type: 'integer' }, enable_message_followups: { type: 'boolean' }, client_contextual_info: objectArg('ChatGPT Web client_contextual_info passthrough'), model_response_contracts: objectArrayArg('ChatGPT Web model_response_contracts passthrough'), force_parallel_switch: textArg('ChatGPT Web force_parallel_switch passthrough'), paragen_cot_summary_display_override: textArg('ChatGPT Web paragen COT summary display override passthrough'), targeted_reply_text: textArg('Quoted text'), targeted_reply_source_message_id: textArg('Source message UUID'), targeted_reply_start: { type: 'integer', minimum: 0 }, targeted_reply_end: { type: 'integer', minimum: 0 } }, ['conversation_id', 'message']),
    run: (args, ctx) => {
      const targetedValues = [args.targeted_reply_text, args.targeted_reply_source_message_id, args.targeted_reply_start, args.targeted_reply_end];
      const hasTargetedReply = targetedValues.some((value) => value !== undefined && value !== null && value !== '');
      let targetedReply = null;
      if (hasTargetedReply) {
        const valid = typeof args.targeted_reply_text === 'string' && args.targeted_reply_text.length > 0
          && typeof args.targeted_reply_source_message_id === 'string' && args.targeted_reply_source_message_id.length > 0
          && Number.isInteger(args.targeted_reply_start) && args.targeted_reply_start >= 0
          && Number.isInteger(args.targeted_reply_end) && args.targeted_reply_end >= args.targeted_reply_start;
        if (!valid) throw Object.assign(new Error('targeted reply ต้องระบุ text, source_message_id, start, end ให้ครบและ range ต้องถูกต้อง'), { code: 'BAD_ARGS' });
        targetedReply = {
          text: args.targeted_reply_text,
          sourceMessageId: args.targeted_reply_source_message_id,
          sourceRange: { start: args.targeted_reply_start, end: args.targeted_reply_end }
        };
      }
      return conversations.sendConversation({
        conversationId: args.conversation_id,
        message: args.message,
        model: args.model,
        thinkingEffort: args.thinking_effort,
        systemHints: args.system_hints,
        systemHintMentions: args.system_hint_mentions,
        localFunctionNames: args.local_function_names,
        timezone: args.timezone,
        timezoneOffsetMin: args.timezone_offset_min,
        enableMessageFollowups: args.enable_message_followups,
        clientContextualInfo: args.client_contextual_info,
        modelResponseContracts: args.model_response_contracts,
        forceParallelSwitch: args.force_parallel_switch,
        paragenCotSummaryDisplayOverride: args.paragen_cot_summary_display_override,
        transport: args.transport === 'browser' ? 'browser' : 'direct',
        targetedReply,
        token: ctx.token,
        sessionHeaders: ctx.sessionHeaders
      });
    }
  },
  conversation_rename: {
    description: 'เปลี่ยนชื่อ conversation',
    inputSchema: toolSchema({ conversation_id: textArg('Conversation UUID'), title: textArg('New title') }, ['conversation_id', 'title']),
    run: (args, ctx) => conversations.renameConversation({
      conversationId: args.conversation_id, title: args.title,
      token: ctx.token, sessionHeaders: ctx.sessionHeaders
    })
  },
  conversation_delete: {
    description: 'ลบ/ซ่อน conversation',
    inputSchema: toolSchema({ conversation_id: textArg('Conversation UUID') }, ['conversation_id']),
    run: (args, ctx) => conversations.deleteConversation({
      conversationId: args.conversation_id, token: ctx.token, sessionHeaders: ctx.sessionHeaders
    })
  },
  conversation_move: {
    description: 'ย้าย conversation เข้า/ออก project',
    inputSchema: toolSchema({ conversation_id: textArg('Conversation UUID'), project_id: textArg('Project ID; omit/null = outside project') }, ['conversation_id']),
    run: (args, ctx) => conversations.moveConversation({
      conversationId: args.conversation_id, projectId: args.project_id || null,
      token: ctx.token, sessionHeaders: ctx.sessionHeaders
    })
  },
  project_create: {
    description: 'สร้าง project ใหม่',
    inputSchema: toolSchema({ name: textArg('Project name') }, ['name']),
    run: (args, ctx) => conversations.createProject({
      name: args.name, token: ctx.token, sessionHeaders: ctx.sessionHeaders
    })
  },
  project_rename: {
    description: 'เปลี่ยนชื่อ project',
    inputSchema: toolSchema({ project_id: textArg('Project ID'), name: textArg('New project name') }, ['project_id', 'name']),
    run: (args, ctx) => conversations.renameProject({
      projectId: args.project_id, name: args.name,
      token: ctx.token, sessionHeaders: ctx.sessionHeaders
    })
  },
  project_delete: {
    description: 'ลบ project',
    inputSchema: toolSchema({ project_id: textArg('Project ID') }, ['project_id']),
    run: (args, ctx) => conversations.deleteProject({
      projectId: args.project_id, token: ctx.token, sessionHeaders: ctx.sessionHeaders
    })
  },
  project_save: {
    description: 'บันทึก message จาก conversation ลง Project saves',
    inputSchema: toolSchema({ project_id: textArg('Project ID'), conversation_id: textArg('Conversation UUID'), message_id: textArg('Message UUID') }, ['project_id', 'conversation_id', 'message_id']),
    run: (args, ctx) => {
      if (!args.project_id || !args.conversation_id || !args.message_id) {
        throw Object.assign(new Error('ต้องระบุ project_id, conversation_id, message_id'), { code: 'BAD_ARGS' });
      }
      return conversations.saveProjectMessage({
        projectId: args.project_id,
        conversationId: args.conversation_id,
        messageId: args.message_id,
        token: ctx.token,
        sessionHeaders: ctx.sessionHeaders
      });
    }
  },
  project_conversations: {
    description: 'ลิสต์ห้องใน project',
    inputSchema: toolSchema({ project_id: textArg('Project ID') }, ['project_id']),
    run: (args, ctx) => conversations.listProjectConversationPage({
      projectId: args.project_id,
      token: ctx.token,
      sessionHeaders: ctx.sessionHeaders
    })
  },
  connectors_list: {
    description: 'ลิสต์ connector/plugin ที่ติดตั้งใน account',
    inputSchema: toolSchema(),
    run: (args, ctx) => conversations.listConnectors({ token: ctx.token, sessionHeaders: ctx.sessionHeaders })
  },
  agent_resume: {
    description: 'resume takeover เดิมจาก audit cursor เดิมโดยไม่สร้าง worker ใหม่',
    inputSchema: toolSchema({ task_id: textArg('Takeover task ID') }, ['task_id']),
    run: (args, ctx) => orchestrator.resumeTakeover({
      taskId: args.task_id,
      taskFile: ctx.taskFile,
      token: ctx.token,
      sessionHeaders: ctx.sessionHeaders
    })
  },
  agent_takeover: {
    description: 'สร้าง worker ใหม่ให้ takeover งานจาก source conversation แล้วทำงานต่อ',
    inputSchema: toolSchema({ parent_conversation_id: textArg('Source/parent conversation UUID'), message: textArg('งาน/NEXT ที่ต้องทำต่อ'), parent_task_id: textArg('Parent task ID'), worker_project_id: textArg('Project ID สำหรับ worker') }, ['parent_conversation_id', 'message']),
    run: (args, ctx) => orchestrator.spawnTakeover({
      parentConversationId: args.parent_conversation_id,
      workerProjectId: args.worker_project_id || null,
      parentTaskId: args.parent_task_id || null,
      taskMessage: args.message,
      taskFile: ctx.taskFile,
      token: ctx.token,
      sessionHeaders: ctx.sessionHeaders
    })
  },
  agent_spawn: {
    description: 'สั่งงาน worker พร้อมฝัง task_id + return rule',
    inputSchema: toolSchema({ worker_conversation_id: textArg('Worker conversation UUID'), parent_conversation_id: textArg('Parent conversation UUID'), message: textArg('งานที่สั่ง'), parent_task_id: textArg('Parent task ID') }, ['worker_conversation_id', 'parent_conversation_id', 'message']),
    run: (args, ctx) => orchestrator.spawnAgent({
      workerConversationId: args.worker_conversation_id,
      parentConversationId: args.parent_conversation_id,
      parentTaskId: args.parent_task_id || null,
      taskMessage: args.message,
      taskFile: ctx.taskFile,
      token: ctx.token,
      sessionHeaders: ctx.sessionHeaders
    })
  },
  agent_return: {
    description: 'worker ส่งรายงานสุดท้ายกลับ parent + ปิดงาน',
    inputSchema: toolSchema({ task_id: textArg('Task ID'), report: textArg('Final report') }, ['task_id', 'report']),
    run: (args, ctx) => orchestrator.returnAgent({
      taskId: args.task_id,
      report: args.report,
      taskFile: ctx.taskFile,
      token: ctx.token,
      sessionHeaders: ctx.sessionHeaders
    })
  },
  agent_say: {
    description: 'parent ส่งข้อความต่อเข้าห้อง worker (คุยต่อได้ ไม่ปิดงาน)',
    inputSchema: toolSchema({ task_id: textArg('Task ID'), message: textArg('Message') }, ['task_id', 'message']),
    run: (args, ctx) => orchestrator.sendMessage({
      taskId: args.task_id,
      message: args.message,
      taskFile: ctx.taskFile,
      token: ctx.token,
      sessionHeaders: ctx.sessionHeaders
    })
  },
  agent_reply: {
    description: 'worker ถาม/รายงานกลับ parent ระหว่างทาง (ไม่ปิดงาน)',
    inputSchema: toolSchema({ task_id: textArg('Task ID'), message: textArg('Message') }, ['task_id', 'message']),
    run: (args, ctx) => orchestrator.replyAgent({
      taskId: args.task_id,
      message: args.message,
      taskFile: ctx.taskFile,
      token: ctx.token,
      sessionHeaders: ctx.sessionHeaders
    })
  },
  agent_check: {
    description: 'เก็บผล worker ที่จบเงียบๆ (poll ห้อง worker แล้วส่งเข้าห้อง parent)',
    inputSchema: toolSchema({ task_id: textArg('Task ID') }, ['task_id']),
    run: (args, ctx) => orchestrator.checkAgent({
      taskId: args.task_id,
      taskFile: ctx.taskFile,
      token: ctx.token,
      sessionHeaders: ctx.sessionHeaders
    })
  },
  agent_status: {
    description: 'ดูสถานะ task เดียว',
    inputSchema: toolSchema({ task_id: textArg('Task ID') }, ['task_id']),
    run: (args, ctx) => orchestrator.agentStatus({ taskId: args.task_id, taskFile: ctx.taskFile })
  },
  agent_list: {
    description: 'ลิสต์ทุก task',
    inputSchema: toolSchema(),
    run: (args, ctx) => orchestrator.listAgents({ taskFile: ctx.taskFile })
  }
};

exports.listTools = () => Object.entries(tools).map(([name, tool]) => ({
  name,
  description: tool.description,
  inputSchema: tool.inputSchema || toolSchema()
}));

exports.callTool = (name, args = {}, context = {}) => {
  const tool = tools[name];
  if (!tool) throw Object.assign(new Error(`ไม่มี tool "${name}" ใน provider chatgpt`), { code: 'UNKNOWN_TOOL' });
  return tool.run(args, context);
};
