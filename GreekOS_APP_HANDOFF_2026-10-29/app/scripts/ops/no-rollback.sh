#!/usr/bin/env bash
# GreekOS — refuses a production deployment that would roll production back: the commit being deployed
# must contain the commit that is live (read from /api/health, else from the Vercel deployment metadata).
# ALLOW_ROLLBACK=1 lets a deliberate rollback through. Used by deploy-cloud.sh and vercel-env-redeploy.sh.
set -euo pipefail
ROOT=${ROOT:-$(git rev-parse --show-toplevel)}
: "${APP_URL:?}"
APP_URL=$(printf '%s' "$APP_URL" | tr -d '[:space:]')
HEAD_SHA=$(git -C "$ROOT" rev-parse HEAD)
live_commit() {
  local c="" pid=""
  c=$(curl -fsS --max-time 15 "$APP_URL/api/health" 2>/dev/null | jq -r '.commit // empty' 2>/dev/null || true)
  if [ -z "$c" ] && [ -n "${VERCEL_TOKEN:-}" ]; then
    local q="slug=${VERCEL_TEAM_SLUG:-masha-7f7d}" h="Authorization: Bearer $VERCEL_TOKEN"
    pid=$(curl -fsS --max-time 15 -H "$h" "https://api.vercel.com/v9/projects/${VERCEL_PROJECT:-greekos-course}?$q" 2>/dev/null | jq -r '.id // empty' 2>/dev/null || true)
    [ -n "$pid" ] && c=$(curl -fsS --max-time 15 -H "$h" "https://api.vercel.com/v6/deployments?projectId=$pid&target=production&state=READY&limit=1&$q" 2>/dev/null \
      | jq -r '.deployments[0].meta.greekosCommit // .deployments[0].meta.githubCommitSha // empty' 2>/dev/null || true)
  fi
  echo "$c"
}
LIVE_SHA=$(live_commit | head -1)
if [ -n "$LIVE_SHA" ] && [ "${ALLOW_ROLLBACK:-0}" != 1 ]; then
  git -C "$ROOT" cat-file -e "$LIVE_SHA^{commit}" 2>/dev/null || git -C "$ROOT" fetch --quiet origin "$LIVE_SHA" 2>/dev/null || true
  if ! git -C "$ROOT" merge-base --is-ancestor "$LIVE_SHA" "$HEAD_SHA" 2>/dev/null; then
    echo "::error::Развёртывание остановлено: коммит ${HEAD_SHA:0:9} не содержит работающий в production ${LIVE_SHA:0:9} — это был бы откат. Разверните ветку, которая включает текущий production (обычно main), или задайте ALLOW_ROLLBACK=1 для осознанного отката." >&2
    exit 1
  fi
  echo "production ${LIVE_SHA:0:9} входит в развёртываемый ${HEAD_SHA:0:9} — отката нет"
fi
