-- GreekOS Voice & Audio v5.4: voice catalog, explicit casting, render lifecycle, latency metrics.
-- Additive and compatible with existing data; canonical audio jobs are never rewritten.

-- 1. Voice catalog: what each provider DECLARES (presentation is never inferred by the app).
create table public.voice_catalog (
  voice_id text primary key,                         -- e.g. 'local:macos:com.apple.voice.compact.el-GR.Melina', 'azure:el-GR-AthinaNeural'
  provider text not null check (provider in ('local_macos', 'azure', 'google', 'openai', 'mock')),
  provider_voice_name text not null,
  display_name text not null,
  locale text not null default 'el-GR',
  presentation text not null check (presentation in ('female', 'male', 'other', 'unspecified')),
  presentation_source text not null,                 -- e.g. 'NSSpeechSynthesizer.VoiceGender', 'azure voices/list Gender'
  quality_tier text,                                 -- provider label, e.g. 'compact', 'Neural'
  engine_kind text not null check (engine_kind in ('local', 'cloud', 'test')),
  available boolean not null default false,          -- detected on this machine / account at last sync
  streaming_capable boolean not null default false,
  speed_profile jsonb not null default '{"normal": 1.0, "slow": 0.88, "fast": 1.1}'::jsonb,
  style_support jsonb not null default '[]'::jsonb,  -- only styles the provider actually supports
  version text,
  rights jsonb not null default '{}'::jsonb,
  distribution_allowed boolean not null default false,
  sample_object_path text,
  sample_sha256 text,
  approved_by_owner boolean not null default false,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  qa_status text not null default 'NOT_TESTED' check (qa_status in ('NOT_TESTED', 'TECH_QA_PASS', 'TECH_QA_FAIL', 'OWNER_LISTENED', 'REJECTED')),
  last_synced_at timestamptz,
  notes text,
  check (provider <> 'mock' or (distribution_allowed = false and approved_by_owner = false))
);

-- 2. Cast roles (03_CASTING_REQUIREMENTS.csv) and their assigned voices.
create table public.cast_roles (
  cast_role_id text primary key,
  requested_presentation text not null check (requested_presentation in ('female', 'male', 'any')),
  locale text not null default 'el-GR',
  use_case text not null,
  target_speed text not null default 'normal',
  voice_id text references public.voice_catalog(voice_id) on delete set null,
  approved boolean not null default false,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  status text not null default 'unapproved'
);

insert into public.cast_roles (cast_role_id, requested_presentation, use_case, target_speed) values
  ('NARRATOR_F', 'female', 'course lessons / neutral', 'normal'),
  ('NARRATOR_M', 'male', 'course dialogues / neutral', 'normal'),
  ('ROLE_CAFE_F', 'female', 'cafe / public situations', 'normal'),
  ('ROLE_CAFE_M', 'male', 'shop / public situations', 'normal'),
  ('TUTOR_F', 'female', 'optional tutor persona', 'normal'),
  ('TUTOR_M', 'male', 'optional tutor persona', 'normal')
on conflict do nothing;

-- 3. Per job/role casting. Proposals are explicit about their evidence; only approved rows are final.
create table public.audio_job_casting (
  audio_id text not null references public.audio_jobs(audio_id) on delete cascade,
  speaker_role text not null,                        -- '__narrator__' for jobs without speaker segments
  cast_role_id text references public.cast_roles(cast_role_id),
  required_presentation text check (required_presentation in ('female', 'male', 'any')),
  source text not null check (source in ('owner', 'grammatical_gender_proposal', 'self_reference_proposal', 'narrator_default_proposal', 'needs_casting')),
  evidence text,
  approved boolean not null default false,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (audio_id, speaker_role)
);

-- 4. Render lifecycle and provenance on synthesized assets.
alter table public.audio_assets drop constraint if exists audio_assets_rights_status_check;
alter table public.audio_assets add constraint audio_assets_rights_status_check
  check (rights_status in ('RIGHTS_PENDING', 'PROVIDER_TERMS_RECORDED', 'DEV_LOCAL_ONLY', 'BLOCKED'));
alter table public.audio_assets
  add column render_status text not null default 'GENERATED' check (render_status in (
    'AUDIO_PENDING', 'GENERATED', 'TECH_QA_PASS', 'TECH_QA_FAIL', 'LINGUISTIC_QA_PENDING', 'DIGITAL_REVIEWED', 'RELEASE_ELIGIBLE', 'BLOCKED')),
  add column synthesis_version text,
  add column voice_ids text[] not null default '{}',
  add column cast_snapshot jsonb,
  add column generation_params jsonb,
  add column master_object_path text,
  add column master_sha256 text,
  add column normalization jsonb,
  add column cast_approved boolean not null default false,
  add column history jsonb not null default '[]'::jsonb;

alter table public.audio_assets drop constraint if exists audio_assets_mock_never_verified;
alter table public.audio_assets add constraint audio_assets_mock_never_verified
  check (provider <> 'mock' or (digital_status <> 'AUDIO_VERIFIED_DIGITAL' and rights_status = 'RIGHTS_PENDING' and render_status not in ('DIGITAL_REVIEWED', 'RELEASE_ELIGIBLE')));
-- A release-eligible asset needs approved casting and recorded distribution rights.
alter table public.audio_assets add constraint audio_assets_release_eligible_requirements
  check (render_status <> 'RELEASE_ELIGIBLE' or (cast_approved and rights_status = 'PROVIDER_TERMS_RECORDED' and digital_status = 'AUDIO_VERIFIED_DIGITAL'));

-- Per-job render outcome for the 142-job report (never silently skipped).
create table public.audio_job_render_status (
  audio_id text primary key references public.audio_jobs(audio_id) on delete cascade,
  status text not null check (status in ('AUDIO_PENDING', 'BLOCKED_MISSING_VOICE_METADATA', 'BLOCKED_NO_SUITABLE_VOICE', 'BLOCKED_BUDGET', 'RENDER_FAILED', 'GENERATED', 'TECH_QA_PASS', 'TECH_QA_FAIL', 'DIGITAL_REVIEWED', 'RELEASE_ELIGIBLE')),
  reason text,
  last_asset_id uuid references public.audio_assets(id) on delete set null,
  attempts integer not null default 0,
  estimated_cost_usd numeric not null default 0,
  updated_at timestamptz not null default now()
);

-- 5. Speaking: persona, transport and measured latency per turn.
alter table public.speaking_sessions
  add column voice_persona text references public.cast_roles(cast_role_id),
  add column transport text not null default 'batch' check (transport in ('batch', 'stream_local_gateway', 'stream_cloud_gateway'));

create table public.speaking_turn_metrics (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.speaking_sessions(session_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  turn_seq integer not null,
  transport text not null,
  asr_engine text,
  tts_engine text,
  dialogue_engine text,
  speech_ms integer,                 -- learner speech duration
  vad_hangover_ms integer,           -- silence waited before end-of-turn
  asr_partial_first_ms integer,      -- from speech start
  asr_final_ms integer,              -- from end-of-turn decision
  llm_first_token_ms integer,        -- dialogue decision time
  tts_first_audio_ms integer,        -- first synthesized chunk ready (from end-of-turn)
  playback_start_ms integer,         -- client-reported first audible output (from end-of-turn)
  end_of_speech_to_audio_ms integer, -- from last voiced frame to playback start
  interrupted boolean not null default false,
  heard_ms integer,
  input_source text not null default 'microphone' check (input_source in ('microphone', 'synthetic_test_clip')),
  created_at timestamptz not null default now(),
  unique (session_id, turn_seq)
);
create index speaking_turn_metrics_created on public.speaking_turn_metrics (created_at);

-- RLS and grants consistent with 0003: content-side tables server-only; learner metrics own-select.
do $$
declare t text;
begin
  foreach t in array array['voice_catalog', 'cast_roles', 'audio_job_casting', 'audio_job_render_status', 'speaking_turn_metrics'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated, public', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end $$;
grant usage on all sequences in schema public to service_role;
grant select on table public.speaking_turn_metrics to authenticated;
create policy speaking_turn_metrics_select_own on public.speaking_turn_metrics for select to authenticated
  using (user_id = (select auth.uid()) and app_private.is_active_user((select auth.uid())));
