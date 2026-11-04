#!/usr/bin/env bash
# GreekOS — one guided cloud deployment: Supabase Cloud (database, sign-in, storage) + Vercel (app).
#
# Before running: create a Supabase project (EU region) and a Vercel account, and have at hand the
# Anthropic API key (AI conversation and assessment) and an Azure Speech key + region (speech
# recognition and the course voices). See docs/DEPLOYMENT.md. Run from the app folder:
#
#   bash scripts/deploy-cloud.sh             # asks for what it needs, remembers it in .deploy/cloud.env
#   DRY_RUN=1 bash scripts/deploy-cloud.sh   # prints every step (secrets masked), changes nothing
#
# Without questions (e.g. from a cloud session whose environment holds the values as variables):
#   NONINTERACTIVE=1 with SUPABASE_ACCESS_TOKEN (supabase.com → Account → Access Tokens) and
#   VERCEL_TOKEN (vercel.com → Account Settings → Tokens) plus the values asked below set in the env.
#
# Re-running is safe: finished steps are detected and skipped. The answers (including secrets) stay
# on this computer in .deploy/cloud.env (git-ignored, mode 600). Nothing is released to learners:
# releases, voice approval and provider terms are the owner's decisions in the admin panel.
set -euo pipefail
cd "$(dirname "$0")/.."

CONF=${DEPLOY_CONF:-.deploy/cloud.env}
DRY=${DRY_RUN:-0}
DATA_SQL=${CONTENT_DATA_SQL:-../database/02_content_data.sql}
SECRETS=(DATABASE_URL SUPABASE_DB_PASSWORD SUPABASE_SERVICE_ROLE_KEY NEXT_PUBLIC_SUPABASE_ANON_KEY ANTHROPIC_API_KEY AZURE_SPEECH_KEY CRON_SECRET REGISTRATION_SALT VOICE_GATEWAY_SECRET SUPABASE_ACCESS_TOKEN VERCEL_TOKEN)

mkdir -p "$(dirname "$CONF")" && chmod 700 "$(dirname "$CONF")"
[ -f "$CONF" ] || : > "$CONF"
chmod 600 "$CONF"
set -a; . "$CONF"; set +a

step() { printf '\n== %s\n' "$1"; }
mask() {
  local s="$*" k
  for k in "${SECRETS[@]}"; do [ -n "${!k:-}" ] && s=${s//"${!k}"/"<$k>"}; done
  printf '%s' "$s"
}
run() { echo "+ $(mask "$*")"; [ "$DRY" = 1 ] || "$@"; }
remember() { printf -v "$1" '%s' "$2"; export "${1?}"; printf '%s=%q\n' "$1" "$2" >> "$CONF"; }
ask() { # name, question, secret (0/1), default
  local name=$1 q=$2 secret=${3:-0} def=${4:-} v=''
  [ -n "${!name:-}" ] && return 0
  if [ "${NONINTERACTIVE:-0}" = 1 ]; then
    [ -n "$def" ] || { echo "Нет значения $name (NONINTERACTIVE=1)" >&2; exit 2; }
    v=$def
  elif [ "$secret" = 1 ]; then read -r -s -p "$q: " v; echo
  else read -r -p "$q${def:+ [$def]}: " v; v=${v:-$def}
  fi
  [ -n "$v" ] || { echo "$name обязателен" >&2; exit 2; }
  remember "$name" "$v"
}
random_secret() { node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"; }
# Cloud steps run with exactly these values: nothing local (.env.local) may take their place.
cloud_env() {
  env APP_ENV=production APP_URL="$APP_URL" NEXT_PUBLIC_SUPABASE_URL="$NEXT_PUBLIC_SUPABASE_URL" \
    NEXT_PUBLIC_SUPABASE_ANON_KEY="$NEXT_PUBLIC_SUPABASE_ANON_KEY" SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY" \
    DATABASE_URL="$DATABASE_URL" LLM_PROVIDER=anthropic ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
    ASR_PROVIDER=azure TTS_PROVIDER=azure AZURE_SPEECH_KEY="$AZURE_SPEECH_KEY" AZURE_SPEECH_REGION="$AZURE_SPEECH_REGION" \
    LOCAL_ASR_URL= LLM_BASE_URL= ALLOW_SYNTHETIC_PROVIDERS= ALLOW_LOCAL_VOICE_PLAYBACK_FOR_DEV= "$@"
}
sql() { [ "$DRY" = 1 ] && { echo 0; return; }; psql "$DATABASE_URL" -Atc "$1"; }

step "0/8 инструменты"
command -v node >/dev/null || { echo "Нужен Node.js 20+ (https://nodejs.org)" >&2; exit 1; }
command -v psql >/dev/null || { echo "Нужен psql (PostgreSQL client 16.10+ или 17.6+): brew install postgresql@17 / apt install postgresql-client-17" >&2; exit 1; }
PSQL_MAJOR=$(psql --version | sed -E 's/[^0-9]*([0-9]+).*/\1/')
# The data file uses pg_dump's \restrict (psql 17.6+, 16.10+, 15.14+): an older psql says «invalid command».
[ "$PSQL_MAJOR" -ge 15 ] || { echo "psql $PSQL_MAJOR слишком старый: нужен 15.14+/16.10+/17.6+" >&2; exit 1; }
[ -f "$DATA_SQL" ] || { echo "Нет данных корпуса: $DATA_SQL" >&2; exit 1; }
[ -d node_modules ] || run npm ci

step "1/8 данные проекта (сохраняются в $CONF)"
ask SUPABASE_PROJECT_REF "Supabase: Project ref (Settings → General)"
ask SUPABASE_DB_PASSWORD "Supabase: пароль базы данных" 1
ask NEXT_PUBLIC_SUPABASE_URL "Supabase: Project URL" 0 "https://$SUPABASE_PROJECT_REF.supabase.co"
ask NEXT_PUBLIC_SUPABASE_ANON_KEY "Supabase: anon / publishable key (Settings → API)" 1
ask SUPABASE_SERVICE_ROLE_KEY "Supabase: service_role / secret key (Settings → API)" 1
ask DATABASE_URL "Supabase: строка подключения Session pooler (Connect → Session pooler, с паролем)" 1
ask APP_URL "Адрес приложения (например https://greekos.vercel.app или ваш домен)"
APP_URL=${APP_URL%/}
ask OWNER_EMAIL "E-mail владельца"
ask OWNER_NAME "Имя владельца" 0 "Владелец"
ask ANTHROPIC_API_KEY "Anthropic API key (console.anthropic.com → API Keys)" 1
ask AZURE_SPEECH_KEY "Azure Speech key (portal.azure.com → Speech → Keys)" 1
ask AZURE_SPEECH_REGION "Azure Speech region" 0 "westeurope"
[ -n "${CRON_SECRET:-}" ] || remember CRON_SECRET "$(random_secret)"
[ -n "${REGISTRATION_SALT:-}" ] || remember REGISTRATION_SALT "$(random_secret)"
[ -n "${VOICE_GATEWAY_SECRET:-}" ] || remember VOICE_GATEWAY_SECRET "$(random_secret)"

step "2/8 схема базы (миграции)"
run npx supabase link --project-ref "$SUPABASE_PROJECT_REF" --password "$SUPABASE_DB_PASSWORD"
run npx supabase db push --password "$SUPABASE_DB_PASSWORD"

step "3/8 учебный корпус (только в пустую базу)"
ITEMS=$(sql "select count(*) from public.items")
if [ "$ITEMS" = "0" ]; then run psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$DATA_SQL"; else echo "уже загружено: $ITEMS заданий"; fi

step "4/8 владелец (письмо со ссылкой для пароля)"
run cloud_env npx tsx scripts/create-owner.ts --email "$OWNER_EMAIL" --name "$OWNER_NAME"

step "5/8 цифровой QA корпуса и записанные исправления (как локально)"
QA=$(sql "select count(*) from public.qa_batches where status = 'COMPLETED'")
if [ "$QA" = "0" ]; then
  run cloud_env npx tsx scripts/qa-batch.ts
  run cloud_env npx tsx --conditions=react-server scripts/qa-autofix.ts
  run cloud_env npx tsx --conditions=react-server scripts/qa-engineering-fixes.ts
else echo "пакет QA уже есть ($QA)"; fi

step "6/8 голоса Azure: каталог и предложения кастинга (утверждает владелец)"
run cloud_env npm run audio -- cast

step "7/8 Vercel: проект и переменные"
VT=(); [ -n "${VERCEL_TOKEN:-}" ] && VT=(--token "$VERCEL_TOKEN")
if [ "$DRY" != 1 ] && ! npx --yes vercel whoami "${VT[@]}" >/dev/null 2>&1; then
  [ "${NONINTERACTIVE:-0}" = 1 ] && { echo "Vercel: нужен VERCEL_TOKEN" >&2; exit 2; }
  npx --yes vercel login
fi
run npx --yes vercel link --yes "${VT[@]}"
VARS=(NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY APP_URL CRON_SECRET REGISTRATION_SALT ANTHROPIC_API_KEY AZURE_SPEECH_KEY AZURE_SPEECH_REGION VOICE_GATEWAY_SECRET)
declare -A FIXED=([APP_ENV]=production [LLM_PROVIDER]=anthropic [ASR_PROVIDER]=azure [TTS_PROVIDER]=azure [BUDGET_MONTHLY_USD]=${BUDGET_MONTHLY_USD:-40})
set_var() {
  echo "+ vercel env add $1 production ← $(mask "$2")"
  [ "$DRY" = 1 ] && return 0
  npx --yes vercel env rm "$1" production --yes "${VT[@]}" >/dev/null 2>&1 || true
  printf '%s' "$2" | npx --yes vercel env add "$1" production "${VT[@]}" >/dev/null
}
for k in "${VARS[@]}"; do set_var "$k" "${!k}"; done
for k in "${!FIXED[@]}"; do set_var "$k" "${FIXED[$k]}"; done

step "8/8 развёртывание"
run npx --yes vercel deploy --prod --yes "${VT[@]}"
if [ "$DRY" != 1 ]; then
  for i in $(seq 1 30); do curl -sf "$APP_URL/api/health" >/dev/null && break; sleep 5; done
  curl -sf "$APP_URL/api/health" && echo " ← $APP_URL работает" || echo "Проверьте адрес $APP_URL (домен в Vercel → Settings → Domains)."
fi

cat <<EOF

Готово. Осталось в панели Supabase (Authentication), один раз:
  • URL Configuration: Site URL = $APP_URL; Redirect URLs = $APP_URL/**
  • Sign In / Providers → Email: «Allow new users to sign up» — выключено (регистрация идёт через GreekOS)
  • Emails → Templates: вставить supabase/templates/invite.html, recovery.html, magic_link.html
  • Emails → SMTP: подключить почтовый сервис (без него письма регистрации ограничены несколькими в час)
Затем в GreekOS ($APP_URL, вход владельца по письму):
  • Админ → Политика выпуска → подписать; Админ → Цифровой QA и выпуск → выборка → решение о выпуске
  • Админ → Голоса и кастинг → прослушать и утвердить; Админ → Аудио → «Сгенерировать пакет», записать условия Azure
  • Админ → Ученики → «Регистрация учеников»: режим и число мест; ссылка для учеников: $APP_URL/register
Живой потоковый разговор (необязательно): шлюз voice-gateway на отдельном сервере — docs/DEPLOYMENT.md §4b;
без него разговор с AI работает в пошаговом режиме.
EOF
