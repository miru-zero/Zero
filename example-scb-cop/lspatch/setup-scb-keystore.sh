#!/usr/bin/env bash
# สร้าง release keystore สำหรับ resign SCB.Anywhere (ห้ามใช้ debug.keystore)
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
KS="$DIR/scb-resign.keystore"
PROPS="$DIR/keystore.properties"
ALIAS=scb

if [[ -f "$KS" ]]; then
  echo "[*] มีอยู่แล้ว: $KS"
  exit 0
fi

DNAME="CN=Mobile Research Lab, OU=Lab, O=Research, L=Bangkok, ST=BK, C=TH"
STORE_PASS="$(openssl rand -hex 12)"
KEY_PASS="$STORE_PASS"

keytool -genkeypair -v \
  -keystore "$KS" \
  -alias "$ALIAS" \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass "$STORE_PASS" -keypass "$KEY_PASS" \
  -dname "$DNAME"

cat >"$PROPS" <<EOF
storeFile=scb-resign.keystore
storePassword=${STORE_PASS}
keyPassword=${KEY_PASS}
keyAlias=${ALIAS}
EOF
chmod 600 "$PROPS" "$KS"

echo "[+] $KS"
echo "[+] $PROPS (gitignore — อย่า commit)"
keytool -list -v -keystore "$KS" -storepass "$STORE_PASS" | grep -E 'Alias name:|Owner:|Valid from'
