#!/usr/bin/env bash
# GreekOS — proves that a backup can be restored: starts a fresh local Supabase (Docker), applies the
# project's migrations, restores the dump's data and compares the exact row count of every table with the
# counts recorded at backup time. Never touches the production database.
#
#   bash scripts/ops/restore-test.sh <dump> <counts.tsv> [<migrations.txt>]
#   bash scripts/ops/restore-test.sh            # makes a fresh backup first (needs DATABASE_URL)
set -euo pipefail
cd "$(dirname "$0")/../.."
DUMP=${1:-}
COUNTS=${2:-}
MIGS=${3:-}
if [ -z "$DUMP" ]; then
  : "${DATABASE_URL:?DATABASE_URL is required to make the backup that is tested}"
  bash scripts/backup-db.sh .restore-test >/dev/null
  DUMP=$(ls -t .restore-test/*.dump | head -1); COUNTS=${DUMP%.dump}.counts.tsv; MIGS=${DUMP%.dump}.migrations.txt
fi
[ -f "$DUMP" ] && [ -f "$COUNTS" ] || { echo "dump or counts missing" >&2; exit 2; }

echo "== fresh local Supabase with the backup's schema version"
# Migrations newer than the backup are set aside for the test (a real recovery applies them afterwards).
HELD=$(mktemp -d)
restore_migrations() { mv "$HELD"/*.sql supabase/migrations/ 2>/dev/null || true; }
trap restore_migrations EXIT
if [ -n "$MIGS" ] && [ -f "$MIGS" ]; then
  for f in supabase/migrations/*.sql; do
    v=$(basename "$f" | cut -d_ -f1)
    grep -qx "$v" "$MIGS" || { echo "newer than the backup, not applied in the test: $(basename "$f")"; mv "$f" "$HELD/"; }
  done
fi
npx --yes supabase stop --no-backup >/dev/null 2>&1 || true
npx --yes supabase start -x studio,imgproxy,mailpit,edge-runtime,logflare,vector,realtime,postgres-meta,supavisor >/dev/null
LOCAL="postgresql://postgres:postgres@127.0.0.1:$(grep -A3 '^\[db\]' supabase/config.toml | sed -nE 's/^port = ([0-9]+)/\1/p')/postgres"
SUPER=${LOCAL/postgres:postgres@/supabase_admin:postgres@}
psql "$SUPER" -X -qAt -c 'select 1' >/dev/null 2>&1 || SUPER=$LOCAL

echo "== restore the data"
# Rows seeded by migrations (settings, catalogs) would collide with the restored ones: start empty.
psql "$SUPER" -X -q -v ON_ERROR_STOP=1 <<'SQL'
do $$ declare t record; begin
  for t in select schemaname, tablename from pg_tables where schemaname in ('public', 'auth') and tablename not like 'schema_migrations%' loop
    execute format('truncate table %I.%I cascade', t.schemaname, t.tablename);
  end loop;
end $$;
SQL
set +e
pg_restore --data-only --disable-triggers --no-owner --no-privileges --schema=public --schema=auth -d "$SUPER" "$DUMP" 2> .restore-errors.log
rc=$?
set -e
echo "pg_restore exit $rc, $(grep -c 'error:' .restore-errors.log || true) errors"
grep 'error:' .restore-errors.log | sed -E 's/(VALUES|DETAIL).*//' | sort | uniq -c | head -20 || true

echo "== compare row counts with the backup"
mismatch=0; tables=0; rows=0
while IFS=$'\t' read -r table expected; do
  [ -n "$table" ] || continue
  got=$(psql "$SUPER" -X -qAt -c "select count(*) from ${table}" 2>/dev/null || echo "missing")
  tables=$((tables + 1)); rows=$((rows + ${expected:-0}))
  if [ "$got" != "$expected" ]; then mismatch=$((mismatch + 1)); echo "MISMATCH $table: backup $expected, restored $got"; fi
done < "$COUNTS"
npx --yes supabase stop --no-backup >/dev/null 2>&1 || true
rm -rf .restore-test
if [ "$mismatch" = 0 ]; then echo "RESTORE OK: $tables tables, $rows rows restored and equal to the backup"
else echo "::error::RESTORE FAILED: $mismatch of $tables tables differ"; exit 1; fi
