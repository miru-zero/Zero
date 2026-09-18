# [ ZERO CHATGPT / SESSION MEMORY ]

เป้าหมาย:

- ระบบที่กำลังทำเกี่ยวกับ ChatGPT โดยตรง
- ไม่ใช่ OpenAI API Platform
- เป้าหมายคือ ChatGPT Web Conversation Transport + MCP Orchestrator
- ให้ห้อง ChatGPT หลายห้อง call / send / research / review / return result หากันได้

ChatGPT Session:

- ใช้ ChatGPT account/session จริงของป๊าในการ integration test
- Auth จริง เช่น accessToken / Bearer / Cookie / session headers ใช้เป็น runtime fixture จริง
- conversation_id / current_node / parent_message_id เป็น state จริงของ conversation
- การไม่ใช้ Auth จริงพิสูจน์ได้แค่ mock/unit test ไม่ใช่ end-to-end

Session lifecycle:

- ห้าม logout / revoke / clear authenticated session ระหว่าง flow ที่ยังไม่ SUCCESS
- ต้องรักษา session continuity จน integration milestone ผ่าน
- ค่อย cleanup / logout / rotate session หลังปิด milestone
- สิ่งที่ต้องป้องกันคือ hardcode, commit หรือ secret รั่วใน log
- ไม่ใช่ห้ามใช้ credential จริงในการทดสอบ

Success criterion:

REAL ChatGPT auth
→ GET conversation จริง
→ current_node / parent_message_id จริง
→ SEND จริง
→ stream/response จริง
→ conversation เดิมเดินต่อจริง
→ room-to-room จริง
→ result กลับ MAIN จริง

Architecture:

ChatGPT Web Rooms
↕
ChatGPT Session Transport
↕
MCP / Central Orchestrator
↕
MAIN / Worker / Research / Reviewer

Reference:

- chat2api-CLI ใช้ ChatGPT web/session เป็น upstream
- คำว่า OpenAI-compatible ใน repo หมายถึง interface ที่ wrapper สร้างขึ้น
  ไม่ได้หมายถึงการใช้ OpenAI API Platform

Docs:

- [docs/tools-hub.md](docs/tools-hub.md) — zero tools hub: ศูนย์กลางเรียก tool ทุก provider
  (host ตอนนี้ = CLI; คำสั่ง, config, exit codes, วิธีเพิ่ม provider, quirk ที่เจอแล้ว)