# Output contract of scripts/deploy/lib/report.sh (conventions/terminal-output.md).
load helper

emit() {
  bash -c "source '$DEPLOY/lib/report.sh'; report_step 'Deploying'; report_pass 'ok'; report_skip 'nothing to do'; report_none 'empty'; report_fail 'broken'; exit \$REPORT_FAILED" 2>&1
}

@test "status words and symbols, failures make the exit non-zero" {
  run emit
  [ "$status" -eq 1 ]
  [ "${lines[0]}" = "› Deploying" ]
  [ "${lines[1]}" = "✓ Passed: ok" ]
  [ "${lines[2]}" = "∅ Skipped: nothing to do" ]
  [ "${lines[3]}" = "∅ No results: empty" ]
  [ "${lines[4]}" = "✗ Failed: broken" ]
}

@test "ASCII mode" {
  ASSET_STUDIO_ASCII=1 run emit
  [ "${lines[1]}" = "OK Passed: ok" ]
  [ "${lines[4]}" = "FAIL Failed: broken" ]
}

@test "no colour when redirected, whatever NO_COLOR says" {
  for value in unset "" 0 1; do
    if [ "$value" = unset ]; then out=$(env -u NO_COLOR bash -c "$(declare -f emit); DEPLOY='$DEPLOY' emit" || true); else out=$(NO_COLOR="$value" bash -c "$(declare -f emit); DEPLOY='$DEPLOY' emit" || true); fi
    [[ "$out" != *$'\e['* ]]
  done
}

@test "colour on a terminal only when NO_COLOR is absent or empty" {
  # Python's pty module gives the reporter a real terminal on stdout.
  pty() { python3 -c 'import pty, sys; pty.spawn(sys.argv[1:])' bash -c "source '$DEPLOY/lib/report.sh'; report_pass ok"; }
  out=$(env -u NO_COLOR bash -c "$(declare -f pty); DEPLOY='$DEPLOY' pty")
  [[ "$out" == *$'\e[32m'* ]]
  out=$(NO_COLOR="" bash -c "$(declare -f pty); DEPLOY='$DEPLOY' pty")
  [[ "$out" == *$'\e[32m'* ]]
  for value in 0 1; do
    out=$(NO_COLOR="$value" bash -c "$(declare -f pty); DEPLOY='$DEPLOY' pty")
    [[ "$out" != *$'\e['* ]]
  done
}
