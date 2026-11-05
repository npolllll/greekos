-- Fix: bundles omit optional single-row keys (attempt, assessment, feedback_event, transfer_attempt).
-- jsonb_build_array(NULL) yields [null]; JSON null elements must be skipped, not treated as foreign rows.
-- Needed by exam commits (events-only and per-item bundles) and every other optional-key bundle.
create or replace function app_private.assert_owner_rows(uid uuid, rows jsonb, label text)
returns void language plpgsql as $$
declare r jsonb;
begin
  if rows is null or jsonb_typeof(rows) <> 'array' then
    return;
  end if;
  for r in select value from jsonb_array_elements(rows) loop
    if r is null or jsonb_typeof(r) = 'null' then
      continue;
    end if;
    if jsonb_typeof(r) <> 'object' or (r->>'user_id')::uuid is distinct from uid then
      raise exception 'ownership mismatch in %', label using errcode = '42501';
    end if;
  end loop;
end;
$$;

revoke all on function app_private.assert_owner_rows(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function app_private.assert_owner_rows(uuid, jsonb, text) to service_role;
