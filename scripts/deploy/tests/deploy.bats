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

# Step 4: the schema guard (AC-15). A refusal leaves win-main untouched: no prepare, copy or Compose call.
untouched() {
  [ "$(call_line 'asset-studio-prepare.ps1')" = "" ]
  [ "$(call_line 'asset-studio-up.ps1')" = "" ]
  ! grep -q 'compose.yaml' "$CALLS"
}

@test "the schema guard runs after the image is loaded and before anything is prepared" {
  run "$DEPLOY/deploy.sh" 1.2.3
  [ "$status" -eq 0 ]
  load=$(call_line "docker load")
  guard=$(call_line "database-schema-version")
  prepare=$(call_line "asset-studio-prepare.ps1")
  [ "$guard" -gt "$load" ] && [ "$prepare" -gt "$guard" ]
  [[ "$output" == *"✓ Passed: v1.2.3 knows schema 2; the database is at schema 2"* ]]
}

@test "an image that knows an older schema than the database is refused before anything changes" {
  export STUB_NEW_SCHEMA=1
  run "$DEPLOY/deploy.sh" 1.2.3
  [ "$status" -eq 1 ]
  [[ "$output" == *"✗ Failed: v1.2.3 knows schema 1 but the database on win-main is at schema 2; use rollback.sh to go back to an older schema"* ]]
  untouched
}

@test "an equal or higher schema, or no database file yet, proceeds" {
  export STUB_NEW_SCHEMA=3
  run "$DEPLOY/deploy.sh" 1.2.3
  [ "$status" -eq 0 ]
  export STUB_NEW_SCHEMA=2 STUB_NEW_DB_SCHEMA=none
  : > "$CALLS"
  run "$DEPLOY/deploy.sh" 1.2.3
  [ "$status" -eq 0 ]
  [[ "$output" == *"no database yet"* ]]
}

@test "a missing data volume proceeds without running any container" {
  export STUB_VOLUME=missing
  run "$DEPLOY/deploy.sh" 1.2.3
  [ "$status" -eq 0 ]
  ! grep -q 'docker run' "$CALLS"
}

@test "any other docker volume inspect error stops the deploy" {
  export STUB_VOLUME=error
  run "$DEPLOY/deploy.sh" 1.2.3
  [ "$status" -eq 1 ]
  [[ "$output" == *"could not read the database's schema on win-main"* ]]
  untouched
}

@test "the reader mounts the volume read-write and opens the database itself read-only" {
  run "$DEPLOY/deploy.sh" 1.2.3
  [ "$status" -eq 0 ]
  line=$(grep -m1 'database-schema-version' "$CALLS")
  [[ "$line" == *"-v asset-studio_data:/data "* ]]
  [[ "$line" != *":/data:ro"* ]]
}

@test "a pre-revision image is checked with the deployed image's reader" {
  export STUB_NEW_DB_SCHEMA=unknown STUB_OLD_DB_SCHEMA=2
  run "$DEPLOY/deploy.sh" 1.2.3
  [ "$status" -eq 0 ]
  grep -q 'ghcr.io/vhco-pro/3d-assets-gen:1.2.2 database-schema-version' "$CALLS"
}

@test "no reader, a failing reader or no deployed image to fall back on stops the deploy" {
  export STUB_NEW_DB_SCHEMA=unknown STUB_OLD_DB_SCHEMA=unknown
  run "$DEPLOY/deploy.sh" 1.2.3
  [ "$status" -eq 1 ]
  [[ "$output" == *"could not read the database's schema on win-main"* ]]
  untouched
  export STUB_NEW_DB_SCHEMA=fail
  : > "$CALLS"
  run "$DEPLOY/deploy.sh" 1.2.3
  [ "$status" -eq 1 ]
  untouched
  export STUB_NEW_DB_SCHEMA=unknown STUB_CURRENT_JSON=""
  : > "$CALLS"
  run "$DEPLOY/deploy.sh" 1.2.3
  [ "$status" -eq 1 ]
  untouched
}
