-- GreekOS ops — read-only production state: counts and settings only, no personal data.
\pset footer off
\echo == registration
select registration_mode, max_learners, registration_code_hash is not null as has_code from public.platform_settings;
\echo == accounts (no e-mails)
select coalesce(r.role, '—') as role, p.active, p.lifecycle_state, count(*) from public.profiles p
  left join public.role_assignments r on r.user_id = p.user_id group by 1, 2, 3 order by 1, 2, 3;
select count(*) as auth_users from auth.users;
\echo == qa batches
select label, scope::text, status, counts::text, started_at::date from public.qa_batches order by started_at;
\echo == policy / releases
select count(*) filter (where revoked_at is null) as active_policies from public.publication_policies;
select count(*) filter (where revoked_at is null) as active_release_decisions from public.release_decisions;
select content_kind, scope, count(*) filter (where revoked_at is null and decision = 'APPROVED') as active_approved from public.content_releases group by 1, 2 order by 1, 2;
\echo == corpus
select module, count(*) from public.items group by 1 order by 1;
select count(*) as units from public.units;
select count(*) as scenarios from public.speaking_scenarios;
select count(*) as audio_jobs from public.audio_jobs;
select count(*) as audio_assets_valid from public.audio_assets where invalidated_at is null;
\echo == provider usage, last 14 days
select provider, operation, ok, count(*), round(sum(estimated_cost_usd)::numeric, 5) as usd, round(avg(latency_ms)) as avg_ms
  from public.provider_usage where created_at > now() - interval '14 days' group by 1, 2, 3 order by 1, 2, 3;
\echo == budget ledger, this month
select provider, status, count(*), round(sum(coalesce(actual_eur, reserved_eur))::numeric, 4) as eur
  from public.budget_ledger where created_at >= date_trunc('month', now()) group by 1, 2 order by 1, 2;
\echo == server errors, last 14 days
select kind, path, left(message, 140) as message, count(*), max(at) from public.server_errors
  where at > now() - interval '14 days' group by 1, 2, 3 order by 5 desc limit 25;
