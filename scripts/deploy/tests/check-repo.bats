load helper

# check-repo.sh pipes gh through --jq, so these tests use their own gh stub that answers each query with
# what --jq would print. STUB_CATEGORIES is the main-branch analysis categories, one per line.
setup() {
  setup_stubs
  cat > "$BIN/gh" <<'STUB'
#!/usr/bin/env bash
echo "gh $*" >> "$CALLS"
args="$*"
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
  export STUB_CATEGORIES="" STUB_INSTALLED="vhco-pro/3d-assets-gen"
  run "$DEPLOY/check-repo.sh"
  [ "$status" -eq 1 ]
  [[ "$output" == *"Failed: a /language:js-ts analysis on main"* ]]
  [[ "$output" == *"Failed: an Actions analysis on main"* ]]
  [ "$(call_line 'ref=refs/heads/main')" != "" ]
}

@test "main analyses and an installation that lists the repository pass" {
  export STUB_CATEGORIES=$'/language:actions\n/language:js-ts\n' STUB_INSTALLED="vhco-pro/3d-assets-gen"
  run "$DEPLOY/check-repo.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *"Passed: vhco-pro/3d-assets-gen is in the vhco-renovate installation"* ]]
}

@test "an installation without the repository fails" {
  export STUB_CATEGORIES=$'/language:actions\n/language:js-ts\n' STUB_INSTALLED="vhco-pro/other"
  run "$DEPLOY/check-repo.sh"
  [ "$status" -eq 1 ]
  [[ "$output" == *"Failed: vhco-pro/3d-assets-gen is in the vhco-renovate installation"* ]]
}

@test "a token that cannot list the installation reports a skip" {
  export STUB_CATEGORIES=$'/language:actions\n/language:js-ts\n' STUB_INSTALLED=""
  run "$DEPLOY/check-repo.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *"Skipped: vhco-pro/3d-assets-gen in the vhco-renovate installation"* ]]
}
