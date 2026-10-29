-- GreekOS: canonical content storage.
-- Content rows are server-only (no anon/authenticated grants). Every imported object keeps an
-- immutable revision keyed by (kind, id, sha256); "current" tables point at the latest revision.

create extension if not exists pgcrypto with schema extensions;

create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

create table public.import_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null check (status in ('RUNNING', 'COMMITTED', 'FAILED', 'VALIDATED_ONLY')),
  tool_version text not null,
  corpus_label text,
  input_hashes jsonb not null default '{}'::jsonb,
  counts jsonb not null default '{}'::jsonb,
  report jsonb not null default '{}'::jsonb
);

create table public.import_quarantine (
  id bigint generated always as identity primary key,
  import_run_id uuid not null references public.import_runs(id) on delete cascade,
  content_kind text not null,
  content_id text,
  json_path text,
  reason text not null,
  created_at timestamptz not null default now()
);

create table public.content_revisions (
  id bigint generated always as identity primary key,
  content_kind text not null check (content_kind in (
    'item', 'unit', 'competency', 'source_claim', 'rubric', 'object', 'audio_job', 'scenario',
    'exam_form', 'exam_component', 'rg_expression', 'pegp_packet', 'pegp_catalog',
    'singleton', 'context_example'
  )),
  content_id text not null,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  module text,
  payload_private jsonb not null,
  import_run_id uuid references public.import_runs(id),
  created_at timestamptz not null default now(),
  unique (content_kind, content_id, content_hash)
);

-- Immutable: revisions can only be inserted.
create or replace function app_private.forbid_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'immutable table %: % is not allowed', tg_table_name, tg_op using errcode = '42501';
end;
$$;

create trigger content_revisions_immutable
  before update or delete on public.content_revisions
  for each row execute function app_private.forbid_mutation();

create table public.competencies (
  competency_id text primary key,
  scope text not null check (scope in ('core', 'external')),
  module text,
  level text,
  name text,
  prerequisites text[] not null default '{}',
  primary_unit_ids text[] not null default '{}',
  definition jsonb not null,
  current_hash text not null,
  revision_id bigint not null references public.content_revisions(id)
);

create table public.source_claims (
  claim_id text primary key,
  source_id text,
  status text,
  record jsonb not null,
  evidence_path text,
  evidence_file_sha256 text,
  current_hash text not null,
  revision_id bigint not null references public.content_revisions(id)
);

create table public.rubrics (
  rubric_id text primary key,
  refs jsonb not null,
  payload jsonb not null,
  current_hash text not null,
  revision_id bigint not null references public.content_revisions(id)
);

create table public.content_objects (
  object_id text primary key,
  refs jsonb not null,
  payload jsonb not null,
  current_hash text not null,
  revision_id bigint not null references public.content_revisions(id)
);

create table public.units (
  unit_id text primary key,
  level text not null check (level in ('A1', 'A2', 'B1', 'B2')),
  sort_key integer not null,
  title_ru text not null,
  prerequisites text[] not null default '{}',
  soft_prerequisites text[] not null default '{}',
  competency_ids text[] not null default '{}',
  primary_competencies text[] not null default '{}',
  estimated_active_minutes integer,
  teaching jsonb not null,
  current_hash text not null,
  revision_id bigint not null references public.content_revisions(id)
);

create table public.audio_jobs (
  audio_id text primary key,
  status text not null,
  priority text,
  script_hash text not null,
  text_el text,
  segments jsonb not null default '[]'::jsonb,
  payload jsonb not null,
  current_hash text not null,
  revision_id bigint not null references public.content_revisions(id)
);

create table public.items (
  item_id text primary key,
  module text not null check (module in ('core', 'keg_b2', 'pegp', 'real_greek', 'synthetic_fixture')),
  unit_id text references public.units(unit_id),
  item_type text not null,
  level text,
  pool text,
  section text,
  requires_audio boolean not null,
  scoring_strategy text not null,
  competency_ids text[] not null default '{}',
  prerequisite_ids text[] not null default '{}',
  audio_job_ids text[] not null default '{}',
  error_tags text[],
  envelope jsonb not null,
  current_hash text not null check (current_hash ~ '^[0-9a-f]{64}$'),
  revision_id bigint not null references public.content_revisions(id),
  check ((module = 'synthetic_fixture') = (item_id like 'SYN-%'))
);
create index items_unit_idx on public.items (unit_id);
create index items_module_idx on public.items (module);
create index items_competencies_idx on public.items using gin (competency_ids);

create table public.item_competencies (
  item_id text not null references public.items(item_id) on delete cascade,
  competency_id text not null references public.competencies(competency_id),
  relation text not null check (relation in ('target', 'prerequisite')),
  primary key (item_id, competency_id, relation)
);

create table public.item_sources (
  item_id text not null references public.items(item_id) on delete cascade,
  claim_id text not null references public.source_claims(claim_id),
  primary key (item_id, claim_id)
);

create table public.item_audio (
  item_id text not null references public.items(item_id) on delete cascade,
  audio_id text not null references public.audio_jobs(audio_id),
  primary key (item_id, audio_id)
);

create table public.speaking_scenarios (
  scenario_id text primary key,
  level text,
  domain text,
  objective_ru text,
  competency_ids text[] not null default '{}',
  payload jsonb not null,
  current_hash text not null,
  revision_id bigint not null references public.content_revisions(id)
);

create table public.exam_forms (
  form_id text primary key,
  payload jsonb not null,
  current_hash text not null,
  revision_id bigint not null references public.content_revisions(id)
);

create table public.exam_components (
  component_id text primary key,
  form_id text not null references public.exam_forms(form_id),
  logical_id text,
  component_kind text not null check (component_kind in ('reading', 'use_of_language', 'listening', 'writing', 'speaking')),
  duration_minutes integer,
  item_ids text[] not null default '{}',
  text_ids text[] not null default '{}',
  payload jsonb not null,
  current_hash text not null,
  revision_id bigint not null references public.content_revisions(id)
);

create table public.rg_expressions (
  expression_id text primary key,
  expression text not null,
  payload jsonb not null,
  current_hash text not null,
  revision_id bigint not null references public.content_revisions(id)
);

create table public.pegp_packets (
  packet_id text primary key,
  topic_code text,
  packet_kind text not null check (packet_kind in ('thematic', 'language_support')),
  payload jsonb not null,
  current_hash text not null,
  revision_id bigint not null references public.content_revisions(id)
);

create table public.content_singletons (
  singleton_id text primary key,
  payload jsonb not null,
  current_hash text not null,
  revision_id bigint not null references public.content_revisions(id)
);

-- Owner-signed policies (e.g. digital-only publication with explicit risk acceptance).
create table public.publication_policies (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('DIGITAL_ONLY_RISK_ACCEPTED')),
  version text not null,
  statement_ru text not null,
  risks_acknowledged jsonb not null,
  signed_by uuid not null references auth.users(id),
  signed_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null
);

-- Release record for one exact content hash. A client flag can never release anything.
create table public.content_releases (
  id uuid primary key default gen_random_uuid(),
  content_kind text not null check (content_kind in ('item', 'unit', 'scenario', 'audio_asset', 'exam_component', 'rg_expression', 'pegp_packet', 'context_example')),
  content_id text not null,
  content_hash text not null,
  review_type text not null check (review_type in ('HUMAN_TEACHER_REVIEW', 'HUMAN_EXAMINER_REVIEW', 'OWNER_DIGITAL_POLICY', 'SYNTHETIC_TEST_FIXTURE')),
  reviewer_identity text not null,
  reviewer_user_id uuid references auth.users(id) on delete set null,
  method text not null,
  scope text not null check (scope in ('learner_practice', 'diagnostic', 'exam_practice', 'pegp_session', 'real_greek', 'audio_playback')),
  evidence_path text,
  evidence_hash text,
  decision text not null check (decision in ('APPROVED', 'REJECTED')),
  reviewed_at timestamptz not null default now(),
  rights_scope text not null,
  expires_at timestamptz,
  policy_id uuid references public.publication_policies(id),
  revoked_at timestamptz,
  revoked_reason text,
  created_at timestamptz not null default now(),
  check ((review_type = 'SYNTHETIC_TEST_FIXTURE') = (content_id like 'SYN-%')),
  check (review_type <> 'OWNER_DIGITAL_POLICY' or policy_id is not null),
  check (review_type not like 'HUMAN_%' or (evidence_path is not null and evidence_hash is not null))
);
create index content_releases_lookup on public.content_releases (content_kind, content_id, content_hash) where revoked_at is null;

-- Automated QA results bound to an exact hash. Never a human verification.
create table public.digital_qa_runs (
  id uuid primary key default gen_random_uuid(),
  content_kind text not null,
  content_id text not null,
  content_hash text not null,
  check_kind text not null check (check_kind in ('STRUCTURAL', 'DIGITAL_LINGUISTIC_QA', 'DIGITAL_AUDIO_QA', 'AUTO_SOURCE_CHECKED')),
  tool_id text not null,
  verdict text not null check (verdict in ('PASS', 'NEEDS_REVIEW', 'FAIL', 'ABSTAIN')),
  report jsonb not null,
  run_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index digital_qa_runs_lookup on public.digital_qa_runs (content_kind, content_id, content_hash);

-- Synthesized audio (digital-only production). HUMAN statuses are never written by the system.
create table public.audio_assets (
  id uuid primary key default gen_random_uuid(),
  audio_id text not null references public.audio_jobs(audio_id),
  script_hash text not null,
  idempotency_key text not null unique,
  provider text not null,
  model text,
  voice_map jsonb not null,
  locale text not null default 'el-GR',
  object_path text,
  mime_type text,
  sha256 text,
  byte_length integer,
  duration_ms integer,
  sample_rate integer,
  channels integer,
  segment_cues jsonb,
  technical_status text not null default 'PENDING' check (technical_status in ('PENDING', 'TECHNICAL_PASS', 'TECHNICAL_FAIL')),
  technical_report jsonb,
  asr_roundtrip jsonb,
  digital_status text not null default 'PENDING' check (digital_status in ('PENDING', 'AUDIO_VERIFIED_DIGITAL', 'NEEDS_REVIEW', 'BLOCKED')),
  rights_status text not null default 'RIGHTS_PENDING' check (rights_status in ('RIGHTS_PENDING', 'PROVIDER_TERMS_RECORDED', 'BLOCKED')),
  rights_evidence jsonb,
  synthetic_disclosure boolean not null default true check (synthetic_disclosure),
  invalidated_at timestamptz,
  invalidated_reason text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index audio_assets_job on public.audio_assets (audio_id) where invalidated_at is null;

-- v5.2 context library: only examples bound to canonical competencies and approved provenance.
create table public.content_examples (
  id text primary key,
  competency_id text references public.competencies(competency_id),
  error_code text,
  cefr_min text,
  cefr_max text,
  register text,
  locale text not null default 'el-GR',
  example_type text not null check (example_type in ('situation', 'dialogue', 'pronunciation', 'media')),
  approved_text_gr text not null,
  translation_ru text,
  meaning_notes_ru text,
  contrast_id text,
  provenance_json jsonb not null,
  text_hash text not null,
  quality_status text not null check (quality_status in ('DRAFT', 'NEEDS_SOURCE', 'DIGITAL_LINGUISTIC_QA', 'HUMAN_VERIFIED', 'BLOCKED')),
  version text not null,
  created_at timestamptz not null default now(),
  published_at timestamptz
);

create table public.example_variants (
  id bigint generated always as identity primary key,
  example_id text not null references public.content_examples(id) on delete cascade,
  role text,
  speech_text_gr text not null,
  localized_text_ru text,
  pragmatic_intent text,
  voice_profile_id text,
  seq integer not null,
  timing_hint text
);

create table public.media_rights (
  id bigint generated always as identity primary key,
  example_id text not null references public.content_examples(id) on delete cascade,
  source_url text,
  owner text,
  license_basis text,
  embed_policy text,
  excerpt_policy text,
  reviewed_on date,
  valid_until date,
  status text not null check (status in ('RIGHTS_PENDING', 'EMBED_ALLOWED', 'LINK_ONLY', 'BLOCKED'))
);

create table public.example_review_events (
  id bigint generated always as identity primary key,
  example_id text not null references public.content_examples(id) on delete cascade,
  tool_id text not null,
  verdict text not null,
  checked_hash text not null,
  evidence_ref text,
  checked_at timestamptz not null default now()
);
