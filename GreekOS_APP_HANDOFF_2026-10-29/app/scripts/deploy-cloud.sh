#!/usr/bin/env bash
# GreekOS — one guided cloud deployment of the whole product:
#   Supabase Cloud (database, sign-in, e-mail via SMTP, storage) · Vercel (the web app) ·
#   Fly.io (the voice gateway: the long-lived WebSocket of the live conversation, which a Vercel
#   function cannot hold) · Anthropic (dialogue and assessment) · Azure Speech (recognition, voices).
#
# Run from the app folder:
#   bash scripts/deploy-cloud.sh             # asks for what it needs, remembers it in .deploy/cloud.env
#   DRY_RUN=1 bash scripts/deploy-cloud.sh   # prints every step (secrets masked), changes nothing
#
# Without questions (e.g. from a cloud session whose environment holds the values as variables):
#   NONINTERACTIVE=1 with SUPABASE_ACCESS_TOKEN (supabase.com → Account → Access Tokens),
#   VERCEL_TOKEN (vercel.com → Account Settings → Tokens), FLY_API_TOKEN (fly.io → Tokens) and the
#   values asked below set in the environment.
#
# Re-running is safe: finished steps are detected and skipped. The answers (including secrets) stay
# on this computer in .deploy/cloud.env (git-ignored, mode 600). Nothing is released to learners:
# the release decision, voice approval and provider terms are the owner's decisions in the admin panel.
set -euo pipefail
cd "$(dirname "$0")/.."

CONF=${DEPLOY_CONF:-.deploy/cloud.env}
DRY=${DRY_RUN:-0}
DATA_SQL=${CONTENT_DATA_SQL:-../database/02_content_data.sql}
SECRETS=(DATABASE_URL SUPABASE_DB_PASSWORD SUPABASE_SERVICE_ROLE_KEY NEXT_PUBLIC_SUPABASE_ANON_KEY ANTHROPIC_API_KEY AZURE_SPEECH_KEY CRON_SECRET REGISTRATION_SALT VOICE_GATEWAY_SECRET SUPABASE_ACCESS_TOKEN VERCEL_TOKEN FLY_API_TOKEN SMTP_PASS)

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
    VOICE_GATEWAY_SECRET="$VOICE_GATEWAY_SECRET" BUDGET_MONTHLY_USD="$BUDGET_MONTHLY_USD" BUDGET_DAILY_USD_PER_USER="$BUDGET_DAILY_USD_PER_USER" \
    AUDIO_RUN_BUDGET_USD="$AUDIO_RUN_BUDGET_USD" LOCAL_ASR_URL= LLM_BASE_URL= ALLOW_SYNTHETIC_PROVIDERS= ALLOW_LOCAL_VOICE_PLAYBACK_FOR_DEV= "$@"
}
sql() { [ "$DRY" = 1 ] && { echo 0; return; }; psql "$DATABASE_URL" -Atc "$1"; }

step "0/10 инструменты"
command -v node >/dev/null || { echo "Нужен Node.js 20+ (https://nodejs.org)" >&2; exit 1; }
command -v psql >/dev/null || { echo "Нужен psql (PostgreSQL client 16.10+ или 17.6+): brew install postgresql@17 / apt install postgresql-client-17" >&2; exit 1; }
PSQL_MAJOR=$(psql --version | sed -E 's/[^0-9]*([0-9]+).*/\1/')
# The data file uses pg_dump's \restrict (psql 17.6+, 16.10+, 15.14+): an older psql says «invalid command».
[ "$PSQL_MAJOR" -ge 15 ] || { echo "psql $PSQL_MAJOR слишком старый: нужен 15.14+/16.10+/17.6+" >&2; exit 1; }
[ -f "$DATA_SQL" ] || { echo "Нет данных корпуса: $DATA_SQL" >&2; exit 1; }
[ -d node_modules ] || run npm ci
FLY=$(command -v flyctl || command -v fly || echo "$HOME/.fly/bin/flyctl")

step "1/10 данные проекта (сохраняются в $CONF)"
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
# E-mail (confirmation, password reset, registration). Resend by default; any SMTP service works.
ask SMTP_HOST "SMTP: сервер" 0 "smtp.resend.com"
ask SMTP_PORT "SMTP: порт" 0 "465"
ask SMTP_USER "SMTP: пользователь" 0 "resend"
ask SMTP_PASS "SMTP: пароль (для Resend — API key)" 1
ask SMTP_SENDER "SMTP: адрес отправителя на проверенном домене (например no-reply@ваш-домен)"
ask FLY_APP "Fly.io: имя приложения голосового шлюза" 0 "greekos-voice-${SUPABASE_PROJECT_REF:0:8}"
ask BUDGET_MONTHLY_USD "Лимит расходов на AI и голос в месяц, USD" 0 "40"
ask BUDGET_DAILY_USD_PER_USER "Лимит в день на ученика, USD" 0 "1.5"
ask AUDIO_RUN_BUDGET_USD "Лимит одной генерации аудио курса, USD" 0 "5"
[ -n "${CRON_SECRET:-}" ] || remember CRON_SECRET "$(random_secret)"
[ -n "${REGISTRATION_SALT:-}" ] || remember REGISTRATION_SALT "$(random_secret)"
[ -n "${VOICE_GATEWAY_SECRET:-}" ] || remember VOICE_GATEWAY_SECRET "$(random_secret)"
GATEWAY_URL="wss://$FLY_APP.fly.dev"

step "2/10 схема базы (миграции)"
run npx supabase link --project-ref "$SUPABASE_PROJECT_REF" --password "$SUPABASE_DB_PASSWORD"
run npx supabase db push --password "$SUPABASE_DB_PASSWORD"

step "3/10 вход и письма: адрес сайта, шаблоны, SMTP, регистрация только через GreekOS"
# A minimal config with only the auth settings: `config push` leaves everything it does not declare.
CLOUD=.deploy/supabase-cloud
mkdir -p "$CLOUD/supabase/templates" && cp supabase/templates/*.html "$CLOUD/supabase/templates/"
cat > "$CLOUD/supabase/config.toml" <<TOML
project_id = "greekos"

[auth]
site_url = "$APP_URL"
additional_redirect_urls = ["$APP_URL/**"]
enable_signup = false
minimum_password_length = 10

[auth.rate_limit]
email_sent = 60

[auth.email]
enable_signup = true
double_confirm_changes = true
enable_confirmations = false

[auth.email.smtp]
enabled = true
host = "$SMTP_HOST"
port = $SMTP_PORT
user = "$SMTP_USER"
pass = "env(SMTP_PASS)"
admin_email = "$SMTP_SENDER"
sender_name = "GreekOS"

[auth.email.template.invite]
subject = "GreekOS — ссылка для входа в курс"
content_path = "./supabase/templates/invite.html"

[auth.email.template.recovery]
subject = "Восстановление доступа к GreekOS"
content_path = "./supabase/templates/recovery.html"

[auth.email.template.magic_link]
subject = "Вход в GreekOS"
content_path = "./supabase/templates/magic_link.html"
TOML
run env SMTP_PASS="$SMTP_PASS" SUPABASE_YES=1 npx supabase config push --workdir "$CLOUD" --project-ref "$SUPABASE_PROJECT_REF"

step "4/10 учебный корпус (только в пустую базу)"
ITEMS=$(sql "select count(*) from public.items")
if [ "$ITEMS" = "0" ]; then run psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$DATA_SQL"; else echo "уже загружено: $ITEMS заданий"; fi

step "5/10 владелец (письмо со ссылкой для пароля)"
run cloud_env npx tsx scripts/create-owner.ts --email "$OWNER_EMAIL" --name "$OWNER_NAME"

step "6/10 цифровой QA корпуса и записанные исправления (как локально)"
QA=$(sql "select count(*) from public.qa_batches where status = 'COMPLETED'")
if [ "$QA" = "0" ]; then
  run cloud_env npx tsx scripts/qa-batch.ts
  run cloud_env npx tsx --conditions=react-server scripts/qa-autofix.ts
  run cloud_env npx tsx --conditions=react-server scripts/qa-engineering-fixes.ts
else echo "пакет QA уже есть ($QA)"; fi

step "7/10 голоса Azure: каталог, предложения кастинга, генерация 142 аудио (в пределах лимита)"
run cloud_env npm run audio -- cast
# Files are rendered with the proposed voices and checked by recognition; they reach learners only
# after the owner approves the cast, records the Azure terms and releases them.
run cloud_env npm run audio -- render-batch --budget-cap "$AUDIO_RUN_BUDGET_USD"

step "8/10 голосовой шлюз на Fly.io (WebSocket, регион Франкфурт)"
if [ "$DRY" != 1 ] && [ ! -x "$FLY" ]; then curl -fsSL https://fly.io/install.sh | sh; FLY="$HOME/.fly/bin/flyctl"; fi
FT=(); [ -n "${FLY_API_TOKEN:-}" ] && FT=(--access-token "$FLY_API_TOKEN")
if [ "$DRY" != 1 ] && ! "$FLY" auth whoami "${FT[@]}" >/dev/null 2>&1; then
  [ "${NONINTERACTIVE:-0}" = 1 ] && { echo "Fly.io: нужен FLY_API_TOKEN" >&2; exit 2; }
  "$FLY" auth login
fi
[ "$DRY" = 1 ] || "$FLY" apps create "$FLY_APP" --org "${FLY_ORG:-personal}" "${FT[@]}" >/dev/null 2>&1 || true
gw_secrets() {
  printf '%s\n' "NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL" "NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY" \
    "SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY" "APP_URL=$APP_URL" "VOICE_GATEWAY_SECRET=$VOICE_GATEWAY_SECRET" \
    "LLM_PROVIDER=anthropic" "ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY" "ASR_PROVIDER=azure" "TTS_PROVIDER=azure" \
    "AZURE_SPEECH_KEY=$AZURE_SPEECH_KEY" "AZURE_SPEECH_REGION=$AZURE_SPEECH_REGION" \
    "BUDGET_MONTHLY_USD=$BUDGET_MONTHLY_USD" "BUDGET_DAILY_USD_PER_USER=$BUDGET_DAILY_USD_PER_USER"
}
echo "+ flyctl secrets import --app $FLY_APP ← $(gw_secrets | cut -d= -f1 | tr '\n' ' ')"
[ "$DRY" = 1 ] || gw_secrets | "$FLY" secrets import --app "$FLY_APP" --stage "${FT[@]}" >/dev/null
# The app folder is the build context (the gateway imports src/); .dockerignore keeps secrets and data out.
GW_DEPLOY=("$FLY" deploy "$PWD" --app "$FLY_APP" --config "$PWD/voice-gateway/fly.toml" --dockerfile "$PWD/voice-gateway/Dockerfile" "${FT[@]}")
# Remote build on Fly's builders; if they are unreachable from this network, build with local Docker.
run "${GW_DEPLOY[@]}" --remote-only || { command -v docker >/dev/null && run "${GW_DEPLOY[@]}" --local-only; }

step "9/10 Vercel: проект, переменные, развёртывание"
VT=(); [ -n "${VERCEL_TOKEN:-}" ] && VT=(--token "$VERCEL_TOKEN")
if [ "$DRY" != 1 ] && ! npx --yes vercel whoami "${VT[@]}" >/dev/null 2>&1; then
  [ "${NONINTERACTIVE:-0}" = 1 ] && { echo "Vercel: нужен VERCEL_TOKEN" >&2; exit 2; }
  npx --yes vercel login
fi
run npx --yes vercel link --yes "${VT[@]}"
VARS=(NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY APP_URL CRON_SECRET REGISTRATION_SALT ANTHROPIC_API_KEY AZURE_SPEECH_KEY AZURE_SPEECH_REGION VOICE_GATEWAY_SECRET BUDGET_MONTHLY_USD BUDGET_DAILY_USD_PER_USER AUDIO_RUN_BUDGET_USD)
declare -A FIXED=([APP_ENV]=production [LLM_PROVIDER]=anthropic [ASR_PROVIDER]=azure [TTS_PROVIDER]=azure [NEXT_PUBLIC_VOICE_GATEWAY_URL]=$GATEWAY_URL)
set_var() {
  echo "+ vercel env add $1 production ← $(mask "$2")"
  [ "$DRY" = 1 ] && return 0
  npx --yes vercel env rm "$1" production --yes "${VT[@]}" >/dev/null 2>&1 || true
  printf '%s' "$2" | npx --yes vercel env add "$1" production "${VT[@]}" >/dev/null
}
for k in "${VARS[@]}"; do set_var "$k" "${!k}"; done
for k in "${!FIXED[@]}"; do set_var "$k" "${FIXED[$k]}"; done
run npx --yes vercel deploy --prod --yes "${VT[@]}"

step "10/10 проверка работающей системы"
if [ "$DRY" != 1 ]; then
  for i in $(seq 1 30); do curl -sf "$APP_URL/api/health" >/dev/null && break; sleep 5; done
  curl -sf "$APP_URL/api/health" && echo " ← приложение $APP_URL" || echo "Приложение не отвечает: проверьте домен (Vercel → Settings → Domains)."
  curl -sf "https://$FLY_APP.fly.dev/health" && echo " ← голосовой шлюз $GATEWAY_URL" || echo "Шлюз не отвечает: $FLY logs --app $FLY_APP"
fi
# A live conversation through the deployed gateway with the real providers (temporary test account).
# Until the owner approves the Azure voices the tutor answers in text only, so this check reports
# «every_turn_voiced: false» — repeat it after approval (same command).
run cloud_env npx tsx --conditions=react-server scripts/voice-smoke.ts --gateway "$GATEWAY_URL" --turns 4 --out reports/production/voice-smoke \
  || echo "Проверка живого разговора не пройдена полностью — отчёт в reports/production/voice-smoke; повторите после утверждения голосов."

cat <<EOF

Развёрнуто: $APP_URL (приложение) и $GATEWAY_URL (голосовой шлюз).
Осталось решить владельцу в GreekOS ($APP_URL, вход по письму-приглашению):
  • Админ → Политика выпуска → подписать; Админ → Выпуск → выборка (≤ 30) → «Принять решение о выпуске»
  • Админ → Голоса и кастинг → прослушать и утвердить голоса Azure; Админ → Аудио → прослушать, записать условия Azure
  • Админ → Ученики → «Регистрация учеников»: режим и число мест; ссылка для учеников: $APP_URL/register
Резервная копия: bash scripts/backup-db.sh (раз в неделю и перед миграциями) или ежедневные копии Supabase Pro.
EOF
