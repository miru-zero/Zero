# vendor/ — ของ third-party ทั้งหมดอยู่ที่นี่ที่เดียว

กติกา:
- โค้ด/binary ที่ **เราไม่ได้เขียน** ต้องอยู่ใต้ `vendor/` เท่านั้น ห้ามแก้ไฟล์ข้างในโดยตรง (ถ้าต้อง patch ให้ fork ไปเป็นโปรเจ็คของเราแทน)
- ทุกตัวต้องลงทะเบียนในตารางด้านล่าง + ประกาศใน `runtime/zero.config.json` (path แบบ relative จาก repo root เท่านั้น ห้าม absolute — กันย้ายเครื่องแล้วพัง)
- exe ที่ commit ไว้คือ build สำหรับ Windows x64 — ย้ายเครื่อง/arch อื่นต้อง build ใหม่ตามคอลัมน์ build

## ทะเบียน

| ตัว | ที่มา | เวอร์ชัน | license | build | artifact ที่ใช้จริง |
|---|---|---|---|---|---|
| Mcp.ComputerUse | https://github.com/tdav/Mcp.ComputerUse | v0.1.0 (+ แพตช์ของเรา: เพิ่ม tools เป็น 20 ตัว) | ยังไม่ได้ประกาศ (upstream บอกเอง) | `dotnet publish Mcp.ComputerUse.slnx -c Release -r win-x64` (ต้อง export ProgramFiles/ProgramData/APPDATA/DOTNET_ROOT ใน Git Bash ก่อน) | `Mcp.ComputerUse/Mcp.ComputerUse/bin/Release/net10.0-windows/win-x64/mcp-computeruse.exe` |

## คิวที่ยังไม่เอาเข้า (ป๊าสั่ง defer)

- `M:\Zero_Lab\rewjava\mcp-flow` — รอป๊าสั่งนำเข้า อย่าเพิ่งย้ายมา
- browser-use/web-ui — เคยคุยเป็นไอเดีย ยังไม่มีแผน

## ถ้าจะเพิ่มตัวใหม่

1. clone/copy source เข้า `vendor/<ชื่อ>/`
2. build artifact ให้พร้อม
3. เพิ่มแถวในตารางข้างบน (ที่มา/เวอร์ชัน/license/build/artifact)
4. เพิ่ม block ใน `runtime/zero.config.json` แล้ว `zero <ชื่อ>` เช็คว่า listTools ออก
