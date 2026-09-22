# ZERO REPORT REVIEW LEDGER

อัปเดต: 2026-09-18
กติกา: report เป็น evidence/checkpoint ไม่ใช่ source-of-truth ถาวร — ต้องเทียบ source/runtime ล่าสุดก่อนใช้

## Reviewed

### 20260917-135518 — Zero system architecture improvement review
- REVIEWED
- ยัง OPEN: provider-neutral core, ChatGPT logic leakage ใน core CLI, journal redaction, transactional agent state, provider health, restart strategy, provenance resolver
- SUPERSEDED: test 219/223 fail 4 → runtime ล่าสุด 245/245 PASS
- SUPERSEDED: computeruse startup failed → runtime ล่าสุด `zero computeruse` = 20 tools
- SUPERSEDED: stale `q/9` interactive-menu test และ mojibake failures ถูกแก้แล้ว
- RESOLVED: ChatGPT internal tools ไม่มี schema → ตอนนี้ 19/19 tools มี `inputSchema`
- KEEP: รายงานเตือนว่าชื่อ/configured provider ไม่เท่ากับ runtime READY

### 20260917-142752 — cross-conversation return routing
- REVIEWED
- FACT คงอยู่: `conversation_send` เป็น destination-only one-way primitive
- OPEN: peer conversation routing layer ต้องแยกจาก agent task lifecycle
- KEEP: อย่าเปลี่ยน semantics ของ `conversation_send` แบบเงียบ ๆ
- NEXT เมื่อถึง scope: explicit routing envelope + correlation/thread id + concurrency/branch-race test

### 20260917-145308 — provider skill contracts / no-guess tool usage
- REVIEWED
- FACT คงอยู่: provider/tool name อย่างเดียวไม่ใช่ usage contract
- PARTIALLY RESOLVED: ChatGPT internal tools มี `inputSchema` ครบ 19/19 แล้ว
- OPEN: provider-specific skill/contract ที่อธิบาย lifecycle, side effects, examples และ verification state
- KEEP: workflow = discover provider → read contract/schema → invoke; ห้ามเดา args/lifecycle จากชื่อ

### 20260917-205833 — อ่านข้อความเก่าย้อนหลังตามรหัสข้อความไม่ได้
- REVIEWED
- VERIFIED: `conversation_get` contract รับ `conversation_id` แต่ไม่มี `message_id`
- VERIFIED: search ด้วย message UUID ไม่ใช่ direct node lookup contract
- LIVE RESOLVED: `conversation_message_get` รับ `conversation_id + message_id` และไล่ historical pages จนพบ exact UUID
- LIVE RESOLVED: `conversation_all` ไล่ backward pagination ถึง `has_previous_page=false` โดยคง raw page boundaries
- KEEP: ห้ามเดา parent/child จากลำดับรายการ; historical `/messages` ที่เคย probe ไม่มี `parent_id`
- VERIFIED LIVE: target message `8256f53e-d5e7-4bce-b386-3464016cc3f8` ถูกพบจาก historical page; pages_scanned=2, nodes_scanned=288
- OPEN ต่อเนื่อง: raw Conversation Store / provenance persistence ลง disk

## Current checkpoint after review
- providers configured: chatgpt, computeruse, desktopcommander, devtools
- full suite: 245/245 PASS
- runtime smoke: computeruse=20 tools, desktopcommander=26 tools
- ChatGPT global search: LIVE VERIFIED ผ่าน Hub → provider `global_search`
- ChatGPT system_hints/plugin attachment: LIVE VERIFIED with real agent tool invocation
- ChatGPT internal schemas: 19/19 tools
- interactive `zero` menu: LIVE VERIFIED provider → tool → required args → result → back/home/exit
- project save: IMPLEMENTED + TESTED; live mutation not yet verified
- direct message lookup by `conversation_id + message_id`: LIVE VERIFIED
- true `conversation get <id> all`: LIVE VERIFIED; raw pages current→older จน oldest
