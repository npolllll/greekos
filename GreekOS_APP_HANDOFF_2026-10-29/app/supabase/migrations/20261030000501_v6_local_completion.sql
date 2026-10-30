-- GreekOS v6.0 local completion:
--  1. Owner-controlled DEV-PREVIEW (local/test environments only, enforced in server code) for the
--     owner and explicitly marked test learners — never for ordinary learner accounts.
--  2. Executable mass digital QA: batches, per-item results, per-issue records with resolution,
--     owner sample review and batch release decisions. A signed digital policy alone can no longer
--     release anything: OWNER_DIGITAL_POLICY releases must cite a QA batch and an owner decision.
--  3. Editorial corrections as new immutable content revisions (old releases stop matching).
--  4. Local open-model voices (Coqui VITS, MBROLA) and textual casting-proposal sources.

-- ---------- 1. DEV-PREVIEW ----------
alter table public.profiles
  add column account_kind text not null default 'learner' check (account_kind in ('learner', 'dev_preview_tester'));

create table public.dev_preview_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  expires_at timestamptz not null,
  scope text not null default 'all_gated_content' check (scope in ('all_gated_content')),
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  note text,
  check (expires_at > granted_at)
);

-- Only test accounts or the owner can ever hold a preview grant (a real learner cannot be opened up).
create or replace function app_private.assert_dev_preview_eligible() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.profiles p where p.user_id = new.user_id and p.account_kind = 'dev_preview_tester'
  ) and not exists (
    select 1 from public.role_assignments r where r.user_id = new.user_id and r.role = 'owner_admin'
  ) then
    raise exception 'dev preview is limited to owner_admin and dev_preview_tester accounts' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger dev_preview_access_eligible
  before insert or update on public.dev_preview_access
  for each row execute function app_private.assert_dev_preview_eligible();

-- A test account can never silently become an ordinary learner while it holds an active grant.
create or replace function app_private.forbid_tester_downgrade() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.account_kind = 'dev_preview_tester' and new.account_kind <> 'dev_preview_tester' and exists (
    select 1 from public.dev_preview_access a where a.user_id = new.user_id and a.revoked_at is null
  ) then
    raise exception 'revoke the dev preview grant before changing the account kind' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger profiles_tester_downgrade
  before update of account_kind on public.profiles
  for each row execute function app_private.forbid_tester_downgrade();

-- ---------- 2. Digital QA ----------
alter table public.digital_qa_runs drop constraint if exists digital_qa_runs_check_kind_check;
alter table public.digital_qa_runs add constraint digital_qa_runs_check_kind_check
  check (check_kind in ('STRUCTURAL', 'DIGITAL_LINGUISTIC_QA', 'DIGITAL_AUDIO_QA', 'AUTO_SOURCE_CHECKED', 'MACHINE_ORTHOGRAPHY', 'MACHINE_CONTENT_QA'));

create table public.qa_batches (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  scope jsonb not null,
  tool_version text not null,
  status text not null default 'RUNNING' check (status in ('RUNNING', 'COMPLETED', 'FAILED')),
  counts jsonb not null default '{}'::jsonb,
  checks_catalog jsonb not null default '[]'::jsonb,
  report_sha256 text,
  report_path text,
  run_by uuid references auth.users(id) on delete set null,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create table public.qa_item_results (
  batch_id uuid not null references public.qa_batches(id) on delete cascade,
  content_kind text not null,
  content_id text not null,
  content_hash text not null,
  unit_id text,
  module text,
  verdict text not null check (verdict in ('PASS', 'NEEDS_REVIEW', 'FAIL', 'ABSTAIN')),
  checks jsonb not null,
  blocking_count integer not null default 0,
  warning_count integer not null default 0,
  primary key (batch_id, content_kind, content_id)
);
create index qa_item_results_lookup on public.qa_item_results (content_kind, content_id, content_hash);

create table public.qa_issues (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.qa_batches(id) on delete cascade,
  content_kind text not null,
  content_id text not null,
  content_hash text not null,
  check_id text not null,
  severity text not null check (severity in ('blocking', 'warning', 'info')),
  field text,
  message_ru text not null,
  evidence jsonb not null default '{}'::jsonb,
  suggestion text,
  status text not null default 'open' check (status in ('open', 'fixed', 'accepted_risk', 'false_positive', 'superseded')),
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  resolution_note text,
  check (status = 'open' or status = 'superseded' or (resolved_by is not null and resolved_at is not null))
);
create index qa_issues_item on public.qa_issues (content_kind, content_id, status);
create index qa_issues_batch on public.qa_issues (batch_id, severity, status);

create table public.qa_sample_reviews (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.qa_batches(id) on delete cascade,
  content_kind text not null,
  content_id text not null,
  content_hash text not null,
  reviewer_id uuid not null references auth.users(id) on delete cascade,
  decision text not null check (decision in ('OK', 'ISSUE')),
  note text,
  reviewed_at timestamptz not null default now(),
  unique (batch_id, content_kind, content_id, reviewer_id)
);

create table public.release_decisions (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.qa_batches(id),
  policy_id uuid not null references public.publication_policies(id),
  scope jsonb not null,
  risk_acceptance text not null check (risk_acceptance in ('PASS_ONLY', 'PASS_AND_ACCEPTED_WARNINGS')),
  sample_size integer not null check (sample_size >= 0),
  sample_ok integer not null check (sample_ok >= 0),
  counts jsonb not null default '{}'::jsonb,
  note text,
  decided_by uuid not null references auth.users(id),
  decided_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  revoked_reason text
);

alter table public.content_releases
  add column qa_batch_id uuid references public.qa_batches(id),
  add column decision_id uuid references public.release_decisions(id);
-- A digital-policy release must cite the QA batch and the owner's batch decision that covered it.
alter table public.content_releases add constraint content_releases_policy_needs_qa
  check (review_type <> 'OWNER_DIGITAL_POLICY' or (qa_batch_id is not null and decision_id is not null));

-- ---------- 3. Editorial corrections ----------
create table public.content_patches (
  id uuid primary key default gen_random_uuid(),
  content_kind text not null check (content_kind in ('item')),
  content_id text not null,
  base_hash text not null,
  new_hash text not null,
  changes jsonb not null,
  reason text not null check (char_length(reason) between 3 and 1000),
  issue_id uuid references public.qa_issues(id) on delete set null,
  revision_id bigint not null references public.content_revisions(id),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

-- ---------- 4. Voices and casting ----------
alter table public.voice_catalog drop constraint if exists voice_catalog_provider_check;
alter table public.voice_catalog add constraint voice_catalog_provider_check
  check (provider in ('local_macos', 'local_coqui', 'local_mbrola', 'azure', 'google', 'openai', 'mock'));
alter table public.audio_job_casting drop constraint if exists audio_job_casting_source_check;
alter table public.audio_job_casting add constraint audio_job_casting_source_check
  check (source in ('owner', 'grammatical_gender_proposal', 'self_reference_proposal', 'narrator_default_proposal', 'article_reference_proposal', 'distinct_voice_proposal', 'needs_casting'));

-- ---------- RLS: all new tables are server-only (service role) ----------
do $$
declare t text;
begin
  foreach t in array array['dev_preview_access', 'qa_batches', 'qa_item_results', 'qa_issues', 'qa_sample_reviews', 'release_decisions', 'content_patches'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated, public', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end $$;
grant usage on all sequences in schema public to service_role;
