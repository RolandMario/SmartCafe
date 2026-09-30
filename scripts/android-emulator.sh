#!/bin/bash
# Android emulator helper — boots the Android emulator (if needed) and opens the
# SmartCafe mobile app on it via Expo.
# Location: ./scripts/android-emulator.sh
set -euo pipefail

export JAVA_HOME="$HOME/Library/Java/JavaVirtualMachines/zulu17.68.203-ca-jdk17.0.20.1-macosx_aarch64/Contents/Home"
export ANDROID_HOME="/opt/homebrew/share/android-commandlinetools"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"

AVD="expo_test"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ADB="$ANDROID_HOME/platform-tools/adb"

if ! "$ADB" devices | grep -q 'emulator-5554'; then
  echo "Booting Android emulator ($AVD)…"
  nohup "$ANDROID_HOME/emulator/emulator" -avd "$AVD" > /tmp/emulator-boot.log 2>&1 &
  echo "Emulator is booting (takes ~60–90s on first run). Log: /tmp/emulator-boot.log"
  for i in $(seq 1 30); do
    "$ADB" devices | grep -q 'emulator-5554' && break
    sleep 3
  done
  "$ADB" devices | grep -q 'emulator-5554' || { echo "Emulator did not come online — see /tmp/emulator-boot.log"; exit 1; }
fi

echo "Emulator online. Starting Expo (press Ctrl+C to stop)."
cd "$ROOT/mobile"
exec npx expo start --android