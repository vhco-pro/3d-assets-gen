#!/usr/bin/env bash
# Helpers for the phone scripts: SDK paths, the headless emulator, uiautomator taps and Chrome's command-line
# flag. Source this file after scripts/deploy/lib/report.sh.
# shellcheck disable=SC2034 # the paths are read by the scripts that source this file
ANDROID_HOME="${ANDROID_HOME:-$HOME/.local/share/android-sdk}"
export ANDROID_HOME ANDROID_SDK_ROOT="$ANDROID_HOME"
SDKMANAGER="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
AVDMANAGER="$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager"
EMULATOR="$ANDROID_HOME/emulator/emulator"
ADB="$ANDROID_HOME/platform-tools/adb"
AVD="asset-studio"
PHONE_STATE="${XDG_CACHE_HOME:-$HOME/.cache}/asset-studio/phone"
EMULATOR_PID_FILE="$PHONE_STATE/emulator.pid"
CHROME="com.android.chrome"
CHROME_MAIN="com.android.chrome/com.google.android.apps.chrome.Main"

emulator_running() {
  [[ -x "$ADB" ]] || return 1
  "$ADB" devices 2>/dev/null | grep -q '^emulator-[0-9]*[[:space:]]*device$'
}

# Starts the AVD headless with KVM and waits until Android has booted. Records the PID it started.
start_emulator() {
  mkdir -p "$PHONE_STATE"
  "$ADB" start-server > /dev/null 2>&1
  "$EMULATOR" -avd "$AVD" -no-window -no-audio -no-boot-anim -no-snapshot -gpu swiftshader_indirect -accel on \
    > "$PHONE_STATE/emulator.log" 2>&1 &
  echo "$!" > "$EMULATOR_PID_FILE"
  local i
  for ((i = 0; i < 180; i++)); do
    if [[ "$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == "1" ]]; then
      "$ADB" shell input keyevent KEYCODE_WAKEUP > /dev/null 2>&1 || true
      "$ADB" shell wm dismiss-keyguard > /dev/null 2>&1 || true
      return 0
    fi
    sleep 2
  done
  report_fail "the emulator did not boot within 6 minutes (see $PHONE_STATE/emulator.log)"
  return 1
}

# Stops the emulator this tooling started, by its recorded PID.
stop_emulator() {
  "$ADB" emu kill > /dev/null 2>&1 || true
  if [[ -f "$EMULATOR_PID_FILE" ]]; then
    local pid
    pid="$(cat "$EMULATOR_PID_FILE")"
    local i
    for ((i = 0; i < 30; i++)); do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
    kill "$pid" 2>/dev/null || true
    rm -f "$EMULATOR_PID_FILE"
  fi
}

# Prints the screen's uiautomator hierarchy as XML.
ui_dump() {
  "$ADB" exec-out uiautomator dump /dev/tty 2>/dev/null | sed 's|UI hierchary dumped to: /dev/tty||'
}

# Prints "x y" for the centre of the first node whose text or content-desc matches the regex, or nothing.
ui_find() {
  local pattern="$1"
  ui_dump | python3 -I -c '
import re, sys, xml.etree.ElementTree as ET
pattern = re.compile(sys.argv[1])
try:
    root = ET.fromstring(sys.stdin.read())
except ET.ParseError:
    sys.exit(0)
for node in root.iter("node"):
    label = node.get("text") or node.get("content-desc") or ""
    if label and pattern.search(label):
        m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", node.get("bounds", ""))
        if m:
            x1, y1, x2, y2 = map(int, m.groups())
            print((x1 + x2) // 2, (y1 + y2) // 2)
            break
' "$pattern"
}

# Taps the first node matching the regex; fails when there is none.
ui_tap() {
  local at
  at="$(ui_find "$1")"
  [[ -n "$at" ]] || return 1
  # shellcheck disable=SC2086 # "x y" splits into the two arguments of input tap
  "$ADB" shell input tap $at
}

# Opens a URL in Chrome and taps through Chrome's first-run screens.
chrome_open() {
  local url="$1" i
  "$ADB" shell am start -a android.intent.action.VIEW -d "$url" -n "$CHROME_MAIN" > /dev/null
  for ((i = 0; i < 12; i++)); do
    sleep 2
    if ! ui_tap '^(Use without an account|Accept & continue|No thanks|No, thanks|Got it|Continue|Skip)$'; then
      [[ $i -ge 2 ]] && return 0
    fi
  done
}

# True when Chrome reads /data/local/tmp/chrome-command-line, as Playwright's Android support needs.
chrome_reads_command_line() {
  local marker="--asset-studio-command-line-check"
  "$ADB" shell "echo '_ $marker' > /data/local/tmp/chrome-command-line"
  "$ADB" shell am force-stop "$CHROME"
  chrome_open "chrome://version"
  local i
  for ((i = 0; i < 6; i++)); do
    if [[ -n "$(ui_find "$marker")" ]]; then
      "$ADB" shell rm -f /data/local/tmp/chrome-command-line
      return 0
    fi
    "$ADB" shell input swipe 500 1500 500 500 300 > /dev/null 2>&1 || true
    sleep 1
  done
  "$ADB" shell rm -f /data/local/tmp/chrome-command-line
  return 1
}

# Selects Enabled for chrome://flags/#enable-command-line-on-non-rooted-devices and relaunches Chrome.
enable_chrome_command_line_flag() {
  "$ADB" shell am force-stop "$CHROME"
  chrome_open "chrome://flags/#enable-command-line-on-non-rooted-devices"
  sleep 2
  local i
  # The highlighted flag's menu reads Default; it opens a native list with Enabled.
  for ((i = 0; i < 5; i++)); do
    if ui_tap '^Default$'; then break; fi
    sleep 2
  done
  sleep 1
  ui_tap '^Enabled$' || return 1
  sleep 2
  ui_tap '^Relaunch$' || return 1
  sleep 5
}
