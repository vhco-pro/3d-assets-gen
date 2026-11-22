#!/usr/bin/env bash
# Shared pieces of the deploy scripts: options, the release record, image verification and remote steps.
# Source after report.sh and tools.sh. Tests replace the external commands through PATH and the *_BIN
# variables (COSIGN_BIN, GH_BIN).
DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="vhco-pro/3d-assets-gen"
IMAGE_REPO="ghcr.io/vhco-pro/3d-assets-gen"
WIN_HOST="${ASSET_STUDIO_HOST:-win-main}"
CERT_IDENTITY='^https://github\.com/vhco-pro/3d-assets-gen/\.github/workflows/ci\.yml@refs/heads/.+$'
CERT_ISSUER='https://token.actions.githubusercontent.com'
SPDX_PREDICATE='https://spdx.dev/Document/v2.3'

cosign_bin() { printf '%s\n' "${COSIGN_BIN:-$(tool_path cosign)}"; }
gh_bin() { printf '%s\n' "${GH_BIN:-$(tool_path gh)}"; }

# Prints "version commit digest" from the GitHub Release record of v<version>.
release_record() {
  local version="$1" gh json
  gh="$(gh_bin)"
  json="$("$gh" release download "v${version}" -R "$REPO" -p release.json -O - 2>/dev/null)" || return 1
  python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["version"], d["commit"], d["digest"])' <<< "$json"
}

# Verifies the signature and the provenance and SBOM attestations of IMAGE_REPO@digest.
verify_image() {
  local digest="$1" ref="${IMAGE_REPO}@${1}" cosign gh
  cosign="$(cosign_bin)"
  gh="$(gh_bin)"
  "$cosign" verify --certificate-identity-regexp "$CERT_IDENTITY" --certificate-oidc-issuer "$CERT_ISSUER" "$ref" > /dev/null || return 1
  "$gh" attestation verify "oci://${ref}" --repo "$REPO" > /dev/null || return 1
  "$gh" attestation verify "oci://${ref}" --repo "$REPO" --predicate-type "$SPDX_PREDICATE" > /dev/null || return 1
  [[ -n "$digest" ]]
}

# Runs scripts/deploy/remote/<name>.ps1 on win-main with arguments.
remote() {
  local name="$1"
  shift
  local file="asset-studio-${name}.ps1"
  scp -q -o BatchMode=yes "${DEPLOY_DIR}/remote/${name}.ps1" "${WIN_HOST}:${file}" || return 1
  local status=0
  ssh -o BatchMode=yes "$WIN_HOST" "powershell -NoProfile -ExecutionPolicy Bypass -File ${file} $*" || status=$?
  ssh -o BatchMode=yes "$WIN_HOST" "del ${file}" > /dev/null 2>&1 || true
  return "$status"
}

# Copies a file into %LOCALAPPDATA%\AssetStudio on win-main.
remote_copy() {
  scp -q -o BatchMode=yes "$1" "${WIN_HOST}:AppData/Local/AssetStudio/$(basename "$1")"
}

# Pulls IMAGE_REPO@digest locally, tags it, streams it to win-main and compares layer diff IDs.
load_image() {
  local digest="$1" tag="$2" local_layers remote_layers
  docker pull -q "${IMAGE_REPO}@${digest}" > /dev/null || return 1
  docker tag "${IMAGE_REPO}@${digest}" "$tag" || return 1
  docker save "$tag" | ssh -o BatchMode=yes "$WIN_HOST" "docker load" > /dev/null || return 1
  local_layers="$(docker image inspect --format '{{json .RootFS.Layers}}' "$tag")"
  remote_layers="$(remote layers "$tag" | tr -d '\r')"
  [[ -n "$local_layers" && "$local_layers" == "$remote_layers" ]]
}

# Step 4 of deploy.sh: compares the schema the new image knows with the schema the database on win-main
# holds, before anything there changes. Sets GUARD_KNOWN and GUARD_DB (a number or "none"). Returns 0 to
# proceed, 1 when the image knows an older schema, 2 when the database's schema could not be read.
# The reader mounts the volume read-write: SQLite opens the database read-only but may need to create
# the -wal and -shm files of a cleanly closed WAL database.
DATA_VOLUME="asset-studio_data"
win() { ssh -o BatchMode=yes "$WIN_HOST" "$1"; }
read_database_schema() {
  win "docker run --rm -v ${DATA_VOLUME}:/data $1 database-schema-version" 2>&1 | tr -d '\r'
  return "${PIPESTATUS[0]}"
}
schema_guard() {
  local tag="$1" out status current_tag
  GUARD_KNOWN="?"
  # No volume yet (a first deploy): nothing to compare, and no container runs, so Compose creates it.
  if ! out="$(win "docker volume inspect ${DATA_VOLUME}" 2>&1 > /dev/null)"; then
    [[ "$out" == *"no such volume"* ]] || return 2
    GUARD_DB="none"
    return 0
  fi
  GUARD_KNOWN="$(win "docker run --rm ${tag} schema-version" | tr -d '\r' | tail -1)" || return 2
  [[ "$GUARD_KNOWN" =~ ^[0-9]+$ ]] || return 2
  status=0
  out="$(read_database_schema "$tag")" || status=$?
  if [[ $status -ne 0 && "$out" == *"unknown command"* ]]; then
    # A release from before the guard: read the database with the deployed image instead.
    current_tag="$(win "type AppData\\Local\\AssetStudio\\current.json" 2> /dev/null | tr -d '\r' \
      | python3 -c 'import json,sys; print(json.load(sys.stdin)["tag"])' 2> /dev/null)" || return 2
    [[ -n "$current_tag" ]] || return 2
    status=0
    out="$(read_database_schema "$current_tag")" || status=$?
  fi
  [[ $status -eq 0 ]] || return 2
  GUARD_DB="$(tail -1 <<< "$out")"
  [[ "$GUARD_DB" == "none" ]] && return 0
  [[ "$GUARD_DB" =~ ^[0-9]+$ ]] || return 2
  (( GUARD_KNOWN < GUARD_DB )) && return 1
  return 0
}
