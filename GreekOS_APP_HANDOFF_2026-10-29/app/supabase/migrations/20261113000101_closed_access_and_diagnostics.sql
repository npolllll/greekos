-- GreekOS completion, 13.11.2026.
-- 1. Closed platform: learners get access only from the owner (account + one-time link). Self-registration
--    («open» / «code») is removed; the setting keeps one allowed value so no code path can reopen it.
-- 2. Least privilege: tables created after the first RLS migration kept Supabase's default grants to
--    anon/authenticated (RLS denied the rows, but the grants were not needed). anon gets nothing in public;
--    authenticated keeps grants only where a policy for it exists.
-- 3. Diagnostics: a failed paid call keeps the provider's answer (status and message, never keys).
-- Reversible: drop the new column; widen the check again (see 20261104000701_self_registration.sql).

update public.platform_settings set registration_mode = 'closed', registration_code_hash = null, updated_at = now()
  where registration_mode <> 'closed' or registration_code_hash is not null;
alter table public.platform_settings drop constraint if exists platform_settings_registration_mode_check;
alter table public.platform_settings add constraint platform_settings_registration_mode_check check (registration_mode = 'closed');
alter table public.platform_settings alter column registration_mode set default 'closed';

do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('revoke all on table public.%I from anon, public', t.tablename);
    if not exists (
      select 1 from pg_policies p
      where p.schemaname = 'public' and p.tablename = t.tablename
        and ('authenticated' = any (p.roles) or 'public' = any (p.roles))
    ) then
      execute format('revoke all on table public.%I from authenticated', t.tablename);
    end if;
    execute format('grant all on table public.%I to service_role', t.tablename);
  end loop;
end $$;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;

alter table public.provider_usage add column if not exists error_detail text;
create index if not exists provider_usage_failures on public.provider_usage (created_at desc) where not ok;

-- Why an assistant line is the scene's authored fallback (provider error, timeout, budget, Greek check).
alter table public.speaking_turns add column if not exists engine_reason text;
