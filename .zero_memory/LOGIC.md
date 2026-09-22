# ZERO-CHATGPT — LOGIC / WORKING UNDERSTANDING

อัปเดต: 2026-09-19

ไฟล์นี้เก็บ “logic ความเข้าใจของงาน” สำหรับใช้ต่องานโดยไม่ต้องเดาใหม่ทุกห้อง
ให้ใช้เป็น design/working logic ร่วมกับหลักฐาน runtime จริง และต้อง revalidate เมื่อ implementation เปลี่ยน

---

## 1. หลักคิด: มองระบบแบบ USE ก่อน implementation

เวลาออกแบบหรือวิเคราะห์ feature ให้เริ่มจาก:
1. ผู้ใช้ต้องการทำอะไร
2. เรียก operation อะไร
3. ระบบสัญญาว่าจะเกิดอะไร
4. state/identity/relationship อะไรต้องถูกสร้างหรือคงอยู่
5. ผลลัพธ์ต้องกลับไปที่ไหน
6. ผู้ใช้ตรวจสอบ/เปิดดูผลนั้นได้อย่างไร

แล้วค่อย map ลง API / endpoint / payload / transport / storage

ห้ามกลับหัวเป็น:
endpoint ที่เจอ -> เดาว่านี่คือ feature -> ยัดเข้า Zero -> เรียกว่าสำเร็จ

ตัวอย่าง:
- `conversation_send` มี USE = ส่งข้อความไป destination
- `agent spawn` มี USE = สร้างงานให้ worker ทำ + มี ownership + lifecycle + return route

ถึง implementation ข้างในอาจ reuse transport เดียวกัน แต่ USE semantics คนละเรื่อง

กฎสำคัญ:
- อย่าบิด primitive เดิมให้ทำหน้าที่ใหม่แบบเงียบ ๆ
- operation ใหม่ที่ semantics ต่าง ต้องมี contract ของตัวเอง
- implementation ต้องตาม USE contract ไม่ใช่ให้ USE ตาม implementation ที่บังเอิญหาเจอ

---

## 2. Normal ChatGPT ของ Zero = BASE / FREEZE

Normal ChatGPT transport ปัจจุบันถือว่า “ครบพอเป็นฐาน” และไม่ควรถูกรื้อเพื่อเรื่อง Subagent

สิ่งที่มีแล้ว:
- conversation_new
- conversation_send (direct / browser)
- conversation_get
- conversation_all
- conversation_message_get
- current_node / previous_node
- historical pagination
- targeted reply + source message/range
- project/gizmo context
- model / thinking_effort
- auth / session / sentinel transport

หลัก invariant ของ Normal:
- `conversation_mode = primary_assistant`
- `conversation_send` ยังคงเป็น destination-only one-way primitive
- ไม่เพิ่ม side effects เช่น task creation / watcher / return routing เข้าไปเงียบ ๆ
- message provenance ต้องใช้ ID จริง ห้าม fabricate parent/child จากลำดับ array

Normal transport = ชั้นฐาน
Subagent capability = ชั้น operation ที่ต้องสร้าง/หาแยกต่างหาก

### API-first / Browserless

เป้าหมายของ Zero คือ API/CLI โดยตรง ไม่ใช่การพึ่ง ChatGPT Web UI หรือ browser runtime

- Browser/UI ใช้เป็น reference, capture source, หรือ validation oracle ได้
- ห้ามออกแบบ solution ให้ต้องเปิดหน้าเว็บเพื่อให้ Subagent ทำงาน
- ห้ามสรุปว่า endpoint/UI behavior คือ architecture ของ Zero โดยอัตโนมัติ
- งานหลักคือหา contract ที่ Zero เรียกตรงได้จาก Normal ChatGPT transport

### HAR / Payload = Protocol Evidence สำหรับ ChatGPT Web API Provider

HAR, request payload, response payload, SSE, headers และ network capture ที่ป๊าส่งให้ ต้องตีความเป็นหลักฐานของ protocol ที่ chatgpt.com ใช้จริง แล้วนำมา map ลงชุด API ของ Zero ที่ `src/providers/chatgpt`

ลำดับที่ถูกต้องคือ:
`HAR/Payload -> ถอด request/response contract -> เทียบ provider ปัจจุบัน -> เพิ่ม/แก้ primitive ใน src/providers/chatgpt -> ให้ CLI/orchestrator เรียกใช้`

ไม่ใช่:
`HAR/Payload -> ไล่ React/UI -> ทำ Zero ให้พึ่งหน้าเว็บ`

ดังนั้นเมื่อมี capture ใหม่ ให้ตรวจ provider layer ก่อนเสมอว่า endpoint/body/header/SSE/state transition ใดควรถูกนำมาใช้กับ ChatGPT Web API ของ Zero

คำว่า UI ใน acceptance discussion หมายถึง sanity check ต่อ claim ว่า native Subagent สำเร็จจริง:
ถ้า backend สร้าง relation/activity ที่ระบบ Web-native รู้จักจริง ต้องมี observable consequence ที่สอดคล้องกัน หรือมี error/unsupported state ที่อธิบาย mismatch ได้
UI ไม่ใช่ requirement ของ Zero API และไม่ใช่ dependency ของ implementation

---

## 3. Single ChatGPT Web Architecture

เป้าหมายสุดท้ายของ Zero คือมี ChatGPT Web provider ตัวเดียวเป็นแกนของระบบ:

`src/providers/chatgpt`

สิ่งที่ต้องตัดออกจาก architecture เป้าหมาย:
- Work Mode / TPP execution path
- Flora ในฐานะ mode ที่ต้องสลับเข้าไปใช้
- Codex-specific branch / naming / dependency
- worker conversation แยกแบบ `6aa... -> 6aa...` เพื่อจำลอง agent
- orchestration layer ที่บังคับให้ agent ต้องเป็นอีก ChatGPT conversation หนึ่ง

รายการ `agent_spawn / agent_return / agent_say / agent_reply / agent_check / agent_status / agent_list` ที่มีอยู่ปัจจุบันให้ถือเป็น **legacy Zero agent orchestration** จนกว่าจะพิสูจน์ Native ChatGPT Web subagent contract ได้

เป้าหมายไม่ใช่เพิ่ม provider ใหม่ แต่คือให้ ChatGPT Web provider เดียวรองรับทั้ง:
- conversation primitives
- native subagent primitives

identity ต้องแยกตาม protocol จริง:
- parent conversation/message ใช้ ChatGPT Web IDs จริง
- native child ใช้ native thread identity จริง เช่น `01a0...`
- ห้ามสร้าง worker conversation UUID ใหม่แล้วเรียกว่า native child

เมื่อตรวจพบ native contract ที่ถูกต้องแล้ว ค่อยตัดสินใจว่าจะ deprecate หรือ remap คำสั่ง `agent_*` เดิมไปยัง primitive ใหม่ โดยห้ามคง semantics แบบ worker-conversation เดิมไว้เงียบ ๆ

---

## 4. เป้าหมาย Native Subagent ที่ป๊าต้องการ

USE ที่ต้องการคือ:

Normal ChatGPT conversation
-> ผู้ใช้สั่ง “ให้ subagent ทำงานนี้”
-> ระบบสร้าง Native Subagent จริง
-> child มี native thread identity
-> child มีสถานะ waiting/working/completed/failed
-> child ผูกกับ parent turn/conversation อย่างตรวจสอบได้
-> parent รู้ว่า child ไหนถูกสร้าง
-> result กลับ parent
-> ผู้ใช้สามารถเปิดดู/ตรวจสอบ child ได้

เป้าหมายนี้ต้องเกิดโดยที่ parent ยังเป็น Normal ChatGPT

ข้อห้ามของ target:
- ห้ามเข้า Work Mode
- ห้าม `conversation_origin=tpp`
- ห้าม `conversation_origin=flora`
- ห้ามสร้าง ChatGPT worker conversation อีกห้องแล้วเรียกว่า Native Subagent

คำว่า “เอา logic ของ Work มาใช้” หมายถึง:
เอา lifecycle/behavior ของ subagent มาใช้
ไม่ใช่เอา Work transport / Work origin / Work UI mode มาใช้

สิ่งที่ต้องการจาก Work คือ semantics:
spawn -> child identity -> lifecycle -> result -> parent relation

ไม่ใช่:
TPP / Flora / Work execution surface

---

## 5. สถานะหลักฐานปัจจุบัน

VERIFIED:
- Work/TPP family มี Native Subagent จริง
- Native child ใช้ thread identity แบบ `01a0...`
- parent messages สามารถมี metadata เช่น
  - `codex_collab_agent_tool_call`
  - `codex_sub_agent_activity`
  - `receiverThreadIds`
  - `agentThreadId`
- Web มี CodexSubagentsSidebar / CodexSubagentsModal
- Web มี endpoint อ่าน child turns: `/backend-api/flora/subagent/thread/turns`

แต่หลักฐานข้างต้นเป็นของ Work-family surface
ยังใช้ยืนยัน target “Normal ChatGPT native subagent” ไม่ได้

INVALID FOR TARGET:
- การทดลองที่ใส่ `conversation_origin=flora`
- การทดลองที่ใส่ `conversation_origin=tpp`
- การสรุปว่า child `01a0...` เกิดแล้ว = target สำเร็จ
- การสร้าง Zero command ใหม่แล้วฝัง Flora เพื่อเลียน Subagent
- การสร้าง worker conversation `6aa...` แล้วเรียกแทน Native Subagent

ผลจาก Flora/TPP ใช้เป็น reference/control ได้
แต่ห้ามถือเป็น implementation ของ target

---

## 6. UNKNOWN ที่ต้องหา

คำถามหลัก:

Normal ChatGPT
`conversation_mode = primary_assistant`
ไม่มี TPP
ไม่มี Flora
-> ต้องมี capability / tool contract อะไร
-> จึงทำให้ model/runtime เห็น native collaboration tools
-> และสามารถ spawn Native Subagent ได้

ให้ถือจุดนี้เป็น `UNKNOWN / NEXT`

สิ่งที่ต้องหาอาจอยู่ใน:
- capability registration
- tool surface
- hidden request contract
- server-side feature entitlement/state
- model/tool contract
- prepare/send response metadata
- conversation/runtime state

ห้ามเดาว่า model slug หรือ prompt อย่างเดียวเป็นคำตอบ
ต้องพิสูจน์ด้วย A/B และหา first divergence

---

## 7. ลำดับงานที่ถูกต้อง

ลำดับ:
1. อ่าน source / captures / Plan / logic เดิมก่อน
2. แยก FACT / VERIFIED / UNKNOWN
3. เปรียบเทียบ Normal vs Work แบบ offline ให้แคบก่อน
4. หา candidate ที่อาจเปิด native tool surface
5. 1 hypothesis -> 1 controlled test
6. ใช้ conversation test เดิมเมื่อทำได้
7. ห้ามสร้าง chat ใหม่พร่ำเพรื่อ
8. ห้ามยิงหลาย model/prompt แบบสุ่ม
9. พิสูจน์ API contract ก่อน
10. เมื่อ API ถูกแล้วค่อยตรวจ UI
11. เมื่อ test ผ่านและป๊าอนุมัติ จึง integrate เข้า `src/`
12. regression + update Plan หลังงานสำคัญ

---

## 8. เกณฑ์ SUCCESS ของ Native Subagent ใน Normal

ยังห้ามเรียก “success” ถ้าผ่านแค่ backend spawn

ต้องผ่านครบอย่างน้อย:
- parent เป็น Normal ChatGPT จริง
- request ไม่เปลี่ยนเข้า Work/TPP/Flora
- native child ถูกสร้างจริง
- มี native child identity
- parent/child relation อ่านกลับได้
- lifecycle status อ่านได้
- child result อ่านได้
- result กลับ parent ตาม contract
- หลังจบ parent ยังคงเป็น Normal ChatGPT
- API reproducible โดยไม่พึ่ง probe แบบสุ่ม

UI validation ทำหลัง API contract นิ่ง:
- Web มองเห็น subagent relation
- มี Subagent activity/sidebar/modal ตาม behavior ที่ native Web รองรับ
- เปิด child แล้วอ่าน thread/turns ได้

---

## 9. กติกาการทดลอง

- ทดสอบก่อนนำเข้าจริง
- ห้ามแก้ `src/` จากผล probe รอบเดียว
- scratch/probe ทั้งหมดอยู่ใน `.zero/`
- ไฟล์สำคัญต้อง backup ก่อนแก้
- ใช้หลักฐานเดิมก่อนยิง request ใหม่
- ลด token / chat spam
- reuse ห้องทดลองเดิม
- หยุดเมื่อข้อมูลเพียงพอ ไม่ยิงเพื่อความมั่นใจซ้ำ ๆ
- ถ้าผลขัดกัน ให้หาสาเหตุ/replica/timing ก่อนสรุป
- แยก “backend behavior” ออกจาก “full user-visible feature”
- report/checkpoint ไม่ใช่ Source of Truth; runtime/source จริงมี authority สูงกว่า

---

## 10. H1 live result — 2026-09-19

H1 ที่ทดสอบ:
Replay ชุด payload Work ที่เป็น generic/capability fields ให้ครบที่สุดบน existing Normal conversation โดยตัด `conversation_origin=tpp` และ `flora` ออกทั้งหมด

ใช้ห้องสะอาดเดิม:
`6aac8b48-a854-83ec-a15c-f29f472f6e7e`

ส่ง:
- requested model = `gpt-5.6-terra-wm`
- thinking_effort = `min`
- `local_function_names=["local.continue_in_work"]`
- `force_parallel_switch=auto`
- `paragen_cot_summary_display_override=allow`
- Web payload parity fields ครบ
- conversation_origin = ไม่ส่ง

ผล VERIFIED:
- conversation-level `conversation_origin` ยังคง `null`
- turn ถูก commit จริง
- backend resolve assistant model เป็น `gpt-5-6` ไม่ใช่ requested `gpt-5.6-terra-wm`
- parent assistant ตอบ marker เอง
- ไม่มี `SubAgentActivityThreadItem.started`
- ไม่มี `CollabAgentToolCallThreadItem.*`
- ไม่มี `SubAgentActivityThreadItem.completed`

สรุป:
`H1 = FAILED`
full non-origin Work-like payload combination ไม่พอเปิด native subagent tool surface
ห้ามยิง H1 ซ้ำ

First divergence ที่มีน้ำหนักตอนนี้:
Work request resolve `gpt-5.6-terra-wm` + native collaboration tools แต่ Normal direct requestที่ตัด Work origin resolve กลับ `gpt-5-6` และไม่มี collaboration tools

## 11. Next ที่ถูกต้องตอนนี้

Normal ChatGPT transport/payload parity: ใช้เป็น BASE

งานต่อ:
- diff Work HAR กับ Normal Web API ที่ระดับ init / prepare / request headers / server model resolution
- หา server-side capability/gate ที่ทำให้ `terra-wm` และ native collaboration tools ถูก provision
- ยังไม่ยิง live hypothesis ใหม่จน offline evidence เหลือ candidate ใหม่จริง
- ห้ามใช้ TPP/Flora เป็น final solution
- ห้ามสร้าง conversation ใหม่เพื่อ probe โดยไม่จำเป็น

เป้าหมายสุดท้าย:
`ChatGPT Web provider เดียว + Native Subagent USE semantics`
โดยไม่พึ่ง Work Mode / TPP / Flora / Codex-specific branch
