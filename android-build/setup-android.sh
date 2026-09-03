#!/usr/bin/env bash
# Regenerates the Capacitor Android project for ../arena-app and applies our overlay
# (app name, dark theme, adaptive icons, splash). Safe to re-run.
set -euo pipefail
cd "$(dirname "$0")"

npm install --no-audit --no-fund
if [ ! -d android ]; then
  npx cap add android
fi
# copy latest web assets into the native project
npx cap sync android
# overlay our resources on top of the generated template
cp -R overlay/app/. android/app/
# make the manifest match our branding/app id if the template changed it
echo "✔ Android project ready at ./android"
echo "  Debug APK : cd android && ./gradlew assembleDebug   → app/build/outputs/apk/debug/app-debug.apk"
echo "  Release   : cd android && ./gradlew assembleRelease (needs signing config)"
