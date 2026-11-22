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

# Checks fail closed: a gh call that errors is a failed check carrying gh's error, never a missing result.
# gh_out usually runs inside $(...), a subshell, so it hands its error back through a file.
GH_ERROR_FILE="$(mktemp)"
trap 'rm -f "$GH_ERROR_FILE"' EXIT
gh_out() {
  local out
  if ! out="$("$GH" "$@" 2>&1)"; then
    tail -n 1 <<< "$out" > "$GH_ERROR_FILE"
    return 1
  fi
  printf '%s\n' "$out"
}
gh_error() { cat "$GH_ERROR_FILE"; }

if ! repo_json="$(gh_out api "repos/${REPO}")"; then
  report_fail "repository settings: $(gh_error)"
  exit 1
fi
field() { python3 -c "import json,sys; d=json.load(sys.stdin); v=d; [v:=v.get(k, {}) if isinstance(v, dict) else {} for k in sys.argv[1].split('.')]; print(v)" "$1" <<< "$repo_json"; }
check "public visibility" test "$(field visibility)" = "public"
check "licence apache-2.0" test "$(field license.key)" = "apache-2.0"
check "delete_branch_on_merge" test "$(field delete_branch_on_merge)" = "True"
check "secret scanning" test "$(field security_and_analysis.secret_scanning.status)" = "enabled"
check "push protection" test "$(field security_and_analysis.secret_scanning_push_protection.status)" = "enabled"
# Runs a gh call as a check; on failure the error is part of the reported line.
check_call() {
  local name="$1"
  shift
  if gh_out "$@" > /dev/null; then report_pass "$name"; else report_fail "${name}: $(gh_error)"; fi
}
check_call "dependency graph" api "repos/${REPO}/dependency-graph/sbom" --silent
check_call "Dependabot alerts" api "repos/${REPO}/vulnerability-alerts" --silent

workflows_ok() {
  local root="$DEPLOY_DIR/../.."
  grep -Eq 'vhco-pro/\.github/\.github/workflows/reusable-codeql-js\.yml@[0-9a-f]{40}' "$root/.github/workflows/codeql.yml" &&
    grep -Eq 'languages: *javascript-typescript,python' "$root/.github/workflows/codeql.yml" &&
    grep -Eq 'vhco-pro/\.github/\.github/workflows/reusable-codeql-actions\.yml@[0-9a-f]{40}' "$root/.github/workflows/codeql.yml" &&
    grep -Eq 'vhco-pro/\.github/\.github/workflows/reusable-scorecard\.yml@[0-9a-f]{40}' "$root/.github/workflows/scorecard.yml"
}
check "CodeQL and Scorecard call the reusable workflows at a commit" workflows_ok
for wf in codeql.yml scorecard.yml; do
  name="a successful ${wf} run on main"
  if runs="$(gh_out run list -R "$REPO" -w "$wf" -b main -s success -L 1 --json databaseId --jq length)"; then
    check "$name" test "$runs" = "1"
  else
    report_fail "${name}: $(gh_error)"
  fi
done
# Only analyses of main count; a pull request's analysis lists the same categories under refs/pull/.
# The js-ts analysis carries the Python results, because the CodeQL workflow names both languages.
js_name="a /language:js-ts analysis on main (JavaScript, TypeScript and Python)"
actions_name="an Actions analysis on main"
if categories="$(gh_out api "repos/${REPO}/code-scanning/analyses?ref=refs/heads/main&per_page=100" --jq '.[].category')"; then
  categories="$(sort -u <<< "$categories")"
  check "$js_name" grep -qx '/language:js-ts' <<< "$categories"
  check "$actions_name" grep -qx '/language:actions' <<< "$categories"
else
  report_fail "${js_name}: $(gh_error)"
  report_fail "${actions_name}: $(gh_error)"
fi
check_call "renovate.json on main" api "repos/${REPO}/contents/renovate.json?ref=main" --silent
# The vhco-renovate installation's repository list cannot be read with the owner's token; a limited
# renovate-runner dry run proves the installation instead (AC-14), and Renovate's activity shows it here.
renovate_name="Renovate is active (Dependency Dashboard or a Renovate PR)"
if dashboards="$(gh_out issue list -R "$REPO" --search 'Dependency Dashboard in:title' --json number --jq length)" &&
  prs="$(gh_out pr list -R "$REPO" --author 'app/vhco-renovate' --state all --json number --jq length)"; then
  check "$renovate_name" test "$dashboards" != "0" -o "$prs" != "0"
else
  report_fail "${renovate_name}: $(gh_error)"
fi

[[ "$REPORT_FAILED" == "0" ]] || exit 1
