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
  *"docker volume inspect"*)
    case "${STUB_VOLUME:-present}" in
      missing) echo "Error response from daemon: get asset-studio_data: no such volume" >&2; exit 1 ;;
      error) echo "error during connect: the docker engine is not reachable" >&2; exit 1 ;;
      *) echo '[{"Name": "asset-studio_data"}]' ;;
    esac ;;
  *"AssetStudio\\current.json"*)
    current='{"version": "1.2.2", "tag": "ghcr.io/vhco-pro/3d-assets-gen:1.2.2", "digest": "sha256:old"}'
    [[ "${STUB_CURRENT_JSON-unset}" != "unset" ]] && current="$STUB_CURRENT_JSON"
    [[ -n "$current" ]] && printf '%s\r\n' "$current" || exit 1 ;;
  *"database-schema-version"*)
    if [[ "$cmd" == *":1.2.3 "* ]]; then answer="${STUB_NEW_DB_SCHEMA:-2}"; else answer="${STUB_OLD_DB_SCHEMA:-2}"; fi
    case "$answer" in
      unknown) echo "unknown command: database-schema-version" >&2; exit 2 ;;
      fail) echo "SQLITE_CANTOPEN" >&2; exit 1 ;;
      *) printf '%s\r\n' "$answer" ;;
    esac ;;
  *" schema-version"*) printf '%s\r\n' "${STUB_NEW_SCHEMA:-2}" ;;
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
