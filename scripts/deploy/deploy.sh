#!/usr/bin/env bash
# Deploys a released version of Asset Studio to win-main.
#   scripts/deploy/deploy.sh <version> [--rotate-token] [--ascii]
# Order: Docker Desktop in the owner's session, the release record and image verification, the image
# streamed to win-main, the schema guard, files and config prepared, Compose up, then health and
# tailscale serve.
set -euo pipefail
LIB="$(cd "$(dirname "$0")" && pwd)/lib"
VERSION=""
ROTATE=""
for arg in "$@"; do
  case "$arg" in
    --rotate-token) ROTATE="-RotateToken" ;;
    --ascii) export ASSET_STUDIO_ASCII=1 ;;
    -*) echo "unknown option: $arg" >&2; exit 2 ;;
    *) VERSION="$arg" ;;
  esac
done
# shellcheck source-path=SCRIPTDIR source=lib/report.sh
source "$LIB/report.sh"
# shellcheck source-path=SCRIPTDIR source=lib/tools.sh
source "$LIB/tools.sh"
# shellcheck source-path=SCRIPTDIR source=lib/common.sh
source "$LIB/common.sh"
[[ -n "$VERSION" ]] || { report_fail "usage: deploy.sh <version> [--rotate-token] [--ascii]"; exit 2; }
TAG="${IMAGE_REPO}:${VERSION}"

report_step "Ensuring Docker Desktop runs in the owner's session on ${WIN_HOST}"
if ! remote ensure-docker > /dev/null; then
  report_fail "Docker Desktop did not answer within 3 minutes; is the owner signed in on ${WIN_HOST}?"
  exit 1
fi
report_pass "Docker Desktop is running"

report_step "Reading the release record of v${VERSION}"
if ! read -r rec_version COMMIT DIGEST < <(release_record "$VERSION"); then
  report_fail "no GitHub Release record for v${VERSION}; only versions whose scan passed can be deployed"
  exit 1
fi
[[ "$rec_version" == "$VERSION" && "$DIGEST" == sha256:* ]] || { report_fail "the release record of v${VERSION} is malformed"; exit 1; }
report_pass "v${VERSION} is ${DIGEST} from ${COMMIT:0:12}"

report_step "Verifying the signature and attestations"
verify_image "$DIGEST" || { report_fail "signature or attestation check failed for ${DIGEST}"; exit 1; }
report_pass "signature, provenance and SBOM verified"

report_step "Loading the image on ${WIN_HOST}"
load_image "$DIGEST" "$TAG" || { report_fail "the image could not be loaded on ${WIN_HOST} with matching layers"; exit 1; }
report_pass "loaded ${TAG} with matching layers"

report_step "Comparing the schema v${VERSION} knows with the database on ${WIN_HOST}"
guard=0
schema_guard "$TAG" || guard=$?
case "$guard" in
  0) if [[ "$GUARD_KNOWN" == "?" ]]; then report_pass "no data volume on ${WIN_HOST} yet; nothing to compare"
     elif [[ "$GUARD_DB" == "none" ]]; then report_pass "v${VERSION} knows schema ${GUARD_KNOWN}; no database yet"
     else report_pass "v${VERSION} knows schema ${GUARD_KNOWN}; the database is at schema ${GUARD_DB}"; fi ;;
  1) report_fail "v${VERSION} knows schema ${GUARD_KNOWN} but the database on ${WIN_HOST} is at schema ${GUARD_DB}; use rollback.sh to go back to an older schema"
     exit 1 ;;
  *) report_fail "could not read the database's schema on ${WIN_HOST}; nothing was changed"
     exit 1 ;;
esac

report_step "Preparing %LOCALAPPDATA%\\AssetStudio"
remote prepare -Version "$VERSION" -Tag "$TAG" -Digest "$DIGEST" "$ROTATE" > /dev/null || { report_fail "could not prepare the AssetStudio folder"; exit 1; }
remote_copy "${DEPLOY_DIR}/compose.yaml" || { report_fail "could not copy compose.yaml"; exit 1; }
remote_copy "${DEPLOY_DIR}/start-asset-studio.ps1" || { report_fail "could not copy start-asset-studio.ps1"; exit 1; }
remote up > /dev/null || { report_fail "docker compose up failed"; exit 1; }
report_pass "Compose project up on ${TAG}"

report_step "Waiting for health to report ${VERSION} (${COMMIT:0:12})"
remote health -Version "$VERSION" -Commit "$COMMIT" > /dev/null || { report_fail "health did not report ${VERSION} within 3 minutes"; exit 1; }
report_pass "Asset Studio ${VERSION} is serving through tailscale serve"
