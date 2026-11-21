# Stubs for docker, ssh, scp, gh and cosign. Each records its arguments in $CALLS, one call per line.
# Behaviour is controlled with STUB_* variables set by a test.
setup_stubs() {
  BIN="$BATS_TEST_TMPDIR/bin"
  CALLS="$BATS_TEST_TMPDIR/calls"
  mkdir -p "$BIN"
  : > "$CALLS"
  export CALLS
  cat > "$BIN/docker" <<'STUB'
#!/usr/bin/env bash
echo "docker $*" >> "$CALLS"
case "$1 $2" in
  "image inspect") echo "${STUB_LOCAL_LAYERS:-[\"sha256:aaa\"]}" ;;
  "save "*) printf 'image-bytes' ;;
  "pull "*) exit "${STUB_PULL_EXIT:-0}" ;;
esac
exit 0
STUB
  cat > "$BIN/ssh" <<'STUB'
#!/usr/bin/env bash
cmd="${*: -1}"
echo "ssh $cmd" >> "$CALLS"
case "$cmd" in
  *"docker load"*) cat > /dev/null ;;
  *previous.json*) [[ -n "${STUB_PREVIOUS_JSON:-}" ]] && printf '%s\r\n' "$STUB_PREVIOUS_JSON" || exit 1 ;;
  *"-File asset-studio-"*)
    name="${cmd#*-File asset-studio-}"
    name="${name%%.ps1*}"
    var="STUB_REMOTE_$(echo "$name" | tr 'a-z-' 'A-Z_')_EXIT"
    [[ "$name" == "layers" ]] && printf '%s\r\n' "${STUB_REMOTE_LAYERS:-[\"sha256:aaa\"]}"
    exit "${!var:-0}" ;;
esac
exit 0
STUB
  cat > "$BIN/scp" <<'STUB'
#!/usr/bin/env bash
echo "scp $*" >> "$CALLS"
exit 0
STUB
  cat > "$BIN/gh" <<'STUB'
#!/usr/bin/env bash
echo "gh $*" >> "$CALLS"
case "$1 $2" in
  "release download")
    [[ -n "${STUB_RELEASE_JSON:-}" ]] || exit 1
    printf '%s\n' "$STUB_RELEASE_JSON" ;;
  "attestation verify") exit "${STUB_ATTEST_EXIT:-0}" ;;
  "api "*) [[ -n "${STUB_GH_API:-}" ]] && printf '%s\n' "$STUB_GH_API" ;;
esac
exit 0
STUB
  cat > "$BIN/cosign" <<'STUB'
#!/usr/bin/env bash
echo "cosign $*" >> "$CALLS"
exit "${STUB_COSIGN_EXIT:-0}"
STUB
  chmod +x "$BIN"/*
  export PATH="$BIN:$PATH" GH_BIN="$BIN/gh" COSIGN_BIN="$BIN/cosign" NO_COLOR=1
  export STUB_RELEASE_JSON='{"version": "1.2.3", "commit": "0123456789abcdef0123456789abcdef01234567", "digest": "sha256:abc"}'
}

# shellcheck disable=SC2034 # used by the .bats files that load this helper
DEPLOY="$BATS_TEST_DIRNAME/.."

# Line number of the first call matching a pattern (0 when absent).
call_line() {
  grep -n -m1 -- "$1" "$CALLS" | cut -d: -f1 || true
}
