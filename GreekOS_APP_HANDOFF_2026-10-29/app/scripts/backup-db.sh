#!/usr/bin/env bash
# GreekOS — logical backup of the database (learners, progress, releases, QA, content) and of the
# list of stored audio files with their SHA-256. Works for the local stack and for Supabase Cloud.
#
#   DATABASE_URL=postgresql://… bash scripts/backup-db.sh [backups]
#
# Writes <dir>/greekos-<date>.dump (pg_dump custom format: public + auth + storage metadata) and
# <dir>/greekos-<date>.audio.tsv (path, size, sha256 of every audio asset row). Restore into a fresh
# project after `supabase db push`: pg_restore --data-only --disable-triggers -d "$DATABASE_URL" <dump>
# (see docs/OPERATIONS.md). The audio files themselves are reproducible from the pipeline or
# re-uploaded from the owner's copy; the manifest proves which files belonged to the backup.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env.local ] && [ -z "${DATABASE_URL:-}" ] && { set -a; . ./.env.local; set +a; }
: "${DATABASE_URL:?DATABASE_URL is required}"
V=$(pg_dump --version | sed -E 's/[^0-9]*([0-9]+).*/\1/')
[ "$V" -ge 17 ] || { echo "pg_dump $V is older than the server (Postgres 17): install postgresql-client-17" >&2; exit 1; }
OUT=${1:-backups}
STAMP=$(date -u +%Y-%m-%dT%H%MZ)
mkdir -p "$OUT"
pg_dump "$DATABASE_URL" --format=custom --no-owner --no-privileges \
  --schema=public --schema=auth --schema=storage \
  --exclude-table-data='storage.objects' --file="$OUT/greekos-$STAMP.dump"
psql "$DATABASE_URL" -AtF $'\t' -c "select object_path, byte_length, sha256 from public.audio_assets where invalidated_at is null order by object_path" > "$OUT/greekos-$STAMP.audio.tsv"
# Schema version of the backup (a restore applies exactly these migrations before the data).
psql "$DATABASE_URL" -At -c "select version from supabase_migrations.schema_migrations order by 1" > "$OUT/greekos-$STAMP.migrations.txt"
# Exact row counts of every table in the dump: the restore test compares them after restoring.
psql "$DATABASE_URL" -AtF $'\t' -v ON_ERROR_STOP=1 > "$OUT/greekos-$STAMP.counts.tsv" <<'SQL'
select format('select %L, count(*) from %I.%I', n.nspname || '.' || c.relname, n.nspname, c.relname)
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where c.relkind = 'r' and n.nspname in ('public', 'auth') and c.relname not like 'schema_migrations%'
order by 1 \gexec
SQL
pg_restore --list "$OUT/greekos-$STAMP.dump" | grep -c 'TABLE DATA' | xargs -I{} echo "OK: $OUT/greekos-$STAMP.dump ({} tables with data), $(wc -l < "$OUT/greekos-$STAMP.audio.tsv") audio files listed"
