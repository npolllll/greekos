#!/usr/bin/env bash
# GreekOS — full end-to-end regression on a disposable copy of the system (GitHub Actions runner):
# local Supabase (Docker) with the project's migrations, the real corpus (database/02_content_data.sql),
# the same digital QA, corrections and content revisions as production, a production build of the app,
# then the Playwright suites: owner release → learners by one-time link → lessons with right and wrong
# answers → progress after signing in again → reviews → diagnostic → isolation → disabling; access rules;
# release routes; responsive screens. Touches no production service; paid providers are not configured.
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT=reports/ops
mkdir -p "$OUT"

echo "== local Supabase"
npx --yes supabase start -x studio,imgproxy,edge-runtime,logflare,vector,supavisor,postgres-meta >/dev/null
eval "$(npx --yes supabase status -o env 2>/dev/null | sed -E 's/^([A-Z_]+)=/export SB_\1=/')"
API=${SB_API_URL:?}; ANON=${SB_ANON_KEY:-${SB_PUBLISHABLE_KEY:-}}; SERVICE=${SB_SERVICE_ROLE_KEY:-${SB_SECRET_KEY:-}}; DB=${SB_DB_URL:?}
cat > .env.local <<EOF
NEXT_PUBLIC_SUPABASE_URL=$API
NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON
SUPABASE_SERVICE_ROLE_KEY=$SERVICE
DATABASE_URL=$DB
APP_URL=http://localhost:3210
APP_ENV=test
CRON_SECRET=e2e-cron-secret
REGISTRATION_SALT=e2e-salt
ASR_PROVIDER=none
TTS_PROVIDER=none
LLM_PROVIDER=none
EOF
# The copy never spends on paid providers: the runner's production keys are not passed to it.
unset ANTHROPIC_API_KEY AZURE_SPEECH_KEY OPENAI_API_KEY GOOGLE_TTS_API_KEY
set -a; . ./.env.local; set +a

echo "== real corpus, QA and recorded corrections (as in production)"
psql "$DB" -X -v ON_ERROR_STOP=1 -q -f ../database/02_content_data.sql
npx tsx scripts/qa-batch.ts --label "e2e: первый полный прогон" > "$OUT/qa-first.json"
npx tsx --conditions=react-server scripts/qa-autofix.ts > "$OUT/qa-autofix.json"
npx tsx --conditions=react-server scripts/qa-engineering-fixes.ts > "$OUT/qa-engineering.json"
npx tsx --conditions=react-server scripts/qa-content-revisions.ts | tee "$OUT/content-revisions.json"
npx tsx scripts/qa-batch.ts --label "e2e: полный прогон после правок" | tee "$OUT/qa-final.json"

# The product suite reads the corpus snapshot (git-ignored locally): export it from the loaded database.
mkdir -p .corpus-snapshot/HANDOFF_IMPORT
psql "$DB" -X -At -c "select json_agg(envelope order by item_id) from public.items where module <> 'synthetic_fixture'" > .corpus-snapshot/HANDOFF_IMPORT/items.json

echo "== production build and server"
npx next build > "$OUT/build.log" 2>&1 || { tail -40 "$OUT/build.log"; exit 1; }
(npx next start -p 3210 > "$OUT/server.log" 2>&1 &)
for i in $(seq 1 60); do curl -sf http://localhost:3210/api/health >/dev/null && break; sleep 2; done

echo "== Playwright"
npx playwright install --with-deps chromium >/dev/null
set +e
npx playwright test --project desktop-1440 --reporter=list --trace off \
  tests/e2e/registration.spec.ts tests/e2e/acceptance.spec.ts tests/e2e/release-route.spec.ts tests/e2e/journey.spec.ts tests/e2e/product.spec.ts \
  > "$OUT/e2e-desktop.txt" 2>&1
desk=$?
npx playwright test --project mobile-390 --reporter=list --trace off tests/e2e/journey.spec.ts tests/e2e/responsive.spec.ts > "$OUT/e2e-mobile.txt" 2>&1
mob=$?
set -e
tail -60 "$OUT/e2e-desktop.txt"; tail -25 "$OUT/e2e-mobile.txt"
cp -r test-results "$OUT/" 2>/dev/null || true
npx --yes supabase stop --no-backup >/dev/null 2>&1 || true
rm -f .env.local
[ "$desk" = 0 ] && [ "$mob" = 0 ] && echo "E2E OK" || { echo "::error::E2E failed (desktop $desk, mobile $mob)"; exit 1; }
