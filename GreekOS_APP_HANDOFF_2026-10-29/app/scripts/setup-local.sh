#!/usr/bin/env bash
# GreekOS — local demo-preview from this handoff on a fresh Mac/Linux machine, without keys or payments.
#
#   bash scripts/setup-local.sh owner@example.com "Имя владельца" tester@example.com
#
# Needs: Node >= 22.12, Docker, Python 3.11, curl, tar, unzip (and espeak-ng + MBROLA for male voices).
# Steps are idempotent: re-running skips what is already in place. Passwords are generated locally
# and written to .local-credentials/ (gitignored); nothing is sent anywhere.
set -euo pipefail
cd "$(dirname "$0")/.."
OWNER_EMAIL=${1:?owner e-mail}
OWNER_NAME=${2:-Владелец}
TESTER_EMAIL=${3:-tester@greekos.local}
BUNDLE=${AUDIO_BUNDLE:-../audio_bundle}
PY=${GREEKOS_PY:-$HOME/greekos-models/venv-coqui/bin/python}
mkdir -p .local-credentials
step() { printf '\n== %s\n' "$1"; }

step "1/9 npm dependencies"
npm ci
npm --prefix local-services/llm ci

step "2/9 Supabase (Docker) + migrations"
npx supabase start
if [ ! -f .env.local ]; then
  cp .env.example .env.local
  echo "→ .env.local создан из .env.example: впишите ключи, которые напечатал 'supabase status', и переменные из docs/LOCAL_AI_SETUP.md; затем запустите скрипт снова."
  exit 1
fi
set -a; . ./.env.local; set +a

step "3/9 corpus data (empty database only)"
ITEMS=$(psql "$DATABASE_URL" -Atc "select count(*) from items" 2>/dev/null || echo 0)
if [ "$ITEMS" = "0" ]; then psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f ../database/02_content_data.sql; fi
psql "$DATABASE_URL" -Atc "select 'items: ' || count(*) from items"

step "4/9 owner account"
if [ ! -f .local-credentials/owner.txt ]; then
  PW=$(node -e "console.log(require('crypto').randomBytes(15).toString('base64url'))")
  printf '%s' "$PW" > .local-credentials/owner.password
  npx tsx scripts/create-owner.ts --email "$OWNER_EMAIL" --name "$OWNER_NAME" --password-file .local-credentials/owner.password
  printf '%s %s\n' "$OWNER_EMAIL" "$PW" > .local-credentials/owner.txt
fi

step "5/9 local models (SHA-256 verified) and Python speech service"
[ -x "$PY" ] || { python3.11 -m venv "$(dirname "$(dirname "$PY")")"; "$PY" -m pip install -r local-services/requirements.txt; }
node local-services/fetch-models.mjs

step "6/9 start speech service and local LLM (background, logs in .local-credentials/)"
curl -sf http://127.0.0.1:3312/health >/dev/null || (GREEKOS_MODELS=${GREEKOS_MODELS:-$HOME/greekos-models} nohup "$PY" local-services/speech_server.py > .local-credentials/speech.log 2>&1 &)
curl -sf http://127.0.0.1:3313/health >/dev/null || (nohup node local-services/llm/server.mjs > .local-credentials/llm.log 2>&1 &)
for i in $(seq 1 120); do curl -sf http://127.0.0.1:3312/health >/dev/null && break; sleep 2; done

step "7/9 voices, casting proposals, course audio from the bundle"
npm run audio -- cast
if [ -f "$BUNDLE/AUDIO_BUNDLE_MANIFEST.json" ]; then npm run audio -- import-bundle --dir "$BUNDLE"; else echo "нет $BUNDLE — аудио можно сгенерировать: npm run audio -- render-batch"; fi

step "8/9 digital QA of the corpus"
npx tsx scripts/qa-batch.ts

step "9/9 DEV-PREVIEW tester (local only)"
if [ ! -f .local-credentials/tester.json ]; then
  npx tsx --conditions=react-server scripts/dev-preview.ts create-tester --owner "$OWNER_EMAIL" --email "$TESTER_EMAIL" --name "Тестовый ученик" --days 14 > .local-credentials/tester.json
fi

cat <<EOF

Готово. Запуск:
  npm run voice:gateway      # живой разговор (отдельный терминал)
  npm run dev                # http://127.0.0.1:3210
Вход владельца: .local-credentials/owner.txt; тестовый ученик: .local-credentials/tester.json (password_once).
Подпись цифровой политики, права голосов и прослушивание аудио — решения владельца в админке.
EOF
