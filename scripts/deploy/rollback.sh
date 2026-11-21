#!/usr/bin/env bash
# Rolls win-main back to the previous version recorded by deploy.sh.
#   scripts/deploy/rollback.sh [--ascii]
set -euo pipefail
LIB="$(cd "$(dirname "$0")" && pwd)/lib"
[[ " $* " == *" --ascii "* ]] && export ASSET_STUDIO_ASCII=1
# shellcheck source-path=SCRIPTDIR source=lib/report.sh
source "$LIB/report.sh"
# shellcheck source-path=SCRIPTDIR source=lib/tools.sh
source "$LIB/tools.sh"
# shellcheck source-path=SCRIPTDIR source=lib/common.sh
source "$LIB/common.sh"

report_step "Ensuring Docker Desktop runs in the owner's session on ${WIN_HOST}"
remote ensure-docker > /dev/null || { report_fail "Docker Desktop did not answer within 3 minutes; is the owner signed in on ${WIN_HOST}?"; exit 1; }
report_pass "Docker Desktop is running"

PREVIOUS="$(ssh -o BatchMode=yes "$WIN_HOST" "type AppData\\Local\\AssetStudio\\previous.json" 2>/dev/null | tr -d '\r' | python3 -c 'import json,sys; print(json.load(sys.stdin)["version"])' 2>/dev/null || true)"
[[ -n "$PREVIOUS" ]] || { report_none "no previous version is recorded; nothing changed"; exit 1; }
TAG="${IMAGE_REPO}:${PREVIOUS}"
report_step "Rolling back to ${PREVIOUS}"

if ! remote has-image -Tag "$TAG" > /dev/null; then
  report_step "Reloading ${TAG}"
  read -r _ _ DIGEST < <(release_record "$PREVIOUS") || { report_fail "no GitHub Release record for v${PREVIOUS}; nothing changed"; exit 1; }
  verify_image "$DIGEST" || { report_fail "signature or attestation check failed for ${DIGEST}; nothing changed"; exit 1; }
  load_image "$DIGEST" "$TAG" || { report_fail "could not load ${TAG}; nothing changed"; exit 1; }
  report_pass "reloaded ${TAG}"
fi

status=0
remote rollback > /dev/null || status=$?
case "$status" in
  0) report_pass "rolled back to ${PREVIOUS}" ;;
  6) report_fail "no backup matches the schema of ${PREVIOUS}"; exit 1 ;;
  *) report_fail "rollback failed on ${WIN_HOST} (exit ${status})"; exit 1 ;;
esac
