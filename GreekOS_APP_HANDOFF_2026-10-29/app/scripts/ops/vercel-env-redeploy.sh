#!/usr/bin/env bash
# GreekOS — restores production variables that a deploy lost and redeploys the app (no data steps).
# NEXT_PUBLIC_* values are public by design (inlined into the browser bundle) and are stored as plain
# configuration; Vercel CLI 65 stores new variables as secrets by default and silently skipped this one.
set -euo pipefail
ROOT=$(git rev-parse --show-toplevel)
T=(--token "${VERCEL_TOKEN:?}" --cwd "$ROOT")
npx --yes vercel link --yes --project "${VERCEL_PROJECT:-greekos-course}" "${T[@]}" >/dev/null
have=$(npx --yes vercel env ls production "${T[@]}" 2>/dev/null | awk '{print $1}')
add() {
  local name=$1 value=$2
  if grep -qx "$name" <<<"$have"; then echo "present: $name"; return 0; fi
  printf '%s' "$value" | npx --yes vercel env add "$name" production --type config "${T[@]}" 2>&1 | tail -3 \
    || printf '%s' "$value" | npx --yes vercel env add "$name" production "${T[@]}" 2>&1 | tail -3
}
add NEXT_PUBLIC_SUPABASE_ANON_KEY "${NEXT_PUBLIC_SUPABASE_ANON_KEY:?}"
add NEXT_PUBLIC_SUPABASE_URL "https://${SUPABASE_PROJECT_REF:?}.supabase.co"
now=$(npx --yes vercel env ls production "${T[@]}" 2>/dev/null | awk '{print $1}')
for v in NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY APP_URL ANTHROPIC_API_KEY AZURE_SPEECH_KEY; do
  grep -qx "$v" <<<"$now" || { echo "::error::missing in Vercel: $v"; exit 1; }
done
echo "all required variables present"
ROOT="$ROOT" bash scripts/ops/no-rollback.sh
SHA=$(git -C "$ROOT" rev-parse HEAD)
npx --yes vercel deploy --prod --yes --meta "greekosCommit=$SHA" --env "GREEKOS_COMMIT=$SHA" "${T[@]}" 2>&1 | grep -E "Production|Error|error|Ready|Aliased" | head -10
for i in $(seq 1 20); do c=$(curl -s -o /dev/null -w '%{http_code}' "$APP_URL/api/health"); [ "$c" = 200 ] && break; sleep 5; done
for p in /api/health /login /register; do curl -s -o /dev/null -w "$p %{http_code}\n" "$APP_URL$p"; done
