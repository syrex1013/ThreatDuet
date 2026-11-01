#!/usr/bin/env bash
# Builds the release APK, macOS app, and (when possible) Windows installer into builds/.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

VERSION="$(node -p "require('./package.json').version")"
OUT="builds"
[ -f android/keystore.properties ] || { echo "android/keystore.properties is missing: the APK can't be signed." >&2; exit 1; }

# Keep package.json and the Android versionName in lockstep (0.2.8 shipped with 0.2.7 once).
ANDROID_NAME="$(node -p "const fs=require('fs'); const t=fs.readFileSync('android/app/build.gradle','utf8'); const m=t.match(/versionName\\s+\"([^\"]+)\"/); if(!m) process.exit(2); m[1]")"
ANDROID_CODE="$(node -p "const fs=require('fs'); const t=fs.readFileSync('android/app/build.gradle','utf8'); const m=t.match(/versionCode\\s+(\\d+)/); if(!m) process.exit(2); m[1]")"
if [ "$ANDROID_NAME" != "$VERSION" ]; then
  echo "android/app/build.gradle versionName is $ANDROID_NAME but package.json is $VERSION. Bump both together." >&2
  exit 1
fi
if ! [[ "$ANDROID_CODE" =~ ^[0-9]+$ ]]; then
  echo "android/app/build.gradle versionCode is missing." >&2
  exit 1
fi

bun run build
bun run test
bunx --bun cap sync android
(cd android && ./gradlew assembleRelease)
bunx electron-builder --mac --publish never

# Windows NSIS from macOS: works without Wine when signAndEditExecutable is false (see package.json).
WIN_OK=0
if bunx electron-builder --win --x64 --publish never; then
  WIN_OK=1
else
  echo "Windows installer build failed or was skipped; continuing with macOS + Android." >&2
fi

rm -rf "$OUT"
mkdir -p "$OUT"
cp android/app/build/outputs/apk/release/app-release.apk "$OUT/ThreatDuet-$VERSION.apk"
ditto release/mac-arm64/ThreatDuet.app "$OUT/ThreatDuet.app" # ditto keeps the bundle's signature intact
cp "release/ThreatDuet-$VERSION-arm64.dmg" "$OUT/"
cp "release/ThreatDuet-$VERSION-arm64-mac.zip" "$OUT/"
cp scripts/install-android.sh "$OUT/"
chmod +x "$OUT/install-android.sh"

SUMS=("ThreatDuet-$VERSION.apk" "ThreatDuet-$VERSION-arm64.dmg" "ThreatDuet-$VERSION-arm64-mac.zip")
if [ -f "release/ThreatDuet-Setup-$VERSION.exe" ]; then
  cp "release/ThreatDuet-Setup-$VERSION.exe" "$OUT/"
  SUMS+=("ThreatDuet-Setup-$VERSION.exe")
elif [ "$WIN_OK" = 1 ]; then
  echo "Windows build reported success but release/ThreatDuet-Setup-$VERSION.exe is missing." >&2
  exit 1
fi

codesign --verify --deep --strict "$OUT/ThreatDuet.app"
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
APKSIGNER="$(ls -d "$SDK"/build-tools/*/ | sort -V | tail -1)apksigner"
"$APKSIGNER" verify "$OUT/ThreatDuet-$VERSION.apk"
(cd "$OUT" && shasum -a 256 "${SUMS[@]}" > SHA256SUMS.txt)

echo "Release $VERSION in $OUT/:"
ls -1 "$OUT"
