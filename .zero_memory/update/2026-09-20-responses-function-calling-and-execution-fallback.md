# ZERO-CHATGPT — Responses Function Calling / Execution Fallback — 20 กันยายน 2026

## ขอบเขต

บันทึก authoritative working state ล่าสุดของ Zero สำหรับเป้าหมาย OpenAI-compatible API สำหรับ IDE โดยใช้ ChatGPT Web direct transport แบบ no-browser เป็น provider หลัก

## VERIFIED FACT

- เป้าหมายหลักของ Zero คือ:
  `IDE / SDK -> OpenAI-compatible Zero API -> ChatGPT Web direct provider`
- Browser/Playwright ไม่ใช่ runtime backend หลักของ Zero
- `/v1/chat/completions` ใช้งานได้
- `/v1/responses` ใช้งานได้สำหรับ text, continuity และ streaming
- Responses continuity ใช้ `previous_response_id` แล้ว map กลับ conversation เดิม
- `tools[]` ถูก forward ผ่าน API runtime ไปยัง chat runtime แล้ว
- Chat Completions path มี native tool invocation -> OpenAI `tool_calls`
- Full regression checkpoint ก่อนเริ่ม Responses function-calling ชุดใหม่ = `330/330 PASS`

## RESPONSES FUNCTION CALLING — CURRENT STATE

มาตรฐานที่ต้องรองรับ:

`tools[] -> output.type=function_call -> IDE executes -> input.type=function_call_output + previous_response_id -> final response`

เพิ่ม RED tests แล้วใน:
`test/llm-responses.test.js`

ครอบคลุม 6 contract:
1. Responses flat function tools
2. native invocation -> `function_call` output item
3. `function_call_output` input
4. `/v1/responses` forwards tools
5. `previous_response_id` + tool output continuation
6. streaming function-call events

ผลรัน RED รอบแรก:
- existing Responses tests = 5 PASS
- new Responses function-calling tests = 6 FAIL

ความหมาย:
- Responses path ปัจจุบันยัง text-only ในส่วน function calling
- `function_call_output` ยังไม่ถูกแปลงเข้า continuation
- stream ยังไม่มี function-call event sequence มาตรฐาน

แก้แล้วหนึ่งจุด:
- `src/llm/tool-compat.js`
- `toolsToLocalFunctionNames()` รองรับทั้ง Chat Completions shape:
  `tool.function.name`
  และ Responses flat shape:
  `tool.name`

ยังไม่ได้ยืนยัน GREEN หลัง patch นี้ใน checkpoint ปัจจุบัน

## EXECUTION RULE — BLOCKER / FALLBACK

กฎใหม่ที่ต้องยึด:

- ถ้าวิธี execution หนึ่งติด เช่น `edit_block` ถูกปฏิเสธ ห้ามสรุปว่างาน BLOCKED ทันที
- ต้องลองเส้นทางปกติอื่นที่ยังได้รับอนุญาตและเหมาะสมก่อน เช่น:
  - `write_file`
  - patch ขนาดเล็กกว่า
  - local Node/PowerShell script สำหรับแก้ไฟล์แบบตรวจสอบได้
  - วิธีอื่นที่ไม่ใช่การหลบ safety gate
- จะเรียก `BLOCKER` ได้ก็ต่อเมื่อเส้นทางปกติที่ได้รับอนุญาตหมดจริง
- Base64 ใช้ได้เพื่อ encoding/quoting/transport ตามปกติ
- ห้ามใช้ Base64 หรือ encoding เพื่อหลบ safety/safety gate
- ห้ามรายงานว่า "ติด" ทั้งที่ยังมีทาง execution ปกติที่ทำต่อได้

## EXTERNAL REFERENCE — guberm/chatgpt-web-provider

ตรวจ repo:
`https://github.com/guberm/chatgpt-web-provider`

FACT:
- เป้าหมายของ repo ใกล้ Zero: OpenAI-compatible local API facade สำหรับ third-party tools
- backend ปัจจุบันของ repo ใช้ Playwright persistent Chromium profile
- flow คือ browser-controlled ChatGPT UI ไม่ใช่ direct `/backend-api/*` transport
- ไม่พบ implementation ของ:
  - `/backend-api/f/conversation/prepare`
  - direct conversation SSE
  - conduit token
  - turn trace
  - resume/recovery แบบ Zero
- README ระบุว่ายังไม่มี shell/filesystem/MCP tool loop
- Responses streaming ของ repo ยังไม่ implement

สิ่งที่ใช้เป็น reference ได้:
- API facade ergonomics
- Bearer / X-API-Key auth
- provider capabilities/status endpoint
- request queue / concurrency policy

สิ่งที่ไม่ควรนำมาแทน Zero:
- Playwright/browser backend

## CURRENT NEXT

1. ปิด Responses function-calling RED tests ให้ GREEN
2. รองรับ `function_call_output` + `previous_response_id` continuation
3. เพิ่ม Responses function-call streaming events:
   - `response.output_item.added`
   - `response.function_call_arguments.delta`
   - `response.function_call_arguments.done`
   - `response.output_item.done`
   - `response.completed`
4. รัน focused regression
5. รัน full regression
6. ทดสอบ live OpenAI SDK / IDE function-calling loop
7. หลัง E2E ผ่าน ค่อย mark model capability `tools: true`

## SCOPE LOCK

- ไม่เปลี่ยนกลับไปใช้ browser runtime
- ไม่เพิ่ม Agents SDK เป็น dependency หลักเพื่อแก้ IDE compatibility
- Responses API wire contract เป็นมาตรฐานขาเข้า/ขาออกสำหรับ function calling
- ChatGPT Web provider internals เป็น implementation detail ภายใน Zero
- source/runtime จริงมี authority สูงกว่า memory/update นี้เสมอ


---

# AUTHORITATIVE CHECKLIST UPDATE — LOCAL API FUNCTION CALLING CLOSED

อัปเดตนี้ supersede ส่วน **CURRENT NEXT** ด้านบน โดยไม่ลบ historical RED checkpoint เดิม

## VERIFIED CHECKLIST

### Local OpenAI-compatible API

- [x] `GET /health`
- [x] `GET /v1/models`
- [x] `POST /v1/chat/completions` non-stream
- [x] Chat Completions streaming
- [x] Chat Completions `conversation_id` continuity
- [x] `POST /v1/responses` non-stream
- [x] Responses `previous_response_id` continuity
- [x] Responses streaming
- [x] OpenAI SDK can consume Responses SSE with real SSE line breaks

### Function calling — Chat Completions

- [x] accepts OpenAI nested function tool schema: `tool.function.name`
- [x] arbitrary client tool schemas are exposed through Zero client-tool shim
- [x] arbitrary IDE tools are NOT treated as ChatGPT Web `local_function_names`
- [x] synthetic client tool marker -> OpenAI `tool_calls`
- [x] non-stream `finish_reason = "tool_calls"`
- [x] streaming `delta.tool_calls`
- [x] streaming `finish_reason = "tool_calls"`
- [x] client executes tool locally
- [x] `role:"tool"` + `tool_call_id` continuation
- [x] same Zero/ChatGPT conversation continues after client tool result

### Function calling — Responses API

- [x] accepts Responses flat function schema: `type:"function", name, parameters`
- [x] native ChatGPT invocation -> Responses `function_call`
- [x] Zero client-tool shim marker -> Responses `function_call`
- [x] `function_call_output` input
- [x] `function_call_output + previous_response_id` continuation
- [x] streaming `response.output_item.added`
- [x] streaming `response.function_call_arguments.delta`
- [x] streaming `response.function_call_arguments.done`
- [x] streaming `response.output_item.done`
- [x] streaming `response.completed`
- [x] client-tool marker is buffered and does not leak as output text during tool-call streaming

### Live SDK proof

- [x] OpenAI SDK Responses: text
- [x] OpenAI SDK Responses: continuity
- [x] OpenAI SDK Responses: streaming text
- [x] OpenAI SDK Responses live tool loop:
  `tools -> function_call -> client execute -> function_call_output -> final assistant`
- [x] OpenAI SDK Chat Completions live tool loop:
  `tools -> tool_calls -> client execute -> role:"tool" -> final assistant`
- [x] OpenAI SDK Chat Completions live streaming tool call

Live proof values:
- Responses function: `zero_probe({"message":"PING"})`
- Responses client result: `ZERO_PROBE_OK`
- Chat function: `zero_probe({"message":"PING"})`
- Chat client result: `ZERO_CHAT_TOOL_OK`
- Chat streaming function: `zero_probe({"message":"PING_STREAM"})`

### Regression / capability

- [x] focused client-tool/API suite = `37/37 PASS`
- [x] final full repo regression = `345/345 PASS`
- [x] `zero-auto.capabilities.tools = true`
- [x] CommonJS direct-export invariant remains green in full regression
- [x] runtime remains ChatGPT Web direct/no-browser for this API path

## IMPLEMENTATION LOCK

Arbitrary IDE/client tools use this internal adapter contract:

```text
IDE OpenAI tools[]
        |
        v
Zero CLIENT TOOL SHIM
  - exposes schema to the model
  - model emits ZERO_CLIENT_TOOL_CALL marker
        |
        v
Zero normalizes marker
        |
        +--> Chat Completions tool_calls
        |
        +--> Responses function_call
        |
        v
IDE executes tool locally
        |
        v
tool result is sent back through standard OpenAI API wire
        |
        v
Zero continues the same ChatGPT Web conversation
```

Important:
- Do not regress arbitrary IDE tool schemas back to `local_function_names`.
- Captured ChatGPT Web evidence shows `local_function_names` is not an arbitrary client-tool schema provisioning mechanism.
- Native ChatGPT Web tool invocations remain supported and normalize through the existing native path.

## STATE

`LOCAL OPENAI-COMPATIBLE API / CLIENT FUNCTION CALLING = CLOSED`

This closure means the core IDE-facing function-calling loop is verified for both Chat Completions and Responses API, including streaming tool-call output.

## NON-BLOCKING FUTURE ENHANCEMENTS

These are enhancements, not blockers for the closed local API milestone:

- [ ] stricter local JSON-Schema argument validation
- [ ] explicit `tool_choice` enforcement inside the client-tool shim
- [ ] parallel/multiple client tool calls in one turn
- [ ] richer tool execution error normalization
- [ ] usage/token accounting parity
- [ ] broader IDE-specific compatibility matrix

## FINAL VERIFIED TEST CHECKPOINT

```text
focused = 37/37 PASS
full    = 345/345 PASS
live Responses tool loop = PASS
live Chat tool loop      = PASS
live Chat stream tools   = PASS
model tools capability   = true
```


## ROLE SEPARATION FIX — VERIFIED

- [x] Responses system/developer context no longer flattened into visible user text
- [x] synthetic Miru Zero `<system>...</system>` user items are reclassified as hidden system context
- [x] `ZERO_CLIENT_TOOLS_V1` tool schema is hidden system context, not visible user content
- [x] Responses `function_call` history is preserved as assistant tool-call history
- [x] Responses `function_call_output` is preserved internally as role `tool`
- [x] tool-result continuation uses a hidden internal user trigger; tool result itself stays hidden context
- [x] ChatGPT Web provider supports generic hidden system messages in create/send paths
- [x] focused role-separation suite = `50/50 PASS`
- [x] full repo regression = `352/352 PASS`
- [x] live Responses role-separation + tool-loop = PASS
- [x] raw ChatGPT Web room verification: visible user contained only the real user prompt
- [x] raw room contained no `SYSTEM_ROLE_MARKER`, `EXECUTION_POLICY_MARKER`, or `ZERO_CLIENT_TOOLS_V1` inside visible user content
- [x] live smoke conversation deleted after verification

### STATE

`LOCAL API ROLE SEPARATION = CLOSED`
