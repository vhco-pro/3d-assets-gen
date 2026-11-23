#!/usr/bin/env bash
# bun run verify: every check, in the order the feature document's Verification commands give.
# Needs Bun, Docker and python3. Stops at the first failing step. Pass --ascii for ASCII status symbols.
set -euo pipefail
cd "$(dirname "$0")/.."
[[ " $* " == *" --ascii "* ]] && export ASSET_STUDIO_ASCII=1
source scripts/deploy/lib/report.sh
source scripts/deploy/lib/tools.sh

IMAGE="${IMAGE:-asset-studio:local}"
VERSION="${APP_VERSION:-0.0.0-local}"
COMMIT="${APP_COMMIT:-$(git rev-parse HEAD 2>/dev/null || echo unknown)}"

step() {
  local name="$1"
  shift
  report_step "$name"
  if "$@"; then
    report_pass "$name"
  else
    report_fail "$name"
    exit 1
  fi
}

shell_checks() {
  local sc
  sc="$(tool_path shellcheck)"
  local files=(scripts/verify.sh)
  shopt -s nullglob
  files+=(scripts/ci/*.sh scripts/deploy/*.sh scripts/deploy/lib/*.sh scripts/deploy/tests/*.bash scripts/phone/*.sh)
  shopt -u nullglob
  "$sc" -x "${files[@]}"
}

shell_tests() {
  if compgen -G "scripts/deploy/tests/*.bats" > /dev/null; then
    bunx bats scripts/deploy/tests
  else
    report_skip "no bats tests in scripts/deploy/tests yet"
  fi
}

workflow_tests() {
  if [[ -d .github/tests ]]; then
    bun test ./.github
  else
    report_skip "no workflow tests in .github/tests yet"
  fi
}

docs_tests() {
  if [[ -d app/docs ]] && compgen -G "app/docs/*.test.ts" > /dev/null; then
    bun test ./app/docs
  else
    report_skip "no docs check in app/docs yet"
  fi
}

step "type check" bun run typecheck
step "lint" bun run lint
step "shellcheck" shell_checks
step "actionlint" scripts/ci/actionlint.sh .github/workflows
step "unit tests" bun test app --path-ignore-patterns='app/e2e/**' --path-ignore-patterns='app/image/**' --path-ignore-patterns='app/memory/**'
step "workflow tests" workflow_tests
step "phone script tests" bun test ./scripts/phone
step "shell tests" shell_tests
step "golden check" bun run golden:check
step "page build" bun run build:web
step "bundle budgets" bun run size
step "image build" docker build -q -t "$IMAGE" --build-arg "APP_VERSION=$VERSION" --build-arg "APP_COMMIT=$COMMIT" .
step "image start check" env IMAGE="$IMAGE" EXPECT_VERSION="$VERSION" EXPECT_COMMIT="$COMMIT" bun test ./app/image
step "memory check" env IMAGE="$IMAGE" bun test ./app/memory
step "dev readiness" bun run dev -- --check
step "docs check" docs_tests
# A host without WebKit's libraries may leave the WebKit projects out; such a run is never WebKit evidence.
if [[ "${E2E_SKIP_WEBKIT:-}" == "1" ]]; then
  report_skip "WebKit journeys skipped (E2E_SKIP_WEBKIT=1)"
fi
step "browser journeys" env E2E_IMAGE="$IMAGE" bunx playwright test
report_pass "verify finished"
