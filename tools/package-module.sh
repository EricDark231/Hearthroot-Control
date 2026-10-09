#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION="$(sed -n 's/^version=//p' module.prop | head -1)"
[[ "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?$ ]] || { echo 'Invalid module version'; exit 1; }
[[ -s companion-src/app/build/outputs/apk/debug/app-debug.apk ]] || { echo 'Companion APK missing'; exit 1; }
for file in module.prop service.sh customize.sh webroot/index.html webroot/css/style.css webroot/js/app.js scripts/profiles.sh scripts/apply-integrated.sh scripts/xiaomi-sync.sh scripts/boot-state.sh; do
  [[ -f "$file" ]] || { echo "Missing $file"; exit 1; }
done
for file in service.sh customize.sh scripts/*.sh; do sh -n "$file"; done
APK='companion-src/app/build/outputs/apk/debug/app-debug.apk'
if command -v aapt >/dev/null 2>&1; then
  aapt dump badging "$APK" | grep -q "package: name='dev.hearthroot.companion' versionCode='11' versionName='0.3.7-alpha'" || { echo 'Companion APK version mismatch'; exit 1; }
fi
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/companion"
cp -a module.prop service.sh customize.sh scripts webroot "$STAGE/"
cp "$APK" "$STAGE/companion/Hearthroot-Companion.apk"
mkdir -p dist
OUT="$PWD/dist/Hearthroot-Control-${VERSION}.zip"
rm -f "$OUT"
(cd "$STAGE" && zip -qr -X "$OUT" module.prop service.sh customize.sh scripts webroot companion)
unzip -tq "$OUT"
for file in module.prop service.sh customize.sh scripts/profiles.sh scripts/apply-integrated.sh scripts/xiaomi-sync.sh scripts/boot-state.sh companion/Hearthroot-Companion.apk; do
  unzip -Z1 "$OUT" | grep -Fxq "$file" || { echo "Missing ZIP entry $file"; exit 1; }
done
unzip -p "$OUT" companion/Hearthroot-Companion.apk | sha256sum | cut -d' ' -f1 | grep -Fxq "$(sha256sum "$APK" | cut -d' ' -f1)" || { echo 'APK checksum mismatch'; exit 1; }
echo "PACKAGE=$OUT"
sha256sum "$OUT"
