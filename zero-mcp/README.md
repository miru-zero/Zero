# Zero MCP

`M:\\Zero_MCP` คือศูนย์ทะเบียนและ runtime ของ tools/providers ที่ Zero เรียกใช้
Zero CLI/router ยังอยู่ที่ `M:\\Zero_LLM\\Zero-ChatGPT` และ scan provider จากที่นี่

## Layout

```text
M:\\Zero_MCP\\
├─ providers\\
│  ├─ chatgpt\\
│  ├─ rewjava\\
│  ├─ computeruse\\
│  ├─ desktopcommander\\
│  └─ devtools\\
├─ shared\\
├─ state\\
├─ cache\\
├─ logs\\
└─ docs\\
```

หนึ่ง provider = หนึ่ง directory ใต้ `providers` และต้องมี `provider.json`
## Boundary

- `providers/<name>/provider.json` = registration + launch contract
- `providers/<name>/runtime/` = source/runtime ของ provider เมื่อ Zero เป็นผู้ดูแลไฟล์นั้น
- `shared/` = component ที่หลาย provider ใช้ร่วมกัน
- `state/` = persistent runtime state; ไม่ใช่ source code
- `cache/` = generated cache; ลบแล้วสร้างใหม่ได้
- `logs/` = runtime logs
- `docs/` = contract และ architecture ของ MCP center

`chatgpt` เป็น internal provider จึงมี manifest แต่ implementation อยู่ใน Zero-ChatGPT
`computeruse` ยังอ้าง source Git submodule ใน Zero-ChatGPT เพื่อไม่ทำลาย git metadata ระหว่าง migration

## Discovery

Zero อ่าน `runtime/zero.config.json` แล้วใช้ `mcpRoot` scan:

```text
{mcpRoot}/providers/*/provider.json
```

เพิ่ม MCP ใหม่ = สร้าง provider directory + `provider.json`; ไม่ต้องแก้ CLI router