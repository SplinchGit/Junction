#!/usr/bin/env bash
# Installs and launches the built APK on the CI emulator. android-emulator-runner
# executes each `script:` line separately under /bin/sh, so the logic lives here.
set -euo pipefail
apk="${1:?usage: android-emulator-smoke.sh APK}"
package=com.splinch.junction
activity="$package/.app.MainActivity"
fail() { echo "$1"; adb logcat -d -t 2000 || true; exit 1; }

test -s "$apk" || fail "APK missing or empty: $apk"
adb install -r "$apk"
adb shell pm path "$package"

launch_output="$(adb shell am start -W -n "$activity" 2>&1)" || { printf '%s\n' "$launch_output"; fail "Launch command failed."; }
printf '%s\n' "$launch_output"
grep -q 'Status: ok' <<<"$launch_output" || fail "Launch did not report Status: ok."

for _ in $(seq 1 15); do
  adb shell pidof "$package" >/dev/null 2>&1 && break
  sleep 1
done
adb shell pidof "$package" >/dev/null 2>&1 || fail "Junction process did not stay alive after launch."
adb shell dumpsys activity activities | grep -F "$activity" || fail "Junction MainActivity is not present in the foreground activity stack."
echo "Emulator smoke passed."
