#!/usr/bin/env bash
# Runs the AC-15 upgrade, rollback and logon-recovery procedure on win-main for two released versions and
# keeps what it observed in .artifacts/check-upgrade.log, so anyone can rerun the check.
#   scripts/deploy/check-upgrade.sh <first version> <second version> [--ascii]
# It changes the deployment: it ends on <second version>, with <first version> recorded as previous.
set -euo pipefail
LIB="$(cd "$(dirname "$0")" && pwd)/lib"
[[ " $* " == *" --ascii "* ]] && export ASSET_STUDIO_ASCII=1
# shellcheck source-path=SCRIPTDIR source=lib/report.sh
source "$LIB/report.sh"
# shellcheck source-path=SCRIPTDIR source=lib/tools.sh
source "$LIB/tools.sh"
# shellcheck source-path=SCRIPTDIR source=lib/common.sh
source "$LIB/common.sh"

FIRST="${1:-}"
SECOND="${2:-}"
[[ -n "$FIRST" && -n "$SECOND" && "$FIRST" != --* && "$SECOND" != --* ]] || { report_fail "usage: check-upgrade.sh <first version> <second version>"; exit 2; }
DEPLOY="${ASSET_STUDIO_DEPLOY:-$DEPLOY_DIR/deploy.sh}"
ROLLBACK="${ASSET_STUDIO_ROLLBACK:-$DEPLOY_DIR/rollback.sh}"
HEALTH_WAIT_S="${ASSET_STUDIO_HEALTH_WAIT_S:-300}"
LOG="${ASSET_STUDIO_UPGRADE_LOG:-$DEPLOY_DIR/../../.artifacts/check-upgrade.log}"
mkdir -p "$(dirname "$LOG")"
: > "$LOG"
log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" >> "$LOG"; }

read -r _ FIRST_COMMIT _ < <(release_record "$FIRST") || { report_fail "no GitHub Release record for v${FIRST}"; exit 1; }
read -r _ SECOND_COMMIT _ < <(release_record "$SECOND") || { report_fail "no GitHub Release record for v${SECOND}"; exit 1; }

state() { remote state | tr -d '\r' | tail -1; }
field() { python3 -c 'import json,sys; print(json.loads(sys.argv[1])[sys.argv[2]])' "$1" "$2"; }
check() {
  local name="$1"
  shift
  if "$@"; then report_pass "$name"; log "PASS $name"; else report_fail "$name"; log "FAIL $name"; fi
}
deploy() {
  report_step "Deploying ${1}"
  "$DEPLOY" "$1" > /dev/null 2>&1 || { report_fail "deploy.sh ${1} failed"; log "FAIL deploy ${1}"; exit 1; }
  log "deployed $1"
}

deploy "$FIRST"
s1="$(state)"; log "state after first deploy: $s1"
deploy "$SECOND"
s2="$(state)"; log "state after second deploy: $s2"
check "config.yaml unchanged by the second deploy" test "$(field "$s2" config)" = "$(field "$s1" config)"
check "previous version recorded as ${FIRST}" test "$(field "$s2" previous)" = "$FIRST"
check "job rows intact after the second deploy" test "$(field "$s2" jobs)" = "$(field "$s1" jobs)"
deploy "$SECOND"
s3="$(state)"; log "state after rerun: $s3"
check "rerun keeps ${FIRST} as the previous version" test "$(field "$s3" previous)" = "$FIRST"
check "config.yaml unchanged by the rerun" test "$(field "$s3" config)" = "$(field "$s1" config)"

report_step "Removing the ${FIRST} image and rolling back"
ssh -o BatchMode=yes "$WIN_HOST" "docker image rm ${IMAGE_REPO}:${FIRST}" > /dev/null 2>&1 || true
log "removed ${IMAGE_REPO}:${FIRST}"
rollback_out="$("$ROLLBACK" 2>&1)" || { report_fail "rollback.sh failed"; log "FAIL rollback: $rollback_out"; exit 1; }
log "rollback output: $(tr '\n' '|' <<< "$rollback_out")"
check "rollback reloaded the removed ${FIRST} image" grep -q "Reloading ${IMAGE_REPO}:${FIRST}" <<< "$rollback_out"
s4="$(state)"; log "state after rollback: $s4"
check "current.json names ${FIRST}" test "$(field "$s4" current)" = "$FIRST"
check ".env names ${FIRST}" test "$(field "$s4" env)" = "${IMAGE_REPO}:${FIRST}"
check "health reports ${FIRST} at ${FIRST_COMMIT:0:12}" test "$(field "$s4" health)" = "${FIRST} ${FIRST_COMMIT}"
check "job rows intact after the rollback" test "$(field "$s4" jobs)" = "$(field "$s1" jobs)"

deploy "$SECOND"
report_step "Logon recovery: compose down, remove the ${SECOND} image, start AssetStudio-Logon"
logon_out="$(remote logon-test -Tag "${IMAGE_REPO}:${SECOND}" | tr -d '\r')" || { report_fail "could not set up the logon test"; log "FAIL logon setup: $logon_out"; exit 1; }
log "logon setup: $logon_out"
check "the ${SECOND} image was absent before the logon task ran" grep -q "image absent" <<< "$logon_out"
started="$(date +%s)"
recovered=""
while (( $(date +%s) - started <= HEALTH_WAIT_S )); do
  s5="$(state 2>/dev/null || true)"
  if [[ -n "$s5" && "$(field "$s5" health 2>/dev/null)" == "${SECOND} ${SECOND_COMMIT}" ]]; then recovered="$(( $(date +%s) - started ))"; break; fi
  sleep 10
done
log "logon recovery after ${recovered:-timeout} s"
check "the logon task brought ${SECOND} back within $(( HEALTH_WAIT_S / 60 )) minutes${recovered:+ (${recovered} s)}" test -n "$recovered"

report_step "Observations kept in .artifacts/check-upgrade.log"
[[ "$REPORT_FAILED" == "0" ]] || exit 1
