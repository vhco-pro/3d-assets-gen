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
  # The adb server (and its key) must exist before boot, so the Play Store image trusts this host's key.
  "$ADB" start-server > /dev/null 2>&1
  # swangle_indirect: swiftshader_indirect crashed the emulator on fedora-43. Started from the state
  # directory so a crash's core file never lands in the checkout.
  (cd "$PHONE_STATE" && exec "$EMULATOR" -avd "$AVD" -no-window -no-audio -no-boot-anim -no-snapshot -gpu swangle_indirect -accel on \
    > "$PHONE_STATE/emulator.log" 2>&1) &
  local pid=$!
  echo "$pid" > "$EMULATOR_PID_FILE"
  local i
  for ((i = 0; i < 300; i++)); do
    if ! kill -0 "$pid" 2>/dev/null; then
      report_fail "the emulator exited during boot (see $PHONE_STATE/emulator.log)"
      return 1
    fi
    # An AVD first booted before this host had an adb key keeps refusing it; wiping its data once lets the
    # emulator install the key on the next boot.
    if [[ $i -eq 60 && "${1:-}" != "--wiped" ]] && "$ADB" devices | grep -q 'unauthorized'; then
      report_step "the emulator does not trust this host's adb key; restarting it once with its data wiped"
      kill "$pid" 2>/dev/null || true
      sleep 5
      (cd "$PHONE_STATE" && exec "$EMULATOR" -avd "$AVD" -no-window -no-audio -no-boot-anim -no-snapshot -gpu swangle_indirect -accel on -wipe-data \
        > "$PHONE_STATE/emulator.log" 2>&1) &
      pid=$!
      echo "$pid" > "$EMULATOR_PID_FILE"
      set -- --wiped
    fi
    if [[ "$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == "1" ]]; then
      "$ADB" shell input keyevent KEYCODE_WAKEUP > /dev/null 2>&1 || true
      "$ADB" shell wm dismiss-keyguard > /dev/null 2>&1 || true
      return 0
    fi
    sleep 2
  done
  report_fail "the emulator did not boot within 10 minutes (see $PHONE_STATE/emulator.log)"
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
    labels = [node.get("text") or "", node.get("content-desc") or "", node.get("resource-id") or ""]
    if any(label and pattern.search(label) for label in labels):
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
  "$ADB" shell am start -n "$CHROME_MAIN" > /dev/null
  # Taps through Chrome's first-run screens until the address bar shows.
  for ((i = 0; i < 20; i++)); do
    sleep 2
    [[ -n "$(ui_find '^com\.android\.chrome:id/(url_bar|search_box_text)$')" ]] && break
    ui_tap '^(Use without an account|Accept & continue|No thanks|No, thanks|Got it|Continue|Skip)$' || true
  done
  # Chrome refuses chrome:// URLs from intents, so the URL is typed into the address bar.
  ui_tap '^(com\.android\.chrome:id/(url_bar|search_box_text)|Search or type URL)$' || return 1
  sleep 1
  "$ADB" shell input keyevent KEYCODE_MOVE_END
  "$ADB" shell input keyevent --longpress KEYCODE_DEL > /dev/null 2>&1 || true
  "$ADB" shell input text "'$url'"
  sleep 1
  # Drops any inline autocompletion after the typed URL before going there.
  "$ADB" shell input keyevent KEYCODE_FORWARD_DEL
  "$ADB" shell input keyevent KEYCODE_ENTER
  sleep 3
}

# True when Chrome reads the command line Playwright writes: scripts/phone/check-chrome.ts connects with
# Playwright's launchBrowser() and reads chrome://version. (Chrome's page content is not visible to uiautomator.)
chrome_reads_command_line() {
  "$ADB" shell am force-stop "$CHROME"
  bun scripts/phone/check-chrome.ts "$@"
}

# Taps a point given as fractions of the screen's width and height.
tap_fraction() {
  local size w h
  size="$("$ADB" shell wm size | sed -n 's/.*: *\([0-9]*\)x\([0-9]*\).*/\1 \2/p' | tail -n1)"
  w="${size% *}" h="${size#* }"
  "$ADB" shell input tap "$(python3 -I -c "print(round($w * $1))")" "$(python3 -I -c "print(round($h * $2))")"
}

# Selects Enabled for the "Enable command line on non-rooted devices" flag in chrome://flags and relaunches
# Chrome. The flags page is web content that uiautomator cannot see, so the search narrows it to that one
# flag, whose menu and the Relaunch button then sit at fixed places on the Pixel 7 screen; the menu's native
# option list is visible to uiautomator, which confirms the tap landed.
enable_chrome_command_line_flag() {
  "$ADB" shell am force-stop "$CHROME"
  chrome_open "chrome://flags" || return 1
  sleep 2
  "$ADB" shell input text non-rooted
  sleep 2
  "$ADB" shell input keyevent KEYCODE_BACK
  sleep 1
  tap_fraction 0.236 0.4317
  sleep 2
  ui_tap '^Enabled$' || return 1
  sleep 3
  tap_fraction 0.8306 0.9325
  sleep 10
}
