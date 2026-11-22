load helper

# check-repo.sh pipes gh through --jq, so these tests use their own gh stub that answers each query with
# what --jq would print. STUB_CATEGORIES is the main-branch analysis categories, one per line.
setup() {
  setup_stubs
  cat > "$BIN/gh" <<'STUB'
#!/usr/bin/env bash
echo "gh $*" >> "$CALLS"
args="$*"
if [[ -n "${STUB_FAIL:-}" && "$args" == *"$STUB_FAIL"* ]]; then echo "HTTP 502: Bad Gateway (stub)" >&2; exit 1; fi
case "$args" in
  "api repos/vhco-pro/3d-assets-gen") echo '{"visibility":"public","license":{"key":"apache-2.0"},"delete_branch_on_merge":true,"security_and_analysis":{"secret_scanning":{"status":"enabled"},"secret_scanning_push_protection":{"status":"enabled"}}}' ;;
  *"code-scanning/analyses?ref=refs/heads/main"*) printf '%s' "${STUB_CATEGORIES:-}" ;;
  *"orgs/vhco-pro/installations"*) echo 42 ;;
  *"user/installations/42/repositories"*) [[ -n "${STUB_INSTALLED:-}" ]] || exit 1; printf '%s\n' "$STUB_INSTALLED" ;;
  "run list"*) echo 1 ;;
  "issue list"*) echo 1 ;;
esac
exit 0
STUB
  chmod +x "$BIN/gh"
}

@test "analyses only on a pull request ref fail both analysis checks" {
  export STUB_CATEGORIES=""
  run "$DEPLOY/check-repo.sh"
  [ "$status" -eq 1 ]
  [[ "$output" == *"Failed: a /language:js-ts analysis on main"* ]]
  [[ "$output" == *"Failed: an Actions analysis on main"* ]]
  [ "$(call_line 'ref=refs/heads/main')" != "" ]
}

@test "main analyses pass, and the script makes no installation-listing call" {
  export STUB_CATEGORIES=$'/language:actions\n/language:js-ts\n'
  run "$DEPLOY/check-repo.sh"
  [ "$status" -eq 0 ]
  [ "$(call_line 'installations')" = "" ]
  [[ "$output" != *"Skipped"* ]]
}

@test "a code-scanning call that errors is reported as a failed check with its error" {
  export STUB_CATEGORIES=$'/language:actions\n/language:js-ts\n' STUB_FAIL="code-scanning/analyses"
  run "$DEPLOY/check-repo.sh"
  [ "$status" -eq 1 ]
  [[ "$output" == *"Failed: a /language:js-ts analysis on main (JavaScript, TypeScript and Python): HTTP 502: Bad Gateway (stub)"* ]]
}

@test "a repository-settings call that errors is reported as a failed check with its error" {
  export STUB_CATEGORIES=$'/language:actions\n/language:js-ts\n' STUB_FAIL="api repos/vhco-pro/3d-assets-gen"
  run "$DEPLOY/check-repo.sh"
  [ "$status" -eq 1 ]
  [[ "$output" == *"Failed: repository settings: HTTP 502: Bad Gateway (stub)"* ]]
}
