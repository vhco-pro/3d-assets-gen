load helper

# check-upgrade.sh drives deploy.sh, rollback.sh and two remote steps. These tests replace the scripts and
# ssh with stubs that keep a fake deployment in $STATE: current and previous version, config hash, jobs.
setup() {
  setup_stubs
  STATE="$BATS_TEST_TMPDIR/state"
  mkdir -p "$STATE"
  echo cfg > "$STATE/config"; echo 2:abc > "$STATE/jobs"; : > "$STATE/current"; : > "$STATE/previous"
  export STATE ASSET_STUDIO_HEALTH_WAIT_S=0 ASSET_STUDIO_UPGRADE_LOG="$BATS_TEST_TMPDIR/check-upgrade.log"
  cat > "$BIN/fake-deploy" <<'STUB'
#!/usr/bin/env bash
old="$(cat "$STATE/current")"
if [[ "$old" != "$1" ]]; then echo "$old" > "$STATE/previous"; elif [[ -n "${STUB_RERUN_CLEARS:-}" ]]; then : > "$STATE/previous"; fi
[[ -n "${STUB_CONFIG_CHANGES:-}" && -n "$old" ]] && echo "cfg-$1" > "$STATE/config"
echo "$1" > "$STATE/current"
STUB
  cat > "$BIN/fake-rollback" <<'STUB'
#!/usr/bin/env bash
prev="$(cat "$STATE/previous")"
echo "› Reloading ghcr.io/vhco-pro/3d-assets-gen:${prev}"
echo "$prev" > "$STATE/current"; : > "$STATE/previous"
STUB
  cat > "$BIN/ssh" <<'STUB'
#!/usr/bin/env bash
cmd="${*: -1}"
echo "ssh $cmd" >> "$CALLS"
case "$cmd" in
  *"-File asset-studio-state.ps1"*)
    cur="$(cat "$STATE/current")"
    health="$cur commit-$cur"
    [[ -f "$STATE/down" && -n "${STUB_NO_RECOVERY:-}" ]] && health=""
    printf '{"config":"%s","current":"%s","previous":"%s","env":"ghcr.io/vhco-pro/3d-assets-gen:%s","jobs":"%s","health":"%s"}\r\n' \
      "$(cat "$STATE/config")" "$cur" "$(cat "$STATE/previous")" "$cur" "$(cat "$STATE/jobs")" "$health" ;;
  *"-File asset-studio-logon-test.ps1"*) touch "$STATE/down"; printf 'image absent: x\r\n' ;;
esac
exit 0
STUB
  cat > "$BIN/gh" <<'STUB'
#!/usr/bin/env bash
echo "gh $*" >> "$CALLS"
v="${3#v}"
[[ "$1 $2" == "release download" ]] && printf '{"version": "%s", "commit": "commit-%s", "digest": "sha256:abc"}\n' "$v" "$v"
exit 0
STUB
  chmod +x "$BIN"/*
  export ASSET_STUDIO_DEPLOY="$BIN/fake-deploy" ASSET_STUDIO_ROLLBACK="$BIN/fake-rollback"
}

@test "the full procedure passes and keeps its observations in the log" {
  run "$DEPLOY/check-upgrade.sh" 1.0.0 1.0.1
  [ "$status" -eq 0 ]
  [[ "$output" == *"Passed: previous version recorded as 1.0.0"* ]]
  [[ "$output" == *"Passed: rollback reloaded the removed 1.0.0 image"* ]]
  [[ "$output" == *"Passed: health reports 1.0.0 at commit-1.0.0"* ]]
  [[ "$output" == *"Passed: the logon task brought 1.0.1 back"* ]]
  grep -q "state after rollback" "$ASSET_STUDIO_UPGRADE_LOG"
  [ "$(call_line 'docker image rm ghcr.io/vhco-pro/3d-assets-gen:1.0.0')" != "" ]
}

@test "a deploy that rewrites config.yaml fails" {
  export STUB_CONFIG_CHANGES=1
  run "$DEPLOY/check-upgrade.sh" 1.0.0 1.0.1
  [ "$status" -eq 1 ]
  [[ "$output" == *"Failed: config.yaml unchanged by the second deploy"* ]]
}

@test "a rerun that drops the previous version fails" {
  export STUB_RERUN_CLEARS=1
  run "$DEPLOY/check-upgrade.sh" 1.0.0 1.0.1
  [ "$status" -eq 1 ]
  [[ "$output" == *"Failed: rerun keeps 1.0.0 as the previous version"* ]]
}

@test "no recovery after the logon task fails" {
  export STUB_NO_RECOVERY=1
  run "$DEPLOY/check-upgrade.sh" 1.0.0 1.0.1
  [ "$status" -eq 1 ]
  [[ "$output" == *"Failed: the logon task brought 1.0.1 back"* ]]
}

@test "missing versions are a usage error" {
  run "$DEPLOY/check-upgrade.sh" 1.0.0
  [ "$status" -eq 2 ]
}
