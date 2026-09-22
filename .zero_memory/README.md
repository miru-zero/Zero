# ZERO MEMORY — ENTRYPOINT

ตำแหน่ง: `M:\Zero_LLM\Zero-ChatGPT\.zero_memory`

โฟลเดอร์นี้คือ **จุดแรกที่ต้องอ่านก่อนเริ่มงานหรือต่องาน Zero**
ห้ามเริ่มจากความจำของโมเดล, summary เก่า, หรือข้อความท้ายแชทอย่างเดียว

เป้าหมายของ `.zero_memory`:
- เก็บ logic ความเข้าใจที่ยังมีผล
- เก็บ current working state ที่ผ่านการ verify
- เก็บ decision / scope lock / invariant
- เก็บ pointer ไปยังหลักฐานจริง
- ช่วยให้ห้องใหม่ reconstruct งานได้โดยไม่เดา

หลักใหญ่:
`zero_memory = working memory / navigation layer`
ไม่ใช่ source of truth สูงสุด

Source of truth สูงสุดยังเป็น:
runtime จริง + source จริง + capture/log จริง + conversation จริง
---

## 1. ลำดับการอ่านบังคับ

เมื่อเข้ามาทำงาน Zero ให้ใช้ลำดับนี้:

1. อ่าน `.zero_memory/README.md`
2. อ่าน `.zero_memory/LOGIC.md`
3. อ่านไฟล์ current-state ใน `.zero_memory` ถ้ามี
4. อ่านไฟล์ decision / handoff / evidence index ที่เกี่ยวข้อง ถ้ามี
5. จากนั้นค่อยอ่าน `Plan/README.md` และ Plan ที่เกี่ยวข้อง
6. เปิด source code / runtime / logs เพื่อ revalidate จุดที่จะทำต่อ
7. ถ้ายังมีช่องว่าง ค่อย rehydrate จาก raw conversation จริง
8. เมื่อได้ authoritative state แล้วจึงลงมือทำ NEXT จริง

ห้าม:
- กระโดดจาก README ไปแก้ source ทันที
- ใช้ memory แทน live verification ในจุดที่ state เปลี่ยนได้
- เดา missing state จากข้อความล่าสุด
---

## 2. บทบาทของไฟล์ใน zero_memory

ไฟล์หลักปัจจุบัน:

### `LOGIC.md`
เก็บ mental model / semantics / invariants ของระบบ
เนื้อหาควรเปลี่ยนช้า และใช้ข้ามห้องได้

ตัวอย่าง:
- มองระบบแบบ USE ก่อน implementation
- Normal ChatGPT transport = BASE/FREEZE
- Conversation DAG != Agent Task Tree
- เป้าหมาย Native Subagent แบบไม่ผ่าน Work

ไฟล์ที่อาจเพิ่มภายหลังเมื่อจำเป็น:
- `STATE.md` = verified working state ล่าสุด
- `NEXT.md` = งานถัดไปที่อนุมัติแล้ว
- `DECISIONS.md` = decision ที่ยังมีผล
- `EVIDENCE.md` = pointer ไป logs/captures/source
- `FAILED.md` = failed approaches ที่ห้ามทำซ้ำ
- `HANDOFF.md` = state สำหรับส่งงานข้ามห้อง
ไม่จำเป็นต้องสร้างทุกไฟล์ล่วงหน้า
สร้างเฉพาะเมื่อมีข้อมูลจริงที่ควรเก็บ

---

## 3. Authority / ความน่าเชื่อถือ

เมื่อข้อมูลขัดกัน ให้เรียง authority แบบนี้:

1. Live runtime evidence
2. Current source code / current config
3. Raw capture / raw log / raw conversation
4. Verified zero_memory state ที่มี provenance
5. Plan / report / docs
6. Summary จากห้องก่อน
7. Model memory / การคาดเดา

กฎ:
- report ไม่ใช่ SoT
- memory ไม่ override หลักฐานสด
- metadata เวลา modified ไม่พอ ต้องดู content ด้วย
- ถ้า source เปลี่ยน ต้อง revalidate memory ที่เกี่ยวข้อง

ถ้าไม่แน่ใจ:
ใช้คำว่า `UNKNOWN` แล้วไปอ่านหลักฐานจริง
ห้ามเติมช่องว่างเอง
---

## 4. วิธีอ่านแบบ Rolling Working Memory

สำหรับ conversation / log / history ยาว:

1. อ่านตาม chronology เป็นช่วง
2. สกัดเฉพาะ CORE ที่ยังมีผล
3. compact สิ่งที่อ่านและเข้าใจแล้ว
4. อ่านช่วงถัดไป
5. ทำซ้ำจนถึงข้อความล่าสุด
6. resolve instruction ที่ supersede กัน
7. สร้าง authoritative working state
8. live revalidate จุดที่ runtime อาจเปลี่ยน
9. ทำงานต่อจาก NEXT จริง

CORE ที่ควรเก็บ:
- VERIFIED FACT
- current state
- active decisions
- scope locks
- blockers
- NEXT
- IDs / paths / hashes / cursors
- failed approaches ที่ห้ามทำซ้ำ
- provenance / source pointer
สิ่งที่ไม่ควรกองใน active memory:
- small talk
- reasoning ที่ไม่ก่อ decision
- duplicate output
- intermediate log ที่มี final result แล้ว
- superseded instruction
- falsified hypothesis ที่ไม่เกี่ยวกับ current state

---

## 5. วิธีอัปเดต zero_memory

ก่อนเขียน:
1. อ่านไฟล์เดิมก่อน
2. ตรวจว่า claim ใหม่มีหลักฐานอะไร
3. แยก FACT / VERIFIED / HYPOTHESIS / UNKNOWN
4. ตรวจว่า claim ใหม่ supersede ของเก่าหรือแค่เพิ่มรายละเอียด

เวลาเขียน:
- แก้เฉพาะส่วนที่เกี่ยว
- ห้ามลบ historical decision ที่ยังมีผลโดยไม่อธิบาย
- ถ้า supersede ให้ระบุว่าอะไรถูกแทนที่
- ใส่ IDs / path / file / log pointer เมื่อจำเป็น
- อย่าใส่ secret/token/cookie ลง memory
หลังเขียน:
- อ่านกลับ verify formatting/content
- ถ้าเป็นไฟล์สำคัญ ให้ backup ก่อนแก้
- ห้ามถือว่า memory update = งาน runtime สำเร็จ
- งานสำเร็จต้องมี execution evidence แยกต่างหาก

---

## 6. วิธีใช้ zero_memory ตอน Takeover

เมื่อรับงานจากอีกห้อง:

`.zero_memory`
→ อ่าน LOGIC / STATE / NEXT
→ เปิด source conversation จริงเมื่อจำเป็น
→ audit claim กับ tool evidence
→ หา latest verified checkpoint
→ live revalidate runtime
→ ทำ NEXT จริง

ห้าม takeover แบบ:
อ่านข้อความท้าย ๆ → เชื่อ summary → พูดตาม → ไม่ทำงานต่อ

Takeover ที่ถูกต้องคือ:
`history -> evidence -> authoritative state -> NEXT -> execution`
---

## 7. กฎสำหรับงานทดลอง

ก่อนยิง live probe:
- อ่าน zero_memory ก่อน
- ใช้หลักฐานเดิมก่อน
- 1 hypothesis = 1 controlled test
- reuse conversation/test fixture เดิมเมื่อทำได้
- ห้าม spam สร้าง chat ใหม่
- ห้ามสุ่มหลาย model/prompt โดยไม่มีเหตุผล
- scratch ทั้งหมดอยู่ใน `.zero/`

ก่อนนำเข้าจริง:
- API/contract ต้องนิ่ง
- acceptance criteria ต้องผ่าน
- ป๊าต้องอนุมัติให้ integrate
- แล้วค่อยแก้ `src/` + regression

ทดลองผ่านบางส่วน ≠ feature success

---

## 8. กฎสำหรับ AI ห้องใหม่

เมื่อเห็น repo นี้ ให้ถามตัวเองก่อนเสมอ:

`มี .zero_memory ไหม?`

ถ้ามี:
อ่าน `.zero_memory/README.md` ก่อน
แล้วอ่าน `.zero_memory/LOGIC.md`

ห้ามตอบว่า “จำไม่ได้” หรือเดา architecture
ถ้ายังไม่ได้อ่าน memory/source ที่มีอยู่
---

## 9. ความสัมพันธ์กับ Plan

`.zero_memory`
= working understanding / handoff / continuity

`Plan/`
= roadmap / status / engineering plan

`src/`
= implementation

`runtime/`, logs, captures
= execution evidence

`.zero/`
= scratch / probes / temporary artifacts

ดังนั้นลำดับทั่วไปคือ:

`zero_memory -> Plan -> source/runtime -> raw history (เมื่อจำเป็น) -> execution`

ไม่ใช่:
`Plan/report -> เดา -> แก้ source`

---

## 10. Current entrypoint

ตอนนี้ logic หลักอยู่ที่:

`.zero_memory/LOGIC.md`

เริ่มงาน Zero ครั้งถัดไป:
1. อ่านไฟล์นี้
2. อ่าน `LOGIC.md`
3. เช็ก current repo/runtime state
4. แล้วจึงทำงานต่อ
