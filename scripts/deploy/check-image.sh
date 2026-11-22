#!/usr/bin/env bash
# Checks a published version: anonymous pull from the public package, the release record, signature and
# attestations, then the image start check against that digest.
#   scripts/deploy/check-image.sh <version> [--ascii]
set -euo pipefail
LIB="$(cd "$(dirname "$0")" && pwd)/lib"
VERSION=""
for arg in "$@"; do
  case "$arg" in
    --ascii) export ASSET_STUDIO_ASCII=1 ;;
    *) VERSION="$arg" ;;
  esac
done
# shellcheck source-path=SCRIPTDIR source=lib/report.sh
source "$LIB/report.sh"
# shellcheck source-path=SCRIPTDIR source=lib/tools.sh
source "$LIB/tools.sh"
# shellcheck source-path=SCRIPTDIR source=lib/common.sh
source "$LIB/common.sh"
[[ -n "$VERSION" ]] || { report_fail "usage: check-image.sh <version>"; exit 2; }

read -r rec_version COMMIT DIGEST < <(release_record "$VERSION") || { report_fail "no GitHub Release record for v${VERSION}"; exit 1; }
[[ "$rec_version" == "$VERSION" ]] || { report_fail "the release record names ${rec_version}"; exit 1; }
report_pass "release record: ${DIGEST}"

anon="$(mktemp -d)"
trap 'rm -rf "$anon"' EXIT
echo '{}' > "$anon/config.json"
if DOCKER_CONFIG="$anon" docker pull -q "${IMAGE_REPO}@${DIGEST}" > /dev/null; then
  report_pass "anonymous pull works (the package is public)"
else
  report_fail "anonymous pull of ${DIGEST} failed; is the package public?"
  exit 1
fi

verify_image "$DIGEST" || { report_fail "signature or attestation check failed"; exit 1; }
report_pass "signature, provenance and SBOM verified"

cd "$DEPLOY_DIR/../.."
if IMAGE="${IMAGE_REPO}@${DIGEST}" EXPECT_VERSION="$VERSION" EXPECT_COMMIT="$COMMIT" bun test ./app/image > /dev/null 2>&1; then
  report_pass "the published image starts as UID 65532, read-only, with a fresh volume, and reports ${VERSION}"
else
  report_fail "the published image failed its start check (run bun test ./app/image with IMAGE set for details)"
  exit 1
fi
