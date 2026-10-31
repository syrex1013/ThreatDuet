#!/usr/bin/env bash
# Builds the release APK and the macOS app, and collects them in builds/ with the Android installer.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

VERSION="$(node -p "require('./package.json').version")"
OUT="builds"
[ -f android/keystore.properties ] || { echo "android/keystore.properties is missing: the APK can't be signed." >&2; exit 1; }

npm run build
npm test
npx cap sync android
(cd android && ./gradlew assembleRelease)
npx electron-builder

rm -rf "$OUT"
mkdir -p "$OUT"
cp android/app/build/outputs/apk/release/app-release.apk "$OUT/OpenDuet-$VERSION.apk"
ditto release/mac-arm64/OpenDuet.app "$OUT/OpenDuet.app" # ditto keeps the bundle's signature intact
cp "release/OpenDuet-$VERSION-arm64.dmg" "$OUT/"
cp scripts/install-android.sh "$OUT/"
chmod +x "$OUT/install-android.sh"

codesign --verify --deep --strict "$OUT/OpenDuet.app"
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
APKSIGNER="$(ls -d "$SDK"/build-tools/*/ | sort -V | tail -1)apksigner"
"$APKSIGNER" verify "$OUT/OpenDuet-$VERSION.apk"
(cd "$OUT" && shasum -a 256 "OpenDuet-$VERSION.apk" "OpenDuet-$VERSION-arm64.dmg" > SHA256SUMS.txt)

echo "Release $VERSION in $OUT/:"
ls -1 "$OUT"
