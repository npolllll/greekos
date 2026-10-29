-- GreekOS: RLS, grants and protected helpers.
-- Policy: deny anon everywhere; learners may only SELECT their own rows while their profile is
-- active; no table is writable by anon/authenticated — every write goes through narrow server
-- handlers that derive user_id from the verified session and use the service role.

create or replace function app_private.is_active_user(uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.user_id = uid and p.active);
$$;

create or replace function app_private.is_owner_admin(uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.role_assignments r
    join public.profiles p on p.user_id = r.user_id
    where r.user_id = uid and r.role = 'owner_admin' and p.active
  );
$$;

grant usage on schema app_private to authenticated, service_role;
grant execute on function app_private.is_active_user(uuid) to authenticated, service_role;
grant execute on function app_private.is_owner_admin(uuid) to authenticated, service_role;

-- Enable RLS on every table in public and remove any implicit grants.
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
    execute format('revoke all on table public.%I from anon, authenticated, public', t.tablename);
    execute format('grant all on table public.%I to service_role', t.tablename);
  end loop;
end $$;

grant usage on all sequences in schema public to service_role;

-- Learner-readable tables: own rows only, active profile required.
do $$
declare t text;
begin
  foreach t in array array[
    'enrollments', 'preferences', 'learning_routes', 'lesson_sessions', 'attempts', 'assessments',
    'mastery_events', 'competency_state', 'spaced_reviews', 'error_evidence', 'appeals',
    'feedback_events', 'context_transfer_attempts', 'placement_sessions', 'placement_axis_results',
    'activity_days', 'consents', 'speaking_sessions', 'speaking_turns', 'voice_artifacts',
    'exam_attempts'
  ] loop
    execute format('grant select on table public.%I to authenticated', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (user_id = (select auth.uid()) and app_private.is_active_user((select auth.uid())))',
      t || '_select_own', t
    );
  end loop;
end $$;

grant select on table public.profiles to authenticated;
create policy profiles_select_own_or_owner on public.profiles for select to authenticated
  using (
    (user_id = (select auth.uid()) and active)
    or app_private.is_owner_admin((select auth.uid()))
  );

grant select on table public.role_assignments to authenticated;
create policy role_assignments_select_own on public.role_assignments for select to authenticated
  using (user_id = (select auth.uid()) and app_private.is_active_user((select auth.uid())));

-- Realtime feed: own events; owner_admin may observe event metadata (no private answers in payload).
grant select on table public.learner_events to authenticated;
create policy learner_events_select on public.learner_events for select to authenticated
  using (
    (user_id = (select auth.uid()) and app_private.is_active_user((select auth.uid())))
    or app_private.is_owner_admin((select auth.uid()))
  );

-- Session revocation for deactivation (service role only).
create or replace function public.admin_revoke_user_sessions(target uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  delete from auth.refresh_tokens where user_id = target::text;
  delete from auth.sessions where user_id = target;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.admin_revoke_user_sessions(uuid) from public, anon, authenticated;
grant execute on function public.admin_revoke_user_sessions(uuid) to service_role;

-- Realtime publication for confirmed learning events.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.learner_events;
  end if;
end $$;

-- Private storage buckets; no storage.objects policies for anon/authenticated, so only the
-- server (service role) can read/write and learners receive short-lived signed URLs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('course-audio', 'course-audio', false, 52428800, array['audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/ogg', 'audio/webm']),
  ('tts-cache', 'tts-cache', false, 10485760, array['audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/ogg']),
  ('voice-review', 'voice-review', false, 10485760, array['audio/webm', 'audio/ogg', 'audio/wav', 'audio/mp4', 'audio/mpeg'])
on conflict (id) do nothing;
