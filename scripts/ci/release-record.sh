#!/usr/bin/env bash
# Creates the GitHub Release for a tag the version job pushed, with release.json holding the version,
# commit and image digest. deploy.sh and check-image.sh read only this record. Prereleases are marked.
set -euo pipefail
: "${VERSION:?}" "${TAG:?}" "${DIGEST:?}" "${COMMIT:?}"
[[ "$DIGEST" == sha256:* ]] || { echo "release digest missing or malformed: ${DIGEST}" >&2; exit 1; }
dir="$(mktemp -d)"
trap 'rm -rf "$dir"' EXIT
printf '{"version": "%s", "commit": "%s", "digest": "%s"}\n' "$VERSION" "$COMMIT" "$DIGEST" > "$dir/release.json"
prerelease=()
[[ "$VERSION" == *-* ]] && prerelease=(--prerelease)
gh release create "$TAG" "$dir/release.json" --verify-tag --title "$TAG" \
  --notes "Image ghcr.io/vhco-pro/3d-assets-gen@${DIGEST} built from ${COMMIT}." "${prerelease[@]}"
