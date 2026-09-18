# SCB PI Token Gateway — phone-server

ตั้งมือถือ + เชื่อม PI gateway สำหรับ **SCB.Anywhere (com.scb.corporate)**

## ก่อนรัน (มือถือ)

1. USB debugging เปิด (จะถูก bypass โดย module)
2. ติดตั้ง **SCB.Anywhere จาก Play Store** (ยังไม่ patch)
3. Google account + Play Store พร้อม (Play Integrity)

## รัน

```bash
./setup-linux.sh       # Linux
./setup-macos.sh       # macOS
```

วันถัดไป:
```bash
./setup-linux.sh --connect
```

## สิ่งที่ script ทำ

| ลำดับ | งาน |
|-------|-----|
| 1 | สร้าง keystore (ถ้ายังไม่มี) |
| 2 | build pi-token-gateway module |
| 3 | NPatch + sign + install patched APK |
| 4 | เปิดแอป + รอ bootstrap |
| 5 | `adb forward tcp:28765` + health check |

## API

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/health` | — | `{"status":"ok","package":"com.scb.corporate"}` |
| POST | `/get-token` | `{"nonce":"<string>"}` | `{"token":"..."}` |

nonce รับ raw string (module encode เป็น Base64 URL_SAFE ให้เอง เหมือน app จริง)

## Bypass: USB Debugging

Module hook `Settings.Global.getInt`:
- `adb_enabled` → 0 (USB debugging)
- `adb_wifi_enabled` → 0 (Wireless debugging)

ถ้า V-OS ตรวจที่ native level → ต้องใช้ Wireless ADB แล้วปิด USB debug ในตัวเลือกนักพัฒนา

## ต้องมีบน PC

`adb`, `java`, `curl`, Android SDK build-tools, `tools/npatch/npatch.jar`
