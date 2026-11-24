#!/usr/bin/env bash
# Records what a rollback must keep on win-main, and checks it against an earlier record (feature document
# asset-studio-mobile, AC-09): the job IDs, the schema version of the running image and of the database, the
# push public key and the push.json endpoints.
#   scripts/deploy/check-rollback.sh <label> [--against <earlier label>] [--ascii]
# The raw record goes to .artifacts/rollback-check/<label>.json. The output shows counts and the first 12 hex
# characters of each SHA-256, never the token or an endpoint (each is a capability URL).
set -euo pipefail
LIB="$(cd "$(dirname "$0")" && pwd)/lib"
[[ " $* " == *" --ascii "* ]] && export ASSET_STUDIO_ASCII=1
# shellcheck source-path=SCRIPTDIR source=lib/report.sh
source "$LIB/report.sh"
# shellcheck source-path=SCRIPTDIR source=lib/tools.sh
source "$LIB/tools.sh"
# shellcheck source-path=SCRIPTDIR source=lib/common.sh
source "$LIB/common.sh"

label="" against=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --against) against="${2:-}"; shift 2 ;;
    --ascii) shift ;;
    *) label="$1"; shift ;;
  esac
done
[[ -n "$label" ]] || { report_fail "usage: scripts/deploy/check-rollback.sh <label> [--against <earlier label>]"; exit 2; }
OUT_DIR="$DEPLOY_DIR/../../.artifacts/rollback-check"
mkdir -p "$OUT_DIR"
URL="https://${WIN_HOST}.tail6948f.ts.net"
[[ -n "${ASSET_STUDIO_URL:-}" ]] && URL="$ASSET_STUDIO_URL"

report_step "Recording ${label} on ${WIN_HOST}"
TOKEN="$(win 'type AppData\Local\AssetStudio\config.yaml' | tr -d '\r' | sed -n 's/^token: *//p')"
[[ -n "$TOKEN" ]] || { report_fail "could not read the token on ${WIN_HOST}"; exit 1; }
health="$(curl -fsS "$URL/api/health")"
jobs="$(curl -fsS -H "authorization: Bearer $TOKEN" "$URL/api/jobs")"
image="$(win 'docker inspect asset-studio-app-1 --format "{{.Config.Image}}"' | tr -d '\r')"
image_schema="$(win "docker run --rm $image schema-version" | tr -d '\r')"
db_schema="$(read_database_schema "$image")"
key="$(curl -fsS -H "authorization: Bearer $TOKEN" "$URL/api/push/key" 2>/dev/null || true)"
push="$(win "docker run --rm -v ${DATA_VOLUME}:/data alpine:3.22 cat /data/push.json" 2>/dev/null | tr -d '\r' || true)"
unset TOKEN

HEALTH="$health" JOBS="$jobs" IMAGE="$image" IMAGE_SCHEMA="$image_schema" DB_SCHEMA="$db_schema" KEY="$key" PUSH="$push" \
  python3 -I - "$OUT_DIR/$label.json" <<'PY'
import json, os, sys
def parse(s, default):
    try:
        return json.loads(s)
    except Exception:
        return default
push = parse(os.environ["PUSH"], {})
record = {
    "version": parse(os.environ["HEALTH"], {}).get("version"),
    "image": os.environ["IMAGE"],
    "image_schema": os.environ["IMAGE_SCHEMA"].strip(),
    "database_schema": os.environ["DB_SCHEMA"].strip(),
    "jobs": sorted(j["id"] for j in parse(os.environ["JOBS"], {"jobs": []})["jobs"]),
    "push_key": parse(os.environ["KEY"], {}).get("publicKey"),
    "endpoints": sorted(s["endpoint"] for s in push.get("subscriptions", [])),
}
json.dump(record, open(sys.argv[1], "w"), indent=2)
PY

SUMMARY="$(python3 -I - "$OUT_DIR/$label.json" <<'PY'
import hashlib, json, sys
r = json.load(open(sys.argv[1]))
h = lambda items: hashlib.sha256(" ".join(items).encode()).hexdigest()[:12] if items else "-"
key = hashlib.sha256(r["push_key"].encode()).hexdigest()[:12] if r["push_key"] else "none"
print(f'{r["version"]}: {len(r["jobs"])} jobs ({h(r["jobs"])}), image schema {r["image_schema"]}, database schema {r["database_schema"]}, push key {key}, {len(r["endpoints"])} endpoints ({h(r["endpoints"])})')
PY
)"
report_pass "${label}: ${SUMMARY}"

[[ -z "$against" ]] && exit 0
[[ -f "$OUT_DIR/$against.json" ]] || { report_fail "no record named ${against} in .artifacts/rollback-check"; exit 1; }
report_step "Checking ${label} against ${against}"
status=0
python3 -I - "$OUT_DIR/$against.json" "$OUT_DIR/$label.json" <<'PY' || status=$?
import json, sys
old, new = (json.load(open(p)) for p in sys.argv[1:3])
problems = []
missing = set(old["jobs"]) - set(new["jobs"])
if missing:
    problems.append(f"{len(missing)} recorded job(s) are gone")
if new["image_schema"] != old["image_schema"] or new["database_schema"] != old["database_schema"]:
    problems.append("a schema version changed")
if old["push_key"] and new["push_key"] and old["push_key"] != new["push_key"]:
    problems.append("the push key changed")
gone = set(old["endpoints"]) - set(new["endpoints"])
if gone:
    problems.append(f"{len(gone)} recorded endpoint(s) are gone from push.json")
for p in problems:
    print(p)
sys.exit(1 if problems else 0)
PY
if [[ "$status" -ne 0 ]]; then
  report_fail "${label} lost what ${against} recorded"
  exit 1
fi
report_pass "${label} keeps every job, both schema versions, the push key and every endpoint ${against} recorded"
