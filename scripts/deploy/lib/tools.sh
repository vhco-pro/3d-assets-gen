#!/usr/bin/env bash
# Downloads a pinned tool from scripts/deploy/tools.env into a cache, verifies its SHA-256 and prints the
# path of the executable. Source this file, then: shellcheck_bin=$(tool_path shellcheck)
TOOLS_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=../tools.env
source "${TOOLS_LIB_DIR}/../tools.env"

tool_path() {
  local name="$1" version sha url file inner
  case "$name" in
    shellcheck)
      version="$SHELLCHECK_VERSION" sha="$SHELLCHECK_SHA256"
      file="shellcheck-${version}.linux.x86_64.tar.xz"
      url="https://github.com/koalaman/shellcheck/releases/download/${version}/${file}"
      inner="shellcheck-${version}/shellcheck" ;;
    cosign)
      version="$COSIGN_VERSION" sha="$COSIGN_SHA256"
      file="cosign-linux-amd64"
      url="https://github.com/sigstore/cosign/releases/download/${version}/${file}"
      inner="" ;;
    gh)
      version="$GH_VERSION" sha="$GH_SHA256"
      file="gh_${version#v}_linux_amd64.tar.gz"
      url="https://github.com/cli/cli/releases/download/${version}/${file}"
      inner="gh_${version#v}_linux_amd64/bin/gh" ;;
    *)
      echo "unknown tool: $name" >&2
      return 2 ;;
  esac
  local cache="${XDG_CACHE_HOME:-$HOME/.cache}/asset-studio/tools/${name}-${version}"
  local bin="${cache}/${name}"
  if [[ -x "$bin" ]]; then
    printf '%s\n' "$bin"
    return 0
  fi
  mkdir -p "$cache"
  local tmp
  tmp="$(mktemp -d)"
  if ! curl -fsSL --retry 3 -o "${tmp}/${file}" "$url"; then
    rm -rf "$tmp"
    echo "download failed: $url" >&2
    return 1
  fi
  if ! printf '%s  %s\n' "$sha" "${tmp}/${file}" | sha256sum -c --quiet -; then
    rm -rf "$tmp"
    echo "checksum mismatch for ${file}" >&2
    return 1
  fi
  if [[ -z "$inner" ]]; then
    install -m 0755 "${tmp}/${file}" "$bin"
  else
    tar -xf "${tmp}/${file}" -C "$tmp"
    install -m 0755 "${tmp}/${inner}" "$bin"
  fi
  rm -rf "$tmp"
  printf '%s\n' "$bin"
}
