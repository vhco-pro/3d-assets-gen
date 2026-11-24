#!/usr/bin/env bash
# Sets up the Android emulator for the Asset Studio phone journey (feature document asset-studio-mobile,
# Design > Testing and the Android emulator), user-locally and idempotently:
#   - the Android command-line tools, platform tools, the emulator and the API 35 Play Store x86_64 image
#     under ~/.local/share/android-sdk, with the SDK licences accepted;
#   - the AVD asset-studio;
#   - Google Play Services for AR's emulator APK from google-ar/arcore-android-sdk, checked against its
#     published SHA-256;
#   - Chrome's "Enable command line on non-rooted devices" flag, which Playwright's Android support needs on
#     a Play Store (user) image, set through chrome://flags with uiautomator and input tap, then checked on
#     chrome://version; and Chrome 105 or newer.
# Run by the agent on fedora-43, never by CI. Needs KVM, curl, unzip, python3 and Java 17 or newer.
#   scripts/phone/setup-emulator.sh [--keep-running] [--ascii]
set -euo pipefail
cd "$(dirname "$0")/../.."
[[ " $* " == *" --ascii "* ]] && export ASSET_STUDIO_ASCII=1
KEEP=0
[[ " $* " == *" --keep-running "* ]] && KEEP=1
# shellcheck source-path=SCRIPTDIR source=../deploy/lib/report.sh
source scripts/deploy/lib/report.sh
# shellcheck source-path=SCRIPTDIR source=lib.sh
source scripts/phone/lib.sh

# Google's repository index (repository2-3.xml) publishes this archive's SHA-1.
CMDLINE_TOOLS_ZIP="commandlinetools-linux-16111833_latest.zip"
CMDLINE_TOOLS_SHA1="e025545c62a8e64c7559119566a569fb1dec5f60"
# The GitHub release publishes this asset's SHA-256 (the release API's digest field).
ARCORE_VERSION="1.57.0"
ARCORE_APK="Google_Play_Services_for_AR_${ARCORE_VERSION}_x86_for_emulator.apk"
ARCORE_SHA256="92741f6f873c232a07173b50adeee6b1c2f5a048bc071c80cf741b0cde0f73c4"
SYSTEM_IMAGE="system-images;android-35;google_apis_playstore;x86_64"
CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/asset-studio/phone"
mkdir -p "$CACHE" "$ANDROID_HOME"

fail() {
  report_fail "$1"
  exit 1
}

# ---- tools -------------------------------------------------------------------------------------------

[[ -r /dev/kvm && -w /dev/kvm ]] || fail "/dev/kvm is not usable by $(id -un)"
report_pass "KVM usable"
for cmd in curl unzip python3 java bun; do command -v "$cmd" > /dev/null || fail "$cmd is not installed"; done

if [[ -x "$SDKMANAGER" ]]; then
  report_skip "command-line tools already installed"
else
  report_step "installing the command-line tools"
  zip="$CACHE/$CMDLINE_TOOLS_ZIP"
  [[ -f "$zip" ]] || curl -fsSL -o "$zip.part" "https://dl.google.com/android/repository/$CMDLINE_TOOLS_ZIP"
  [[ -f "$zip.part" ]] && mv "$zip.part" "$zip"
  got="$(sha1sum "$zip" | cut -d' ' -f1)"
  if [[ "$got" != "$CMDLINE_TOOLS_SHA1" ]]; then
    rm -f "$zip"
    fail "$CMDLINE_TOOLS_ZIP has SHA-1 $got, not the published $CMDLINE_TOOLS_SHA1"
  fi
  rm -rf "$ANDROID_HOME/cmdline-tools/latest" "$CACHE/unzip"
  unzip -q "$zip" -d "$CACHE/unzip"
  mkdir -p "$ANDROID_HOME/cmdline-tools"
  mv "$CACHE/unzip/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"
  report_pass "installed the command-line tools (SHA-1 matches)"
fi

licences="$CACHE/licences.log"
if yes | "$SDKMANAGER" --sdk_root="$ANDROID_HOME" --licenses > "$licences" 2>&1; then
  report_pass "SDK licences accepted"
elif grep -q "The --licenses option is no longer needed" "$licences"; then
  # Command-line tools 23 accept the licences as part of installing and refuse the separate step.
  report_pass "SDK licences: this sdkmanager accepts them while installing"
else
  fail "sdkmanager --licenses failed (see $licences)"
fi

packages=(platform-tools emulator "$SYSTEM_IMAGE")
installed="$CACHE/installed.txt"
"$SDKMANAGER" --sdk_root="$ANDROID_HOME" --list_installed > "$installed" 2>/dev/null || fail "sdkmanager --list_installed failed"
missing=()
# --list_installed prints package paths with slashes in place of semicolons.
for p in "${packages[@]}"; do grep -q "^ *${p//;//} " "$installed" || missing+=("$p"); done
if ((${#missing[@]} == 0)); then
  report_skip "platform tools, emulator and $SYSTEM_IMAGE already installed"
else
  report_step "installing ${missing[*]}"
  log="$CACHE/sdkmanager.log"
  "$SDKMANAGER" --sdk_root="$ANDROID_HOME" "${missing[@]}" > "$log" 2>&1 || fail "sdkmanager could not install ${missing[*]} (see $log)"
  report_pass "installed ${missing[*]}"
fi

# ---- the AVD ------------------------------------------------------------------------------------------

if "$EMULATOR" -list-avds 2>/dev/null | grep -qx "$AVD"; then
  report_skip "AVD $AVD already exists"
else
  echo no | "$AVDMANAGER" create avd -n "$AVD" -k "$SYSTEM_IMAGE" -d pixel_7 > "$CACHE/avdmanager.log" 2>&1 || fail "avdmanager could not create $AVD (see $CACHE/avdmanager.log)"
  report_pass "created AVD $AVD (Pixel 7, $SYSTEM_IMAGE)"
fi
config="$HOME/.android/avd/${AVD}.avd/config.ini"
# The back camera is the emulated one (its moving test pattern; the virtual scene crashed this host's emulator), the
# keyboard stays a software keyboard so the journey sees the on-screen keyboard open.
for setting in "hw.camera.back=emulated" "hw.keyboard=no" "hw.ramSize=4096"; do
  key="${setting%%=*}"
  if grep -q "^${key}=" "$config"; then sed -i "s|^${key}=.*|${setting}|" "$config"; else echo "$setting" >> "$config"; fi
done
report_pass "AVD settings: back camera emulated, software keyboard, 4 GiB"

# ---- on the running emulator ----------------------------------------------------------------------------

started=0
if emulator_running; then
  report_skip "emulator already running"
else
  start_emulator
  started=1
  report_pass "emulator booted headless with KVM"
fi
cleanup() {
  if [[ "$started" == 1 && "$KEEP" == 0 ]]; then stop_emulator; fi
}
trap cleanup EXIT

if "$ADB" shell pm list packages com.google.ar.core | grep -q "com.google.ar.core" && "$ADB" shell dumpsys package com.google.ar.core | grep -q "versionName=${ARCORE_VERSION%.*}\."; then
  report_skip "Google Play Services for AR ${ARCORE_VERSION} already installed"
else
  apk="$CACHE/$ARCORE_APK"
  [[ -f "$apk" ]] || curl -fsSL -o "$apk.part" "https://github.com/google-ar/arcore-android-sdk/releases/download/${ARCORE_VERSION}/${ARCORE_APK}"
  [[ -f "$apk.part" ]] && mv "$apk.part" "$apk"
  got="$(sha256sum "$apk" | cut -d' ' -f1)"
  if [[ "$got" != "$ARCORE_SHA256" ]]; then
    rm -f "$apk"
    fail "$ARCORE_APK has SHA-256 $got, not the published $ARCORE_SHA256"
  fi
  "$ADB" install -r "$apk" > "$CACHE/arcore-install.log" 2>&1 || fail "adb install of $ARCORE_APK failed (see $CACHE/arcore-install.log)"
  report_pass "installed Google Play Services for AR ${ARCORE_VERSION} (SHA-256 matches)"
fi

chrome_version="$("$ADB" shell dumpsys package com.android.chrome | sed -n 's/.*versionName=\([0-9.]*\).*/\1/p' | head -n1)"
[[ -n "$chrome_version" ]] || fail "Chrome is not installed on the emulator"
if (( ${chrome_version%%.*} >= 105 )); then report_pass "Chrome $chrome_version (105 or newer)"; else fail "Chrome $chrome_version is older than 105"; fi

if chrome_reads_command_line --quiet; then
  report_skip "Chrome already reads its command line on this user build"
else
  report_step "turning on chrome://flags/#enable-command-line-on-non-rooted-devices"
  enable_chrome_command_line_flag || fail "could not set the Chrome flag through chrome://flags"
  chrome_reads_command_line || fail "chrome://version does not show the command line Playwright writes"
  report_pass "Chrome flag enabled; chrome://version shows the written command line"
fi
report_pass "emulator ready for scripts/phone/android-journey.ts"
