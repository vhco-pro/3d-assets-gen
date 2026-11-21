#!/usr/bin/env bash
# Status lines for the deploy scripts (conventions/terminal-output.md). Source this file.
# Colour only when the stream is a terminal and NO_COLOR is empty or unset; ASCII symbols when
# ASSET_STUDIO_ASCII=1 (scripts set it for --ascii). report_fail writes to stderr and sets REPORT_FAILED=1.
# shellcheck disable=SC2034 # read by the scripts that source this file
REPORT_FAILED=0

_report() {
  local kind="$1" word="$2" fd="$3"
  shift 3
  local symbol
  if [[ "${ASSET_STUDIO_ASCII:-0}" == "1" ]]; then
    case "$kind" in pass) symbol="OK" ;; fail) symbol="FAIL" ;; skip) symbol="SKIP" ;; none) symbol="NONE" ;; step) symbol=">" ;; esac
  else
    case "$kind" in pass) symbol="✓" ;; fail) symbol="✗" ;; skip | none) symbol="∅" ;; step) symbol="›" ;; esac
  fi
  if [[ -t "$fd" && -z "${NO_COLOR:-}" ]]; then
    local colour
    case "$kind" in pass) colour=32 ;; fail) colour=31 ;; skip | none) colour=33 ;; step) colour=36 ;; esac
    symbol=$'\e['"${colour}m${symbol}"$'\e[0m'
  fi
  printf '%s %s%s\n' "$symbol" "$word" "$*" >&"$fd"
}

report_step() { _report step "" 1 "$@"; }
report_pass() { _report pass "Passed: " 1 "$@"; }
report_skip() { _report skip "Skipped: " 1 "$@"; }
report_none() { _report none "No results: " 1 "$@"; }
report_fail() {
  # shellcheck disable=SC2034 # read by the scripts that source this file
  REPORT_FAILED=1
  _report fail "Failed: " 2 "$@"
}
