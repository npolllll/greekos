#!/usr/bin/env bash
# GreekOS — sign-in settings of the Supabase project (`supabase config push` with only the auth block).
#   [auth] enable_signup = false        → nobody can create an account at the auth service (closed platform;
#                                          the owner's admin API still creates learners and one-time links)
#   [auth.email] enable_signup = true   → the e-mail PROVIDER stays on: with false, Supabase turns off e-mail
#                                          sign-in itself («Email logins are disabled») and nobody can log in.
# Needs APP_URL, SUPABASE_PROJECT_REF, SUPABASE_ACCESS_TOKEN. Used by deploy-cloud.sh and GreekOS ops.
set -euo pipefail
cd "$(dirname "$0")/../.."
APP_URL=$(printf '%s' "${APP_URL:?}" | tr -d '[:space:]'); APP_URL=${APP_URL%/}
CLOUD=.deploy/supabase-cloud
mkdir -p "$CLOUD/supabase/templates" && cp supabase/templates/*.html "$CLOUD/supabase/templates/" 2>/dev/null || true
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
TOML
if [ "${DRY_RUN:-0}" = 1 ]; then echo "+ supabase config push (auth)"; exit 0; fi
SUPABASE_YES=1 npx --yes supabase config push --workdir "$CLOUD" --project-ref "${SUPABASE_PROJECT_REF:?}"
