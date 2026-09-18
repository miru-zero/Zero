# ZERO-CHATGPT — MASTER PLAN (อัปเดต 2026-09-16)

วิสัยทัศน์: **zero เป็นศูนย์กลาง tools ทุกอย่าง** — client ทุกตัว (มิรุ, ห้อง ChatGPT, script) เรียกผ่าน `zero` จุดเดียว
กติกา: เข้าถึงได้เฉพาะ provider ที่ประกาศ tool ไว้เท่านั้น · ทำ CLI ให้ครบและเทสได้ก่อน ค่อยยกไปเป็น MCP server

สถานะปัจจุบัน: host = CLI · providers = `chatgpt` (internal 9 tools) + `computeruse` (mcp-stdio 20 tools) + `desktopcommander` (mcp-stdio 26 tools)
รายละเอียดการใช้งาน: `docs/tools-hub.md`

---

## ✅ DONE — เสร็จแล้ว (2026-09-16)

| # | งาน | หลักฐาน |
|---|---|---|
| D1 | computeruse fix pack: `{root}` placeholder ใน command/args/env · ล็อก `cwd=repo root` ให้ MCP child · hub แนบ inputSchema · CLI โชว์ `args: name:type*` (* = required) · screenshot ลง `.zero/screenshots` ไม่รก repo | `npm test` 168/168 · `.zero/test-run13.log` |
| D2 | วาด Paint ผ่าน computeruse จบ 17 เส้น (coordSpace:screen + monitorIndex บังคับ) — quirk: screenshot ทันทีหลัง drag ชน event queue ต้องรอ ~1 วิ | `.zero/screenshots/screenshot-mon0-20260916-041930-662.png` |
| D3 | restore `config/zero.config.example.json` (ถูก episode JSON เขียนทับ) | ไฟล์กลับมาเป็น template ปกติ |
| D4 | สแกนห้อง `6aa82718-834c-83ec-8b22-e3f90f98c3f6`: AI ใช้ writing×3 (doc id 58314) · memcite×5 · filecite×32 · ไม่ได้ใช้ connectors | `.zero/conv-debug.json` |
| D5 | ค้น cross-room citation + ความจำโครงการ: `GET/POST /backend-api/projects/<pid>/saves[/<id>]` · `POST /backend-api/sidebar/conversation_context_sources` (SSE) · `POST …/conversation_context_citation_conversation_visibility` — body/format ครบจาก capture | save 4 ชิ้นของ g-p-6aa25edea7e88191a1496c5105a4202e ตรงที่ป๊าระบุ (ProjectSave_95908f52…) |
| D6 | เชื่อม Desktop Commander MCP ตรงผ่าน hub (ไม่ผ่าน ChatGPT plugin ที่ติด tool limit) — เพิ่ม config block เดียว | `zero desktopcommander` = 26 tools · live get_config ผ่าน |
| D7 | **default model สูงสุด**: `conversation new/send` ไม่ระบุ model → ส่ง `gpt-5-6-thinking` + `thinking_effort: extended` (ค่าเดียวกับเว็บตอนเลือก Thinking สุด · ปรับได้ผ่าน hub arg `model`/`thinking_effort`) | หลักฐานเว็บจริง: capture `POST /backend-api/f/conversation` ใน OSSGPT · `npm test` 170/170 `.zero/test-run14.log` |
| D8 | **zero report** = engineering feedback report จาก AI tester: journal passive ทุกคำสั่งจริงลง `.zero/journal.jsonl` (hook จุดเดียวที่ cli.run boundary · cap 64KB+sha256) · citation `[J:id]` · validator บังคับ FACT ต้องมีหลักฐานจริง / SUGGESTION ห้ามมี [J:] | ป๊าเลือกสถาปัตยกรรม A (19:21) · `npm test` 185/185 `.zero/test-run16.log` · คู่มือ docs/tools-hub.md หัวข้อ zero report |
| D9 | **agent คุยกัน 2 ทิศครบวงจร**: เพิ่ม `agent say` (parent→worker) / `agent reply` (worker→parent ไม่ปิดงาน) / `agent check` (เก็บผลค้าง) / `agent status` + `agent list` — ข้อความห่อ `[ZERO_AGENT_MESSAGE] from=…` ทุกฝั่ง · dispatch สอน reply อัตโนมัติ · ไม่ใช้ daemon (ทุกส่ง = turn ใหม่ของห้องปลายทาง) | `npm test` 194/194 `.zero/test-run18.log` · live: `agent list` เห็น 5 tasks จริง · callback เดิมยังทำงาน (result ของ task_df9bc8ea อ่านได้) |
| D9b | **bugfix dispatch baseline**: `sendConversationDirect` คืน `previous_node` (current_node ก่อนส่ง) · spawn/say เก็บ baseline นั้นเป็น `dispatch_node_id` — แก้เคสห้องตอบไวจน current_node ชน reply id แล้ว `agent check` มองไม่เห็นผล (เจอจริงตอนเก็บ 3 tasks ค้าง) · เก็บ tasks ค้างครบ 5/5 DELIVERED | `npm test` 197/197 `.zero/test-run19.log` (regression 3 ตัว) · live: task_9cfdbb54/d5d53b95/cd1a987c → DONE+DELIVERED ทั้งหมด |
| D9c | **targeted_reply (quote แล้วตอบ) ตาม spec เว็บจริง**: แกะจาก capture ป๊า + ซอร์สเว็บ OSSGPT — user message แนบ metadata 4 ตัว (`targeted_reply`/`_label` ≤80 ตัวอักษร/`_source_message_id`/`_source_range`) + hidden system message `"The user is referring to this in particular:\n<text>"` flags `exclude_after_next_user_message` + `is_visually_hidden_from_conversation` — ใส่ param `targetedReply` ใน `conversation new/send` (id ไปแค่ metadata โมเดลเห็นแต่ข้อความ) | `npm test` 202/202 `.zero/test-run20.log` · **live probe ยังไม่ได้ยิง (รอป๊าสั่ง)** |
| D10 | **auth refresh ชุดเดียวของ zero**: `zero auth refresh` + auto-refresh 1 ครั้งทุก guard หลักตอน token EXPIRED — ยก logic จาก `puperteer_GPT3.1/core/miru_func.js` (cookie → `GET /api/auth/session` → accessToken ใหม่) แต่ใช้ auth store เดิมของ zero (`runtime/auth-context.json` + `session-context.json`) · merge `set-cookie` กลับ (cookie rotation) · 401/403 = SESSION_DEAD ไม่แตะไฟล์ บอก login ใหม่ | `npm test` 214/214 (เพิ่ม 12: core 10 + CLI 2) · live read-only: `zero auth status` VALID ถึง 2026-09-23 ยังไม่จำเป็นต้องยิง refresh จริง |

---

## ⏸️ BLOCKED / ค้าง — รอเงื่อนไข

| # | งาน | ติดอะไร | วิธีปลดล็อก |
|---|---|---|---|
| B1 | **auth กลุ่มใหม่ (saves/sidebar) = 401** "Could not parse your authentication token" ทั้งที่ Bearer ไบต์ต่อไบต์ตรงกับเว็บและ classic endpoints ยัง 200 | ทฤษฎีหลัก: cookie `__oailb` (edge-gateway JWT อายุ ~65 นาที) หรือ `x-oai-is-client-observation` (sign ต่อ request) — ของ capture หมดอายุก่อนเทสเสร็จทุกรอบ + CF ขวางถี่ | ป๊า capture คู่ใหม่ (sources + saves) แล้วแจ้งมิรุ**ทันที** → ยิงภายใน 15 นาที · ทางสำรอง: สืบวิธี sign จาก `conversation-small-*.js` ใน OSSGPT |
| B2 | **visibility test** (ตอบคำถาม "ไม่เซฟแล้วชี id ข้ามห้องได้ไหม") — ยิง visibility เทียบ conversation ที่มี/ไม่มี save | รอ B1 | หลัง B1 ผ่าน ยิงชุดเดียวจบ |
| B3 | **cursor-fx overlay** (พับไว้ 13:47) — cursor ตอนนี้วาร์ปมองไม่เห็น | รอป๊าเลือกแบบ: (4) patch vendor — interpolate mousemove + วงกลมคลิก ใน process เดียว · (3) overlay แยก + named pipe ตามแบบ Codex (ได้ banner + esc kill switch ด้วย) · เสริม (2) annotate พิกัดลง screenshot ตอน review | ป๊าสั่งแบบ → มิรุทำได้ทันที ไม่ติดอะไร |
| B4 | debug printer ของ `conversation get` — non-text 29 ข้อความโชว์แค่ "(non-text)" | รอป๊าสั่ง | ปรับ printer ให้โชว์ content_type + tool/recipient |
| B5 | desktop-commander path ผูก npx cache (`_npx/<hash>`) | cache โดนล้าง = provider พัง | ติดตั้ง desktop-commander แบบ global แล้วชี้ path ถาวร |
| B6 | **ของมั่วที่ repo root ~25 MB** — `.room01-*.txt/.exit` 7 ไฟล์ (dump debug ห้อง 6aa5d080 โดย AI ห้อง ROOM01 ผ่าน Desktop Commander เมื่อ 17:33–17:44) + โฟลเดอร์ว่าง `NVIDIA Corporation/umdlogs` (10:19 — NVIDIA UMD log หล่นตอน computeruse screenshot ตอน cwd ยังไม่ล็อก) + โฟลเดอร์ว่าง `P/` (11:06 — ไม่ทราบต้นกำเนิด น่าจะ stray จากคำสั่งพิมพ์ผิด) | ป๊ายังไม่สั่งลบ — วิเคราะห์เสร็จแล้วรอตัดสินใจ | ป๊าอนุมัติลบ/ย้าย + กันไม่ให้ซ้ำด้วย CONVERSATION CACHE (มีที่เก็บประจำ) และ/หรือกติกา "ห้ามเขียน dump ที่ root" |

## 🗒️ PROPOSED / เสนอค้าง (เคยเสนอ ยังไม่ได้รับคำสั่ง)

| # | เรื่อง | รายละเอียด |
|---|---|---|
| P1 | F3 patch vendor Mcp.ComputerUse | error detail + รายงาน CWD ใน tool response |
| P2 | F4 session mode | MCP server ค้างข้าม CLI call (แก้ ScalePlan หาย + ลด spawn overhead) |
| P3 | ~~thinking_effort option~~ → ทำแล้วใน D7 | default=extended สูงสุด · ปรับผ่าน hub arg `thinking_effort` ได้ |
| P5 | **agent spawn naming** (finding จากรายงานตัวอย่างของป๊า) | `parent_conversation_id` สื่อแค่ conversation routing แต่ mental model ที่ถูกต้องมี message lineage (`next_parent_message_id`) ด้วย — help/contract ปัจจุบันทำให้เลือก UUID ผิดชนิดได้ · **ห้าม rename ทันที** (breaking change ต่อ CLI contract + agent protocol ที่ห้อง ROOM01 ใช้อยู่จริง) · ทางออกที่ควรชั่ง: ปรับ help/เอกสารให้สื่อ 2 มิติก่อน ค่อยตัดสินใจเรื่องชื่อ field |
| P4 | CALLBACK relay + worker_conversation_id | ใส่ ZERO_AGENT_CONTEXT ให้ agent ในห้องตอบกลับผ่าน MCP ได้ |

## 💡 CONVERSATION CACHE (ไอเดียจากป๊า 2026-09-16 17:52 — ยังไม่ได้ทำ)

**แนวคิด:** เวลา AI/ระบบดึง conversation อยู่แล้ว (ระบบเทข้อมูลมาเต็มอยู่แล้ว) ก็ให้**เขียนเก็บลง `src/providers/chatgpt/conversions/{UUID}` ทันที** เป็น local cache ของห้องนั้นๆ

- รอบต่อไปที่จะดึงซ้ำ → **เท/ลบของเก่าออกก่อน**แล้วค่อยเขียนใหม่ (กันไฟล์ซ้อนกันซับซ้อนเหมือนที่เกิด — ดู B6)
- อนาคต (ถ้าจำเป็น เช่นตอน offline): เพิ่มฟังก์ชัน **AUTO get** — ดึงทุก UUID แบบ **step by step** (ดึงห้องหนึ่งเสร็จค่อยไปห้องถัดไป ไม่ใช่กระหน่ำทีเดียวทั้งหมด — เลี่ยง rate limit)
- ประโยชน์: ของที่ดึงมามีที่เก็บประจำ ไม่กองมั่วที่ root · ห้อง/รอบถัดไปอ่านจาก cache ได้ทันที · เป็นฐานให้ offline analysis
- สถานะ: **อย่าเพิ่งทำ** — ป๊าสั่งวิเคราะห์ของมั่วก่อน (B6) แล้วค่อยตัดสินใจออกแบบ

---

## 🔮 ROADMAP — คาดว่าจะทำ (เรียงลำดับ)

| # | เรื่อง | เกณฑ์เสร็จ | หมายเหตุ |
|---|---|---|---|
| R1 | ปลด B1 (auth กลุ่มใหม่) แล้วเพิ่ม tools ให้ provider chatgpt: `project_saves_list` / `project_saves_get` / `project_saves_add` / `conversation_context_sources` | เรียกผ่าน `zero chatgpt call …` ได้จริง + tests | โค้ดฝั่งเราพร้อม (requestJson) ขาดแค่ auth flow |
| R2 | cursor-fx (B3) ตามแบบที่ป๊าเลือก | เห็น cursor/ripple ตอนสั่ง computeruse จริง | ตัวอย่างอ้างอิง: Codex host overlay (ดู `.zero/ref-codex-cu/`) |
| R3 | เพิ่ม provider `mcp-flow` (M:\Zero_Lab\rewjava\mcp-flow) | listTools/call ผ่าน zero ได้ | ⚠️ ป๊าสั่งไว้: **อย่าเพิ่งนำเข้า** จนกว่าจะสั่ง |
| R4 | mcp-http transport ใน hub (รองรับ remote MCP เช่น mcp.desktopcommander.app) | provider type `mcp-http` ใช้งานได้ | เพิ่ม type ใหม่จุดเดียวใน src/hub/index.js |
| R5 | zero เปิดเป็น MCP server ให้ client ภายนอกต่อเข้ามา (hub ตัวเดิม fan-out) | client ภายนอก listTools/callTool ผ่าน zero ได้ | เฟสสุดท้ายของแผนศูนย์กลาง — ทำหลัง CLI นิ่ง |

---

## กติกาที่ผูกกับ plan นี้

- ทุกงานต้องมีหลักฐาน execution (exit code / output / ภาพ) — ห้ามเคลม success ลอยๆ
- แก้ config/ไฟล์สำคัญ → `backup_edit` ก่อนเสมอ
- scratch/probe ทั้งหมดอยู่ใน `.zero/` ห้ามรก repo root
- จบงานสำคัญ → จด episode ลง zero-brain + อัปเดตไฟล์ plan นี้
