load helper

setup() { setup_stubs; }

@test "a deploy runs every step in order and reports each one" {
  run "$DEPLOY/deploy.sh" 1.2.3
  [ "$status" -eq 0 ]
  [[ "$output" == *"✓ Passed: Docker Desktop is running"* ]]
  [[ "$output" == *"✓ Passed: Asset Studio 1.2.3 is serving through tailscale serve"* ]]
  ensure=$(call_line "asset-studio-ensure-docker.ps1")
  load=$(call_line "docker load")
  prepare=$(call_line "asset-studio-prepare.ps1")
  health=$(call_line "asset-studio-health.ps1")
  [ "$ensure" -gt 0 ] && [ "$load" -gt "$ensure" ] && [ "$prepare" -gt "$load" ] && [ "$health" -gt "$prepare" ]
  grep -qF -- "cosign verify --certificate-identity-regexp ^https://github\.com/vhco-pro/3d-assets-gen/\.github/workflows/ci\.yml@refs/heads/.+\$ --certificate-oidc-issuer https://token.actions.githubusercontent.com ghcr.io/vhco-pro/3d-assets-gen@sha256:abc" "$CALLS"
  [ "$(grep -c 'gh attestation verify oci://ghcr.io/vhco-pro/3d-assets-gen@sha256:abc --repo vhco-pro/3d-assets-gen' "$CALLS")" -eq 2 ]
  grep -q -- "--predicate-type https://spdx.dev/Document/v2.3" "$CALLS"
  grep -q -- "docker tag ghcr.io/vhco-pro/3d-assets-gen@sha256:abc ghcr.io/vhco-pro/3d-assets-gen:1.2.3" "$CALLS"
  grep -q -- "-File asset-studio-prepare.ps1 -Version 1.2.3 -Tag ghcr.io/vhco-pro/3d-assets-gen:1.2.3 -Digest sha256:abc" "$CALLS"
  ! grep -q -- "-RotateToken" "$CALLS"
  grep -q -- "-File asset-studio-health.ps1 -Version 1.2.3 -Commit 0123456789abcdef0123456789abcdef01234567" "$CALLS"
}

@test "--rotate-token asks prepare for a new token" {
  run "$DEPLOY/deploy.sh" 1.2.3 --rotate-token
  [ "$status" -eq 0 ]
  grep -q -- "-RotateToken" "$CALLS"
}

@test "Docker Desktop not answering stops before anything is loaded" {
  export STUB_REMOTE_ENSURE_DOCKER_EXIT=3
  run "$DEPLOY/deploy.sh" 1.2.3
  [ "$status" -eq 1 ]
  [[ "$output" == *"✗ Failed: Docker Desktop did not answer within 3 minutes; is the owner signed in on win-main?"* ]]
  [ "$(call_line 'docker load')" = "" ]
}

@test "a version without a release record is never deployed" {
  export STUB_RELEASE_JSON=""
  run "$DEPLOY/deploy.sh" 9.9.9
  [ "$status" -eq 1 ]
  [[ "$output" == *"no GitHub Release record for v9.9.9"* ]]
  [ "$(call_line 'docker load')" = "" ]
}

@test "a failed signature or attestation check stops the deploy" {
  export STUB_COSIGN_EXIT=1
  run "$DEPLOY/deploy.sh" 1.2.3
  [ "$status" -eq 1 ]
  [ "$(call_line 'docker load')" = "" ]
  export STUB_COSIGN_EXIT=0 STUB_ATTEST_EXIT=1
  : > "$CALLS"
  run "$DEPLOY/deploy.sh" 1.2.3
  [ "$status" -eq 1 ]
  [ "$(call_line 'docker load')" = "" ]
}

@test "different layers on win-main stop the deploy" {
  export STUB_REMOTE_LAYERS='["sha256:other"]'
  run "$DEPLOY/deploy.sh" 1.2.3
  [ "$status" -eq 1 ]
  [[ "$output" == *"could not be loaded on win-main with matching layers"* ]]
  [ "$(call_line 'asset-studio-prepare.ps1')" = "" ]
}

@test "health that never reports the version fails after the bounded wait" {
  export STUB_REMOTE_HEALTH_EXIT=4
  run "$DEPLOY/deploy.sh" 1.2.3
  [ "$status" -eq 1 ]
  [[ "$output" == *"health did not report 1.2.3 within 3 minutes"* ]]
}

@test "ASCII mode and plain output" {
  run "$DEPLOY/deploy.sh" 1.2.3 --ascii
  [ "$status" -eq 0 ]
  [[ "$output" == *"OK Passed: Docker Desktop is running"* ]]
  [[ "$output" != *$'\e['* ]]
}
