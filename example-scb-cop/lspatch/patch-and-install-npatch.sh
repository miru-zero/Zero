#!/usr/bin/env bash
# NPatch v1.0.5 + release keystore + optional adb install
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
DIR="$(cd "$(dirname "$0")" && pwd)"
DEFAULT_APK="$ROOT/lab/inbox/SCB-Business-Anywhere-from-device.apk"
INSTALL=false

if   [[ "${1:-}" == "--install" ]]; then INSTALL=true; APK="$DEFAULT_APK"
elif [[ "${2:-}" == "--install" ]]; then INSTALL=true; APK="${1:-$DEFAULT_APK}"
else APK="${1:-$DEFAULT_APK}"; fi

MODULE="$DIR/pi-token-gateway/app/build/outputs/apk/debug/app-debug.apk"
OUT="$DIR/out/npatch"
PROPS="$DIR/keystore.properties"
ZIPALIGN="${ZIPALIGN:-$HOME/Android/Sdk/build-tools/36.1.0/zipalign}"

[[ -f "$APK" ]]    || { echo "error: ไม่พบ APK: $APK" >&2; exit 1; }
[[ -f "$MODULE" ]] || { echo "error: build module ก่อน (pi-token-gateway)" >&2; exit 1; }
[[ -f "$PROPS" ]]  || { echo "error: รัน setup-scb-keystore.sh ก่อน" >&2; exit 1; }
[[ -x "$ZIPALIGN" ]] || { echo "error: ไม่พบ zipalign: $ZIPALIGN" >&2; exit 1; }
[[ -f "$ROOT/tools/npatch/npatch.jar" ]] || {
  echo "error: ไม่พบ tools/npatch/npatch.jar — https://github.com/7723mod/NPatch/releases" >&2; exit 1; }

if unzip -l "$APK" 2>/dev/null | grep -qE 'assets/(lspatch|npatch)/'; then
  echo "error: APK เป็น patched แล้ว — ดึงใหม่จาก Play Store" >&2; exit 1; fi

mkdir -p "$OUT"

ALIGNED="$OUT/scb-3.9.0-aligned.apk"
"$ZIPALIGN" -f -p 4 "$APK" "$ALIGNED"

"$ROOT/tools/npatch.sh" -f -m "$MODULE" -l 0 -o "$OUT" "$ALIGNED"
PATCHED_RAW="$(ls -t "$OUT"/*npatched*.apk | head -1)"
PATCHED="${PATCHED_RAW%.apk}-signed.apk"
"$DIR/sign-apk.sh" "$PATCHED_RAW" "$PATCHED"
echo "[+] $PATCHED"

if $INSTALL; then
  if adb shell pm path com.scb.corporate >/dev/null 2>&1; then
    echo "[*] ถอน com.scb.corporate ก่อน"
    adb uninstall com.scb.corporate
  fi
  adb install -r "$PATCHED"
  echo "[*] เปิดแอปครั้งแรก รอ ~20 วิ (NPatch extract)"
  echo "    adb forward tcp:28765 tcp:28765 && curl -s http://127.0.0.1:28765/health"
fi
