# ZERO TOOLS HUB (host: CLI)

zero ทำตัวเป็น **ศูนย์กลางเรียก tool ทุก provider** — ห้อง=สมอง zero=มือ
client ทุกตัว (มิรุ, ห้อง ChatGPT, script) เรียกผ่าน `zero` จุดเดียว
เพิ่ม provider ใหม่ = แก้ config ไฟล์เดียว ไม่แตะ client

**กติกาหลัก: zero เข้าถึงอะไรไม่ได้ถ้าไม่ได้ประกาศ tool** — ทุก capability อยู่ใต้ namespace ของ provider เท่านั้น (`zero <provider> ...`) ไม่มี flat command ลัดไปแตะของโดยตรง

## สถาปัตยกรรม (ตอนนี้ = CLI host)

```
ป๊า/มิรุ/ห้อง ──► zero <provider> (node src/cli.js, ชีวิตสั้น รันจบตาย)
                      │
                      ├─ provider internal ──► ฟังก์ชันใน process เดียวกัน (src/conversations.js, src/agents/orchestrator.js)
                      └─ provider mcp-stdio ──► spawn child process คุย stdin/stdout JSON-RPC (newline-delimited)
```

- ไม่มี daemon, ไม่มี socket — spawn ตอนเรียก แล้ว kill ทิ้งตอนจบ
- เฟสถัดไป (ยังไม่ทำ): zero เปิดเป็น MCP server ให้ client ภายนอกต่อเข้ามา โดยใช้ hub ตัวเดิม fan-out ต่อ

## คำสั่ง

```bash
zero tools                                   # ลิสต์ provider ที่ประกาศไว้ + config ที่ใช้
zero <provider>                              # ลิสต์ tools ของ provider
zero <provider> call <tool> '<json>'         # เรียก tool ตรงๆ uniform ทุก provider (json ไม่ใส่ = '{}')
zero <provider mcp> <tool> '<json>'          # ฟอร์มสั้นของ provider mcp (ไม่ต้องพิมพ์ call)
zero auth status                             # เช็ค token (กุญแจของ provider internal)
zero auth refresh                            # ขอ token ใหม่จาก session cookie (GET /api/auth/session) เขียนทับ runtime/auth-context.json
```

### auth ชุดเดียวของ zero + auto-refresh

- token อยู่ `runtime/auth-context.json` · cookie อยู่ `runtime/session-context.json` — **ชุดเดียวกันทุก provider internal ห้ามสร้าง auth store แยก**
- ทุก flow หลัก (guard หน้า provider internal + `zero <internal> call`) ถ้าเจอ token `EXPIRED` จะ **auto-refresh 1 ครั้ง** จาก cookie ก่อนเด้ง — cookie ยังอยู่ = ไม่ต้อง login ใหม่
- refresh สำเร็จจะ merge `set-cookie` ใหม่กลับ session-context ด้วย (cookie rotation)
- `SESSION_DEAD` (401/403) = cookie ตายแล้ว ต้อง login ใหม่เพื่ออัปเดต session-context — refresh ไม่แตะ auth file ในเคสนี้
- endpoint default `https://chatgpt.com/api/auth/session` เปลี่ยนได้ผ่าน `ZERO_CHATGPT_AUTH_SESSION_URL`

provider `chatgpt` (internal) มี sugar อ่านง่าย: `zero chatgpt conversation|project|agent|connectors|conversations ...` (ดู `zero chatgpt` หรือ usage ตอนพิมพ์ผิด)
ฟอร์มเก่า `zero conversation/project/agent/connectors` ถูกย้ายไปใต้ `zero chatgpt ...` แล้ว — พิมพ์เก่าจะเด้ง migration hint บอกคำสั่งใหม่

ตัวอย่างจริงที่เทสผ่านแล้ว:

```bash
zero computeruse call ping '{}'
zero computeruse call shell '{"command":"echo hi"}'
zero computeruse call screenshot '{"monitorIndex":0}'
zero chatgpt call connectors_list '{}'
zero chatgpt conversation init <conversation_id>
```

## zero report — engineering feedback report จาก AI tester

แนวคิด: zero เป็น **integrity layer** ไม่ใช่ผู้เขียนรายงาน — AI tester (มิรุ/ห้อง) เป็นคนเขียน ISSUE/SUGGESTION
แต่ **FACT ทุกข้อต้องพิสูจน์ได้ด้วยกลไก** ว่ามาจากการรันจริง ปลอมไม่ได้

ชิ้นส่วน 3 ตัวทำงานร่วมกัน:

1. **journal** (passive) — ทุกคำสั่งที่ zero รันจริงถูกบันทึกอัตโนมัติลง `.zero/journal.jsonl`
   (id, argv, exitCode, durationMs, stdout — cap 64KB เก็บหัว+ท้าย+sha256 ถ้าเกิน · ปิดด้วย `ZERO_JOURNAL=off` · ย้ายที่ด้วย `ZERO_JOURNAL_FILE`)
2. **citation** — ใน report ให้อ้างหลักฐานด้วย `[J:<journal-id>]`
3. **validator** — `zero report check` บังคับสัญญา ออก exit 0/1

```bash
zero report new <provider> <title>   # สร้าง skeleton ที่ reports/<provider>/ (zero report <provider> <title> ก็ได้)
zero report log [N]                  # ดู journal N รอบล่าสุด เพื่อเลือก [J:id] มาอ้าง
zero report check <file>             # ตรวจสัญญาก่อนส่งรายงาน
```

สัญญาที่ validator บังคับ:
- section ครบตาม template (SOURCE / FACT / ISSUE / ACTUAL / EXPECTED / EVIDENCE / IMPACT / SUGGESTION / CONFIDENCE / NEXT TEST) เรียงลำดับถูก
- **FACT ทุก bullet ต้องอ้าง `[J:id]` ที่มีจริงใน journal** — exit code ไม่ใช่ 0 ก็ใช้เป็นหลักฐานได้ (ความล้มเหลวคือหลักฐาน)
- **SUGGESTION ห้ามมี `[J:]` เด็ดขาด** — เลเยอร์วิเคราะห์ต้องแยกจากเลเยอร์หลักฐาน
- CONFIDENCE ต้องประกาศระดับของแต่ละส่วน (verified / AI analysis)

workflow ของ AI tester: รันคำสั่งเทสตามปกติ (journal เก็บเอง) → `zero report log` เลือกหลักฐาน → `zero report new` → เติมเนื้อ → `zero report check` ผ่านค่อยส่งให้ป๊า

## Howto

- **อยากรู้ว่า zero ทำอะไรได้บ้างตอนนี้** → `zero tools` (ดู provider) แล้ว `zero <provider>` (ดู tool ของ provider นั้น)
- **จะเรียก tool ที่ไม่รู้พารามิเตอร์** → `zero <provider>` จะโชว์บรรทัด `args:` ใต้ tool ที่มี schema — ตัวที่ติด `*` คือ required ต้องส่งเสมอ (เช่น `mouse_drag` ต้องมี `monitorIndex*, fromX*, fromY*, toX*, toY*`) — อย่าเดาชื่อพารามิเตอร์ ชื่อผิด server อาจ error หรือแย่กว่านั้นคือเงียบแล้วทำผิดที่
- **ใช้ mouse/keyboard ของ computeruse ผ่าน CLI call** → ทุก call spawn server ใหม่ ScalePlan ไม่ค้างข้าม call → ใส่ `coordSpace:"screen"` (camelCase! description เขียน coord_space แต่พารามิเตอร์จริงคือ coordSpace) แล้วคิดพิกัด physical pixel เองจาก `factor_x/factor_y` ที่ screenshot คืนมา; ถ้าเรียกหลาย call ต่อกัน (เช่น script) ผ่าน hub ใน process เดียว server จะค้าง ใช้ model coords ได้
- **วาด/คลิกแล้ว screenshot ทันทีภาพไม่อัปเดต** → mouse events เข้าคิว Windows แอปประมวลผลไม่ทัน — รอ ~1 วิก่อนจับภาพ (เจอจริงตอนวาด Paint: screenshot ทันทีเห็น 1 เส้น รอแล้วเห็นครบ 17 เส้น)
- **เรียก provider internal (chatgpt)** → ต้อง `zero auth status` เป็น VALID ก่อน ไม่งั้นเด้ง auth status ไม่ยิง tool
- **call แล้ว error=UNKNOWN_PROVIDER (71)** → ไม่มีใน config — เช็ค `zero tools` ว่าชื่อ provider ตรงไหม หรือยังไม่ได้เพิ่มใน `runtime/zero.config.json`
- **call แล้ว error=MCP_SPAWN_FAILED/MCP_EXITED (73)** → binary หายหรือ env ขาด — เช็ค `command` ใน config ว่า path ยังอยู่ และ env (เช่น `DOTNET_ROOT`) ชี้ถูก
- **เพิ่ม provider ใหม่** → ดูหัวข้อ "เพิ่ม provider ใหม่" ด้านล่าง แก้ config ไฟล์เดียวจบ
- **ใช้ผ่าน `zero.cmd` (ตัวรวมกับ zero-brain)** → คำสั่ง zero-brain (health/mcp/init/backup/setup/obsidian/cli/verify/smoke) ไป zero-brain · ที่เหลือทั้งหมดวิ่งเข้า hub ที่นี่ (provider ใหม่เพิ่มใน config ใช้ได้ทันที ไม่ต้องแก้ zero.cmd)
- **อยากรู้ห้องนี้ default model อะไร / limit เหลือเท่าไหร่ (แบบเว็บจริง)** → `zero chatgpt conversation init <conversation_id>` — ยิง `POST /backend-api/conversation/init` endpoint เดียวกับที่เว็บเรียกตอนเปิดห้อง คืน `default_model_slug` + `limits_progress`; ห้องใหม่จาก `zero chatgpt conversation new` จะ init อัตโนมัติ (best-effort: init พังไม่ทำให้ห้องพัง ดูบรรทัด `init=OK/FAILED` ใน output)

## Exit codes (เฉพาะ tools)

| code | ความหมาย |
|---|---|
| 0 | สำเร็จ (ผล tool เป็น JSON ที่ stdout) |
| 64 | เรียกผิดรูปแบบ → แสดง usage |
| 65 | JSON args พัง (`error=INVALID_JSON`) |
| 70 | โหลด config/hub ไม่ได้ (`error=CONFIG_INVALID` ฯลฯ) |
| 71 | ไม่มี provider ใน config (`error=UNKNOWN_PROVIDER`) |
| 72 | ไม่มี tool ใน provider (`error=UNKNOWN_TOOL`) |
| 73 | MCP layer พัง (`error=MCP_TIMEOUT` / `MCP_EXITED` / `MCP_SPAWN_FAILED` / `MCP_ERROR`) |

## Config

ลำดับหา config (ตัวแรกที่เจอชนะ):

1. env `ZERO_CONFIG_FILE`
2. `runtime/zero.config.json` ← **ค่าเครื่องอยู่ที่นี่ไฟล์เดียว** (ย้ายเครื่องแก้ไฟล์นี้)
3. `config/zero.config.example.json` (fallback ใน repo)

รูปแบบ:

```json
{
  "providers": {
    "chatgpt": { "type": "internal" },
    "computeruse": {
      "type": "mcp-stdio",
      "command": "vendor/Mcp.ComputerUse/.../mcp-computeruse.exe",
      "args": [],
      "env": { "DOTNET_ROOT": "C:/path/to/dotnet" },
      "timeoutMs": 60000
    }
  }
}
```

- `command` relative จาก repo root (resolve เป็น absolute ตอน spawn)
- `env` เป็น **fallback** — key ที่ shell มีอยู่แล้วชนะเสมอ (กัน config ไปทับ env จริง)
- placeholder `{root}` ใน `command`/`args`/`env` จะถูกแทนด้วย repo root (absolute, forward slash) ตอน spawn — ใช้อันนี้แทน path ฟิกค่า ย้ายเครื่องไม่พัง (เช่น `"{root}/.zero/screenshots"`)
- child process ของ mcp-stdio ถูกล็อก `cwd = repo root` เสมอ ไม่ขึ้นกับว่ายืนรัน zero จากที่ไหน

## ห้องคุยกัน (agent) — วงจรสนทนา 2 ทิศผ่าน zero

ไม่ต้องมี daemon — ทุกครั้งที่ zero ส่งข้อความเข้าห้อง = ห้องนั้นตื่นและตอบเป็น turn ใหม่ทันที
วงจรเต็ม:

```bash
# 1. main สั่งงาน (ฝัง task_id + return rule + สอน reply อัตโนมัติ)
zero chatgpt agent spawn <worker_conv_id> <parent_conv_id> "งาน"
# 2. worker ถามกลับ/รายงานระหว่างทาง (ไม่ปิดงาน)
zero chatgpt agent reply <task_id> "ถามกลับ/ความคืบหน้า"
# 3. main ตอบ/สั่งต่อ (ไม่ปิดงาน)
zero chatgpt agent say <task_id> "ตอบ/สั่งต่อ"
# วน 2-3 ได้เรื่อยๆ
# 4. worker ปิดงาน
zero chatgpt agent return <task_id> "FACT / VERIFIED / BLOCKER / STATE / NEXT"
```

เก็บตก + debug:

```bash
zero chatgpt agent check <task_id>   # เก็บผล worker ที่จบเงียบๆ (poll ห้องแล้ว deliver เข้า parent)
zero chatgpt agent status <task_id>  # ดู task เดียว
zero chatgpt agent list              # ดูทุก task
```

- ข้อความทุกฝั่งห่อ `[ZERO_AGENT_MESSAGE] task_id=… from=parent|worker` ให้ห้องอ่านรู้เรื่อง
- **ทุกแลกเปลี่ยน = 1 turn จริงในห้องปลายทาง** (กิน quota) — รวมคำถามเป็นชุดเดียว อย่าส่งซิกแซก
- งานที่ return แล้วปิดถาวร — คุยต่อต้อง spawn งานใหม่

## Provider types

| type | คือ | auth |
|---|---|---|
| `internal` | ห่อ zero-chatgpt เดิม (14 tools: conversations_list, conversation_get, conversation_init, conversation_new, conversation_send, project_conversations, connectors_list, agent_spawn, agent_say, agent_reply, agent_return, agent_check, agent_status, agent_list) | ใช้ token/session เดิม (`runtime/auth-context.json` + `runtime/session-context.json`) ถ้า auth ไม่ VALID → เด้ง auth status ไม่ยิง tool |
| `mcp-stdio` | spawn binary ที่คุย MCP stdio (newline-delimited JSON-RPC) | ไม่ต้อง auth ChatGPT |

### กำหนด model (ความฉลาดโมเดล)

- ผ่าน CLI: `zero chatgpt conversation new "ข้อความ" model <slug>` · `zero chatgpt conversation send <id> "ข้อความ" model <slug>` · `zero chatgpt project conversation new <pid> "ข้อความ" model <slug>`
- ผ่าน hub: `zero chatgpt call conversation_new '{"message":"...","model":"<slug>"}'` (conversation_send ใส่ `model` ได้เหมือนกัน · ปรับ effort ด้วย `"thinking_effort":"standard|extended|min"`)
- ไม่ใส่ = `gpt-5-6-thinking` + `thinking_effort: extended` (**สูงสุด** — ค่าเดียวกับที่เว็บส่งจริงตอนเลือก Thinking สุด, หลักฐาน: capture `POST /backend-api/f/conversation` ใน OSSGPT) · `<slug>` คือค่า model ที่เว็บ ChatGPT ส่งจริงใน request (ดูจาก network ของเว็บตอนสลับโมเดล) · ถ้าอยากให้ระบบเลือกเองส่ง `model auto` ได้

## เพิ่ม provider ใหม่ (เช่น mcp-flow ในอนาคต)

1. build/prepare binary ให้พร้อม
2. เพิ่ม block ใน `runtime/zero.config.json` (type `mcp-stdio` + command + env ถ้าจำเป็น)
3. `zero <ชื่อ>` ดูว่า listTools ออก → `zero <ชื่อ> call <tool> '{}'` ทดสอบ
4. ไม่ต้องแก้โค้ด hub หรือ client ใดๆ

พิสูจน์แล้วกับ `desktopcommander` (2026-09-16) — เพิ่ม config block เดียว (node + dist/index.js ของ @wonderwhy-er/desktop-commander ใน npx cache) ได้ tools เต็ม 26 ตัว ไม่ติด tool limit ของ ChatGPT plugin "Remote Desktop Commander" ที่ proxy ไป MCP ตัวเดียวกัน — ข้อควรระวัง: path ชี้ npx cache (`_npx/<hash>`) ถ้า cache โดนล้างต้องชี้ path ใหม่หรือติดตั้งแบบถาวร

ถ้า provider คุย protocol อื่น (ไม่ใช่ mcp-stdio) → เพิ่ม type ใหม่ใน `src/hub/index.js` จุดเดียว

## โครง src (จัดตาม provider — 2026-09-16)

```
src/
  cli.js                     dispatcher: zero <provider> ... (เข้าถึงได้เฉพาะ provider ที่ประกาศ tool)
  main.js                    entry (login/menu flow)
  hub/                       tools hub: index.js, registry.js, mcp-stdio-client.js
  providers/
    chatgpt/                 provider chatgpt (internal) ครบวงจรในโฟลเดอร์เดียว
      index.js               provider def (14 tools)
      conversations.js, chatgpt-client.js, sentinel.js, browser-bridge.js
      agents/                orchestrator.js, mailbox.js, task-registry.js, watcher.js
  core/                      auth-loader.js, auth-status.js, auth-refresh.js, session-context.js (ใช้ร่วมทุก provider)
  setup/                     chatgpt-login.js, login-menu.js, token-setup.js
  miru/                      miru-legacy-graph.js, miru-modern-conversation.js
```

provider ใหม่แบบ internal → สร้าง `src/providers/<ชื่อ>/` แล้ว register ใน hub + config

## Quirk ที่เจอแล้ว (อย่าเจอซ้ำ)

- **Git Bash env ขาด `ProgramFiles`/`ProgramData`** → `dotnet restore` พัง `path1 null` — export ให้ก่อน build .NET
- **`.NET` apphost หา runtime ไม่เจอ** (`the default install location cannot be obtained`) → ต้องส่ง `DOTNET_ROOT` ใน config env
- **PATH จาก Git Bash ขาด `System32\WindowsPowerShell\v1.0`** → child หา `powershell.exe` ไม่เจอ — hub มี `sanitizePathForNative` แปลง POSIX/Windows form + เติม System32/PowerShell จาก `SYSTEMROOT` ให้อัตโนมัติ (มี regression test แล้ว)
- **ห้ามวาง fixture script ไว้ใต้ `test/`** — `node --test` จะหยิบไปรันเองจนค้าง ให้ใช้ `test-fixtures/`
- **screenshot ของ computeruse เคยกระจายตามที่ยืนรัน zero** — default dir ของมันคือ `Environment.CurrentDirectory` — แก้แล้ว 2 ชั้น: config ส่ง `MCP_COMPUTERUSE_SCREENSHOTS_DIR: "{root}/.zero/screenshots"` + hub ล็อก `cwd=repo root` ให้ child ทุกตัว
- **`mouse_drag` ใช้ไม่ได้ถ้าขาด `monitorIndex`** (required) และพารามิเตอร์พิกัดคือ `coordSpace` (camelCase) ไม่ใช่ `coord_space` ตามที่ description เขียน — เคยเดาผิดแล้วเส้นไม่ออกเลย ตอนนี้ `zero computeruse` โชว์ args + required ให้แล้ว เช็คก่อนยิง
- **event queue ของแอปเป้าหมายช้ากว่า MCP call** — ยิง drag 17 เส้นแล้ว screenshot ทันที เห็นแค่เส้นแรก รอ ~1 วิเห็นครบ — script วาด/คลิกชุดใหญ่ควรเว้นจังหวะก่อนจับภาพสรุป

## ไฟล์ที่เกี่ยว

- `src/hub/mcp-stdio-client.js` — spawn + JSON-RPC client (initialize/listTools/callTool/close)
- `src/hub/registry.js` — หา + โหลด config
- `src/hub/index.js` — hub: listProviders / listTools / callTool / close
- `src/providers/chatgpt/index.js` — internal provider (def 9 tools)
- `src/cli.js` — dispatcher `zero <provider> ...` (เข้าถึงได้เฉพาะ provider ที่ประกาศ tool)
- `test/tools-hub-stdio.test.js`, `test/cli-tools.test.js` — hub/dispatch tests
