load helper

setup() { setup_stubs; }

@test "without a recorded previous version nothing changes" {
  run "$DEPLOY/rollback.sh"
  [ "$status" -eq 1 ]
  [[ "$output" == *"∅ No results: no previous version is recorded; nothing changed"* ]]
  [ "$(call_line 'asset-studio-rollback.ps1')" = "" ]
}

@test "with the previous image present, rollback runs on win-main" {
  export STUB_PREVIOUS_JSON='{"version": "1.2.2", "tag": "ghcr.io/vhco-pro/3d-assets-gen:1.2.2", "digest": "sha256:old"}'
  run "$DEPLOY/rollback.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *"✓ Passed: rolled back to 1.2.2"* ]]
  [ "$(call_line 'docker load')" = "" ]
  [ "$(call_line 'asset-studio-ensure-docker.ps1')" -lt "$(call_line 'asset-studio-rollback.ps1')" ]
}

@test "a missing previous image is reloaded and verified first" {
  export STUB_PREVIOUS_JSON='{"version": "1.2.3", "tag": "ghcr.io/vhco-pro/3d-assets-gen:1.2.3", "digest": "sha256:abc"}'
  export STUB_REMOTE_HAS_IMAGE_EXIT=1
  run "$DEPLOY/rollback.sh"
  [ "$status" -eq 0 ]
  [ "$(call_line 'cosign verify')" -gt 0 ]
  [ "$(call_line 'docker load')" -lt "$(call_line 'asset-studio-rollback.ps1')" ]
}

@test "a missing image without a release record changes nothing" {
  export STUB_PREVIOUS_JSON='{"version": "1.2.2", "tag": "x", "digest": "y"}'
  export STUB_REMOTE_HAS_IMAGE_EXIT=1 STUB_RELEASE_JSON=""
  run "$DEPLOY/rollback.sh"
  [ "$status" -eq 1 ]
  [[ "$output" == *"no GitHub Release record for v1.2.2; nothing changed"* ]]
  [ "$(call_line 'asset-studio-rollback.ps1')" = "" ]
}

@test "no backup for the previous schema is reported" {
  export STUB_PREVIOUS_JSON='{"version": "1.2.2", "tag": "x", "digest": "y"}'
  export STUB_REMOTE_ROLLBACK_EXIT=6
  run "$DEPLOY/rollback.sh"
  [ "$status" -eq 1 ]
  [[ "$output" == *"no backup matches the schema of 1.2.2"* ]]
}
