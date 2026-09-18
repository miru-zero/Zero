#!/usr/bin/env bash
# ponytail: shared logic — sourced by setup-linux.sh / setup-macos.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LSPATCH="$(cd "$HERE/.." && pwd)"
ROOT="$(cd "$LSPATCH/../../../.." && pwd)"
MODULE="$LSPATCH/pi-token-gateway"
PI_PORT=28765
SETUP_NAME="${PHONE_SETUP_NAME:-setup.sh}"
PLATFORM="${PHONE_SERVER_PLATFORM:-linux}"
CONNECT_ONLY=false
ANDROID_SERIAL="${ANDROID_SERIAL:-}"

usage() { cat <<EOF
Usage: ./$SETUP_NAME [options]

  Full new-device pipeline (default):
    keystore → build module → NPatch → install → launch → forward → health

  Options:
    -s, --serial SERIAL   adb device serial
    -c, --connect         วันถัดไป: forward + launch + health เท่านั้น
    -h, --help
EOF
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -s|--serial)  export ANDROID_SERIAL="$2"; shift 2 ;;
      -c|--connect) CONNECT_ONLY=true; shift ;;
      -h|--help)    usage; exit 0 ;;
      *) echo "error: unknown arg: $1" >&2; usage; exit 2 ;;
    esac
  done
}

adb_() { adb "$@"; }

need_cmd() { command -v "$1" >/dev/null 2>&1 || { echo "error: ต้องมี $1 ใน PATH" >&2; exit 1; }; }

resolve_sdk() {
  [[ -n "${ANDROID_HOME:-}" && -d "$ANDROID_HOME" ]] && echo "$ANDROID_HOME" && return
  case "$PLATFORM" in
    macos)   [[ -d "$HOME/Library/Android/sdk" ]]  && echo "$HOME/Library/Android/sdk"  && return ;;
    windows) [[ -n "${LOCALAPPDATA:-}" && -d "$LOCALAPPDATA/Android/Sdk" ]] && echo "$LOCALAPPDATA/Android/Sdk" && return ;;
    *)       [[ -d "$HOME/Android/Sdk" ]] && echo "$HOME/Android/Sdk" && return ;;
  esac
  return 1
}

ensure_android_tools() {
  local sdk bt
  sdk="$(resolve_sdk)" || { echo "error: ไม่พบ Android SDK" >&2; exit 1; }
  export ANDROID_HOME="$sdk"
  bt="$(ls -d "$sdk/build-tools/"* 2>/dev/null | sort -V | tail -1)"
  [[ -n "$bt" ]] || { echo "error: ไม่พบ build-tools" >&2; exit 1; }
  export ZIPALIGN="${ZIPALIGN:-$bt/zipalign}"
  export ANDROID_BUILD_TOOLS="${ANDROID_BUILD_TOOLS:-$bt}"
}

pick_device() {
  need_cmd adb
  mapfile -t devs < <(adb devices | awk '/\tdevice$/{print $1}')
  [[ ${#devs[@]} -gt 0 ]] || { echo "error: ไม่พบ device" >&2; exit 1; }
  if [[ -z "$ANDROID_SERIAL" ]]; then
    [[ ${#devs[@]} -eq 1 ]] || { echo "error: มี ${#devs[@]} เครื่อง — ใช้ -s SERIAL" >&2; printf '  %s\n' "${devs[@]}" >&2; exit 1; }
    export ANDROID_SERIAL="${devs[0]}"
  fi
  echo "[*] device: $ANDROID_SERIAL"
}

wait_health() {
  local url="http://127.0.0.1:$PI_PORT/health" tries="${1:-30}"
  while (( tries > 0 )); do
    curl -sf -m 2 "$url" >/dev/null 2>&1 && curl -s "$url" && return 0
    sleep 2; tries=$((tries - 1))
  done
  return 1
}

launch_scb() {
  adb_ shell monkey -p com.scb.corporate -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 || true
}

forward_pi() {
  adb_ forward --remove "tcp:$PI_PORT" >/dev/null 2>&1 || true
  adb_ forward "tcp:$PI_PORT" "tcp:$PI_PORT" >/dev/null
}

ensure_keystore() {
  [[ -f "$LSPATCH/keystore.properties" ]] || "$LSPATCH/setup-scb-keystore.sh"
}

ensure_npatch() {
  [[ -f "$ROOT/tools/npatch/npatch.jar" ]] || {
    echo "error: ไม่พบ tools/npatch/npatch.jar" >&2; exit 1; }
}

ensure_module() {
  local apk="$MODULE/app/build/outputs/apk/debug/app-debug.apk"
  if [[ -f "$apk" ]]; then echo "[*] module APK มีอยู่แล้ว"; return; fi
  ensure_android_tools
  echo "[*] build pi-token-gateway..."
  (cd "$MODULE" && ./gradlew assembleDebug)
}

main() {
  parse_args "$@"
  pick_device
  need_cmd curl
  forward_pi

  if $CONNECT_ONLY; then
    echo "[*] connect-only: launch + wait health"
    launch_scb; sleep 3
    wait_health 15 || { echo "error: gateway ไม่ตอบ" >&2; exit 1; }
    echo "[+] พร้อม — port $PI_PORT"
    exit 0
  fi

  echo "[*] === SCB phone-server full setup ($PLATFORM) ==="
  echo "[!] ต้องติดตั้ง SCB.Anywhere จาก Play Store (clean) ก่อน"

  ensure_keystore
  ensure_npatch
  ensure_android_tools
  ensure_module

  "$LSPATCH/patch-and-install-npatch.sh" --install

  echo "[*] เปิดแอป + รอ NPatch bootstrap (~20s)"
  launch_scb; sleep 20

  wait_health 20 || {
    echo "[!] health ยังไม่ขึ้น — เปิดแอปมือ แล้วรัน: ./$SETUP_NAME --connect" >&2; exit 1; }

  cat <<EOF

[+] เสร็จ

  PI gateway : http://127.0.0.1:$PI_PORT/health
  ทดสอบ     : curl -s -X POST http://127.0.0.1:$PI_PORT/get-token \\
                 -H 'Content-Type: application/json' \\
                 -d '{"nonce":"your-nonce-here"}'

  วันถัดไป (USB เสียบแล้ว):
    ./$SETUP_NAME --connect

EOF
}

[[ "${BASH_SOURCE[0]}" == "${0}" ]] && main "$@"
