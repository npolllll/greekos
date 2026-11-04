#!/usr/bin/env bash
# GreekOS — full acceptance run on this machine (docs/ACCEPTANCE.md).
# Needs the local stack running: Supabase (npx supabase start), npm run local:speech, npm run local:llm,
# npm run voice:gateway and the app (npm run dev, or npm run build && npm run start on port 3210).
# Every step writes its log; nothing is skipped silently and nothing is released.
set -u
cd "$(dirname "$0")/.."
OUT="../verification/$(date +%F)_acceptance"
mkdir -p "$OUT"
[ -f .env.local ] && { set -a; . ./.env.local; set +a; }
run() {
  local name="$1"; shift
  echo "== $name"
  "$@" > "$OUT/$name.log" 2>&1
  local code=$?
  echo "$name exit $code" | tee -a "$OUT/$name.log"
  echo "$name $code" >> "$OUT/SUMMARY.txt"
}
: > "$OUT/SUMMARY.txt"
run 00_local_doctor npm run local:doctor
run 01_typecheck npm run typecheck
run 02_lint npm run lint
run 03_unit npm test
run 04_integration npm run test:integration
# Chromium keeps its shared memory in TMPDIR (Playwright passes --disable-dev-shm-usage); on a Linux
# box with a large RAM-backed /dev/shm use it, so a nearly full disk cannot crash browser tabs.
E2E_TMP=${TMPDIR:-}
if [ -z "$E2E_TMP" ] && [ -d /dev/shm ] && [ "$(df -Pk /dev/shm | awk 'NR==2{print $4}')" -gt 2000000 ]; then E2E_TMP=/dev/shm; fi
run 05_e2e env ${E2E_TMP:+TMPDIR=$E2E_TMP} npm run test:e2e
run 06_rules_on_corpus npm run rules:corpus -- --out "$OUT/rules"
run 07_speaking_latency npm run speaking:latency -- --out "$OUT/speaking-latency"
run 08_admission_plan npx tsx --conditions=react-server scripts/admission-plan.ts --out "$OUT/admission"
run 09_build npm run build
echo
echo "Итог (0 = успешно):"
cat "$OUT/SUMMARY.txt"
echo "Журналы: $OUT"
