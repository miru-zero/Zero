# UPDATE — CLI DEBUG + MODERATION

วันที่: 2026-09-19
สถานะ: VERIFIED

## Scope
อัปเดต `zero chatgpt conversation get <id> limit <N|A-B> debug` ให้เป็น debug surface ที่ใช้ตรวจ ChatGPT Web conversation ได้จริง โดยเพิ่ม message state และ moderation state โดยไม่เปลี่ยน output ปกติเมื่อไม่ได้ใส่ `debug`.

## VERIFIED — Source changes
แก้ไฟล์:
- `src/cli.js`
- `test/conversation-limit.test.js`

เพิ่ม output ต่อ message ในโหมด debug:
- `[DEBUG]`
- `id`
- `parent_id`
- `status`
- `end_turn`
- `content_type`
- `author_name`
- `recipient`
- `channel`
- `request_id`
- `turn_id`
- `turn_exchange_id`
- `working_turn_id`
- `model_slug`
- `finish_details`

## VERIFIED — Moderation debug
เพิ่ม section `[MODERATION]` จาก `conversation.moderation_results`:
- `message_id`
- `matched_message`
- `matched_role`
- `blocked`
- `flagged`
- `should_disable_conversation`
- `safety_limited`
- `protection_type`
- `block_reason`
- `disclaimers`
- `metadata`

`matched_message` ตรวจโดย map `moderation_results[].message_id` กับ `conversation.messages[].id`.
ถ้า moderation record ไม่มี node ตรงกันใน messages จะรายงาน `matched_message=false` แทนการเดาหรือทิ้ง record.

## VERIFIED — TDD
เพิ่ม regression test:
`limit debug prints message state and moderation records including orphan ids`

ผล RED ก่อน implementation: test ใหม่ FAIL เพราะ output เดิมไม่มี `[DEBUG]` / `[MODERATION]`.
ผล GREEN หลัง implementation:
- focused: `node --test test\conversation-limit.test.js` → 6/6 PASS
- full suite: `npm test` → 257/257 PASS

## VERIFIED — Live proof on MCP-02
Conversation:
`6aacf8d7-ce38-83ec-a415-1842cd77fa39`

คำสั่งที่ใช้ตรวจ:
`node .\src\cli.js chatgpt conversation get 6aacf8d7-ce38-83ec-a415-1842cd77fa39 limit 1 debug`

moderation record ตัวอย่างที่ยืนยันได้:
```text
[MODERATION]
message_id=1a83d572-3bce-4794-a785-84463464e9c4
matched_message=false
matched_role=-
blocked=true
flagged=false
should_disable_conversation=false
safety_limited=true
protection_type=cyber
block_reason=-
disclaimers=-
metadata={"safety_limited":true,"protection_type":"cyber"}
```

FACT: record นี้มีอยู่ใน `moderation_results` แต่ไม่มี message node ID เดียวกันใน conversation messages ที่ backend คืนมา จึงต้องรักษา orphan moderation record ไว้ใน debug output.

## NEXT
ถ้าจะหาว่า block เกิดฝั่ง Prompt หรือ Completion ต้องจับ live moderation/SSE event ที่มี `isCompletion`; persisted `moderation_results` ปัจจุบันไม่มี field นี้ จึงห้ามเดา.

## VERIFIED — Stream lifecycle primitives added to Zero

เพิ่ม ChatGPT Web primitives ใหม่ 2 ตัว:

1. `conversation_stream_status`
   - GET `/backend-api/conversation/{conversation_id}/stream_status`
   - CLI: `zero chatgpt conversation stream-status <conversation_id>`
   - live verified กับ MCP-02:
     ```text
     status=COMPLETE
     conversation_id=6aacf8d7-ce38-83ec-a415-1842cd77fa39
     ```

2. `conversation_resume`
   - POST `/backend-api/f/conversation/resume`
   - backend probe แบบ empty body ยืนยันว่า `body.conversation_id` เป็น required field
   - implementation ส่ง body ขั้นต่ำที่พิสูจน์แล้ว:
     ```json
     {"conversation_id":"<conversation_id>"}
     ```
   - Accept: `text/event-stream`
   - CLI: `zero chatgpt conversation resume <conversation_id>`
   - ยังไม่ใส่ `resume_token` / `offset` ลง body เพราะยังไม่มี capture ยืนยันชื่อ field จริง
   - live call บน conversation ที่ stream status เป็น COMPLETE ตอบ HTTP 404; บันทึกเป็น observed behavior ของ completed stream และห้ามตีความเกินหลักฐานว่า 404 หมายถึงอะไรทุกกรณี

Frontend evidence:
- SSE event `resume_conversation_token` มี `conversation_id` + `token`
- client resume state เก็บ `conversationId`, `resumeToken`, `offset`, `attemptCount`
- retry config ที่พบ: maxRetryCount=12, minDelayMs=300, maxDelayMs=5000, retryFactor=1.5
- Zero direct send ปัจจุบันยังใช้ buffered SSE text จึงยังไม่ได้รักษา resume token/offset เป็น first-class runtime state; นี่คือ NEXT สำหรับ full automatic recovery

Source/tests:
- modified: `src/providers/chatgpt/conversations.js`
- modified: `src/providers/chatgpt/index.js`
- modified: `src/cli.js`
- added: `test/conversation-stream-recovery.test.js`
- added: `test/cli-stream-recovery.test.js`

TDD:
- provider focused RED: 0/3 → GREEN: 3/3
- CLI focused RED: 0/2 → GREEN: 2/2
- full suite after final CLI change: 262/262 PASS
