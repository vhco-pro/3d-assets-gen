#!/usr/bin/env bash
# Lints every workflow in a directory with the actionlint pinned in scripts/deploy/tools.env, using the
# pinned shellcheck for run: steps. bun run verify runs it on .github/workflows (conventions/github-actions.md).
#   scripts/ci/actionlint.sh <workflow directory>
set -euo pipefail
DIR="${1:?usage: actionlint.sh <workflow directory>}"
LIB="$(cd "$(dirname "$0")/../deploy/lib" && pwd)"
# shellcheck source-path=SCRIPTDIR source=../deploy/lib/tools.sh
source "$LIB/tools.sh"
actionlint="$(tool_path actionlint)"
shellcheck="$(tool_path shellcheck)"
shopt -s nullglob
files=("$DIR"/*.yml "$DIR"/*.yaml)
[[ ${#files[@]} -gt 0 ]] || { echo "no workflows in $DIR" >&2; exit 1; }
"$actionlint" -shellcheck "$shellcheck" "${files[@]}"
