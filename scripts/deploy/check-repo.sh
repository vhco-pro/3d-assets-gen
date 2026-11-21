#!/usr/bin/env bash
# Checks the public repository's settings, licence, security workflows and Renovate onboarding.
#   scripts/deploy/check-repo.sh [--ascii]
set -euo pipefail
LIB="$(cd "$(dirname "$0")" && pwd)/lib"
[[ " $* " == *" --ascii "* ]] && export ASSET_STUDIO_ASCII=1
# shellcheck source-path=SCRIPTDIR source=lib/report.sh
source "$LIB/report.sh"
# shellcheck source-path=SCRIPTDIR source=lib/tools.sh
source "$LIB/tools.sh"
# shellcheck source-path=SCRIPTDIR source=lib/common.sh
source "$LIB/common.sh"
GH="$(gh_bin)"

check() {
  local name="$1"
  shift
  if "$@"; then report_pass "$name"; else report_fail "$name"; fi
}

repo_json="$("$GH" api "repos/${REPO}")"
field() { python3 -c "import json,sys; d=json.load(sys.stdin); v=d; [v:=v.get(k, {}) if isinstance(v, dict) else {} for k in sys.argv[1].split('.')]; print(v)" "$1" <<< "$repo_json"; }
check "public visibility" test "$(field visibility)" = "public"
check "licence apache-2.0" test "$(field license.key)" = "apache-2.0"
check "delete_branch_on_merge" test "$(field delete_branch_on_merge)" = "True"
check "secret scanning" test "$(field security_and_analysis.secret_scanning.status)" = "enabled"
check "push protection" test "$(field security_and_analysis.secret_scanning_push_protection.status)" = "enabled"
check "dependency graph" "$GH" api "repos/${REPO}/dependency-graph/sbom" --silent
check "Dependabot alerts" "$GH" api "repos/${REPO}/vulnerability-alerts" --silent

workflows_ok() {
  local root="$DEPLOY_DIR/../.."
  grep -Eq 'vhco-pro/\.github/\.github/workflows/reusable-codeql-js\.yml@[0-9a-f]{40}' "$root/.github/workflows/codeql.yml" &&
    grep -Eq 'languages: *javascript-typescript,python' "$root/.github/workflows/codeql.yml" &&
    grep -Eq 'vhco-pro/\.github/\.github/workflows/reusable-codeql-actions\.yml@[0-9a-f]{40}' "$root/.github/workflows/codeql.yml" &&
    grep -Eq 'vhco-pro/\.github/\.github/workflows/reusable-scorecard\.yml@[0-9a-f]{40}' "$root/.github/workflows/scorecard.yml"
}
check "CodeQL and Scorecard call the reusable workflows at a commit" workflows_ok
for wf in codeql.yml scorecard.yml; do
  check "a successful ${wf} run on main" test "$("$GH" run list -R "$REPO" -w "$wf" -b main -s success -L 1 --json databaseId --jq length)" = "1"
done
check "Python is analysed by CodeQL" test -n "$("$GH" api "repos/${REPO}/code-scanning/alerts?per_page=100&state=open" --jq '.[].rule.id' 2>/dev/null | grep -m1 '^py/' || "$GH" api "repos/${REPO}/code-scanning/analyses?per_page=20" --jq '.[] | select(.category == "/language:js-ts") | .tool.name' | head -1)"
check "renovate.json on main" "$GH" api "repos/${REPO}/contents/renovate.json?ref=main" --silent
renovate_active() {
  [[ "$("$GH" issue list -R "$REPO" --search 'Dependency Dashboard in:title' --json number --jq length)" != "0" ]] ||
    [[ "$("$GH" pr list -R "$REPO" --author 'app/vhco-renovate' --state all --json number --jq length)" != "0" ]]
}
check "Renovate is active (Dependency Dashboard or a Renovate PR)" renovate_active

[[ "$REPORT_FAILED" == "0" ]] || exit 1
