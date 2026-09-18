#!/usr/bin/env bash
# zipalign + apksigner ด้วย scb-resign.keystore
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
PROPS="$DIR/keystore.properties"
BT="${ANDROID_BUILD_TOOLS:-${HOME}/Android/Sdk/build-tools/37.0.0}"

[[ $# -ge 1 ]] || { echo "Usage: $0 <unsigned.apk> [output.apk]" >&2; exit 2; }
IN="$1"; OUT="${2:-${IN%.apk}-signed.apk}"

[[ -f "$IN" ]]    || { echo "error: ไม่พบ $IN" >&2; exit 1; }
[[ -f "$PROPS" ]] || { echo "error: รัน setup-scb-keystore.sh ก่อน" >&2; exit 1; }
# shellcheck disable=SC1090
source "$PROPS"
KS="$DIR/$storeFile"
[[ -f "$KS" ]]          || { echo "error: ไม่พบ $KS" >&2; exit 1; }
[[ -x "$BT/apksigner" ]] || { echo "error: ไม่พบ apksigner ที่ $BT" >&2; exit 1; }

TMP="$(mktemp -t scb-aligned.XXXX.apk)"
"$BT/zipalign" -f -p 4 "$IN" "$TMP"
"$BT/apksigner" sign \
  --ks "$KS" --ks-pass "pass:${storePassword}" \
  --ks-key-alias "$keyAlias" --key-pass "pass:${keyPassword}" \
  --out "$OUT" "$TMP"
rm -f "$TMP"
echo "[+] $OUT"
