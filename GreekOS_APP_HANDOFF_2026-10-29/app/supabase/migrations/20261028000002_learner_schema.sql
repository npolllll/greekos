-- GreekOS: accounts, roles and per-learner state. Every learner-state row carries a NOT NULL
-- user_id that the server takes from the authenticated session, never from the request body.

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  email text,
  timezone text not null default 'Europe/Athens',
  active boolean not null default true,
  entry_path text check (entry_path in ('from_zero', 'prior_learning', 'unsure')),
  lifecycle_state text not null default 'invited' check (lifecycle_state in (
    'invited', 'activated', 'foundations', 'placement_pending', 'placement_in_progress',
    'provisional_route', 'placement_verified', 'studying', 'inactive'
  )),
  invited_at timestamptz,
  activated_at timestamptz,
  deactivated_at timestamptz,
  created_at timestamptz not null default now()
);

-- Protected role table; not editable by users, never derived from user metadata.
create table public.role_assignments (
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('learner', 'owner_admin')),
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  display_name text not null,
  entry_path text not null check (entry_path in ('from_zero', 'prior_learning', 'unsure')),
  invited_by uuid references auth.users(id) on delete set null,
  invited_user_id uuid references auth.users(id) on delete set null,
  status text not null default 'SENT' check (status in ('SENT', 'ACCEPTED', 'REVOKED', 'FAILED')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);

create table public.enrollments (
  user_id uuid primary key references auth.users(id) on delete cascade,
  start_date date,
  timezone text not null,
  target_months integer not null default 9 check (target_months = 9),
  end_date date,
  exam_date date,
  daily_minutes integer not null default 60 check (daily_minutes between 10 and 480),
  days_per_week integer not null default 6 check (days_per_week between 1 and 7),
  updated_at timestamptz not null default now()
);

create table public.preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  reduced_motion boolean not null default false,
  relevance jsonb not null default '{}'::jsonb,
  speaking_rate text not null default 'normal' check (speaking_rate in ('slow', 'normal')),
  updated_at timestamptz not null default now()
);

-- Generic idempotency ledger: one fact is recorded once per (user, key).
create table public.idempotency_keys (
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null check (char_length(key) between 8 and 200),
  scope text not null,
  result jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, key)
);

create table public.learning_routes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  route_kind text not null check (route_kind in ('foundations', 'provisional', 'verified', 'manual')),
  start_unit_id text references public.units(unit_id),
  skill_profile jsonb not null default '{}'::jsonb,
  reason text not null,
  set_by uuid references auth.users(id) on delete set null,
  set_at timestamptz not null default now()
);

create table public.route_changes (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  previous jsonb,
  next jsonb not null,
  reason text not null,
  changed_by uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now()
);

create table public.lesson_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  unit_id text not null references public.units(unit_id),
  unit_hash text not null,
  preview boolean not null default false,
  status text not null default 'IN_PROGRESS' check (status in ('IN_PROGRESS', 'COMPLETED', 'ABANDONED')),
  current_step text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);
create index lesson_sessions_user on public.lesson_sessions (user_id, unit_id);

create table public.attempts (
  attempt_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id text not null references public.items(item_id),
  content_hash text not null,
  context text not null check (context in ('lesson', 'review', 'diagnostic', 'exam', 'transfer', 'preview', 'speaking', 'pegp', 'real_greek', 'writing', 'corrective')),
  context_ref text,
  response_private jsonb not null,
  assistance text not null default 'none' check (assistance in ('none', 'hint', 'model_shown', 'retry_after_model', 'translation', 'tutor_help')),
  released_snapshot boolean not null,
  preview boolean not null default false,
  idempotency_key text not null,
  local_date date not null,
  timezone text not null,
  active_ms integer check (active_ms is null or active_ms >= 0),
  created_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);
create index attempts_user_item on public.attempts (user_id, item_id, created_at);

create table public.assessments (
  assessment_id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.attempts(attempt_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  verdict text not null check (verdict in (
    'CORRECT', 'ACCEPTABLE_VARIANT', 'INCORRECT_CONFIRMED', 'AMBIGUOUS', 'ASR_UNCERTAIN',
    'UNSUPPORTED', 'PENDING_REVIEW', 'ABSTAIN', 'NOT_ASSESSED'
  )),
  scorer text not null check (scorer in ('key', 'structured', 'joint_bank', 'ai_assessor', 'human', 'none')),
  reliable boolean not null,
  meaning_changing boolean,
  error_kind text,
  error_tags text[],
  rubric_id text,
  rubric_hash text,
  assessor_version text not null,
  dimensions jsonb,
  evidence jsonb not null default '[]'::jsonb,
  uncertainty text,
  feedback_ru text,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'SUPERSEDED', 'UNDER_APPEAL')),
  supersedes_id uuid references public.assessments(assessment_id),
  created_at timestamptz not null default now()
);
create index assessments_attempt on public.assessments (attempt_id);
create index assessments_user on public.assessments (user_id, created_at);

create table public.mastery_events (
  event_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  competency_id text not null references public.competencies(competency_id),
  attempt_id uuid references public.attempts(attempt_id) on delete cascade,
  item_id text,
  event_type text not null check (event_type in (
    'independent_correct', 'independent_incorrect', 'assisted_observation', 'review_passed',
    'review_failed', 'transfer_passed', 'transfer_failed', 'compensation', 'placement_observation'
  )),
  task_kind text check (task_kind in ('recognition', 'controlled', 'spontaneous', 'retention', 'transfer')),
  reliable boolean not null,
  meaning_changing boolean,
  review_interval_days integer,
  supersedes_id uuid references public.mastery_events(event_id),
  local_date date not null,
  created_at timestamptz not null default now()
);
create index mastery_events_user_comp on public.mastery_events (user_id, competency_id, created_at);

-- Derived read model, recomputed from mastery_events (the log is the source of truth).
create table public.competency_state (
  user_id uuid not null references auth.users(id) on delete cascade,
  competency_id text not null references public.competencies(competency_id),
  state text not null check (state in (
    'unseen', 'familiar', 'recognition', 'controlled', 'spontaneous', 'retention_due',
    'retained', 'transfer_confirmed', 'needs_review', 'insufficient_evidence'
  )),
  summary jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, competency_id)
);

create table public.spaced_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  competency_id text not null references public.competencies(competency_id),
  anchor_attempt_id uuid not null references public.attempts(attempt_id) on delete cascade,
  anchor_item_id text not null,
  anchor_local_date date not null,
  interval_days integer not null check (interval_days in (1, 3, 7, 14, 28)),
  due_local_date date not null,
  status text not null default 'due' check (status in ('due', 'passed', 'failed', 'assisted', 'superseded')),
  completed_attempt_id uuid references public.attempts(attempt_id) on delete set null,
  completed_local_date date,
  content_hash text,
  created_at timestamptz not null default now(),
  unique (user_id, competency_id, anchor_attempt_id, interval_days)
);
create index spaced_reviews_due on public.spaced_reviews (user_id, status, due_local_date);

-- Error Notebook: evidence-backed entries with uncertainty and appeal.
create table public.error_evidence (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  attempt_id uuid not null references public.attempts(attempt_id) on delete cascade,
  assessment_id uuid references public.assessments(assessment_id) on delete cascade,
  item_id text not null,
  competency_id text references public.competencies(competency_id),
  verdict text not null,
  error_kind text,
  error_tag text,
  meaning_changing boolean,
  evidence jsonb not null,
  uncertainty text,
  correction_el text,
  status text not null default 'open' check (status in ('open', 'practised', 'resolved', 'appealed', 'withdrawn')),
  created_at timestamptz not null default now()
);
create index error_evidence_user on public.error_evidence (user_id, status, created_at);

create table public.appeals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  assessment_id uuid not null references public.assessments(assessment_id) on delete cascade,
  reason_ru text not null check (char_length(reason_ru) between 3 and 2000),
  status text not null default 'OPEN' check (status in ('OPEN', 'UPHELD', 'REJECTED')),
  resolution_note text,
  resolved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (assessment_id)
);

-- v5.2 contextual feedback chain.
create table public.feedback_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  attempt_id uuid not null references public.attempts(attempt_id) on delete cascade,
  competency_id text references public.competencies(competency_id),
  error_code text,
  verdict text not null,
  explanation_version text not null,
  example_refs jsonb not null default '[]'::jsonb,
  captured_at timestamptz not null default now()
);

create table public.context_transfer_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  feedback_event_id uuid not null references public.feedback_events(id) on delete cascade,
  attempt_id uuid not null references public.attempts(attempt_id) on delete cascade,
  verdict text not null,
  evaluated_at timestamptz not null default now()
);

create table public.placement_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_path text not null,
  protocol_hash text not null,
  status text not null default 'IN_PROGRESS' check (status in ('IN_PROGRESS', 'COMPLETED', 'ABANDONED')),
  state jsonb not null default '{}'::jsonb,
  result jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.placement_axis_results (
  session_id uuid not null references public.placement_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  axis text not null check (axis in ('listening', 'reading', 'spoken_interaction', 'spoken_production', 'writing', 'pronunciation', 'grammar', 'vocabulary')),
  status text not null check (status in ('IN_PROGRESS', 'OBSERVED', 'NOT_OBSERVED', 'PENDING_REVIEW', 'STOPPED', 'NO_RELEASED_CONTENT')),
  observations jsonb not null default '[]'::jsonb,
  candidate_start text,
  confidence text check (confidence in ('low', 'medium', 'high')),
  not_observed_reason text,
  updated_at timestamptz not null default now(),
  primary key (session_id, axis)
);

-- Realtime feed of confirmed server-side learning events (no private answer content).
create table public.learner_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null check (event_type in (
    'lesson_started', 'lesson_completed', 'exercise_submitted', 'mistake_detected', 'review_due',
    'delayed_review_passed', 'delayed_review_failed', 'placement_updated', 'speaking_assessed',
    'speaking_session_ended', 'writing_assessed', 'exam_started', 'exam_completed', 'content_approved',
    'context_transfer_passed', 'competency_mastery_updated', 'route_changed', 'profile_activated',
    'appeal_opened', 'appeal_resolved', 'activity'
  )),
  idempotency_key text not null,
  source_version text,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  unique (user_id, event_type, idempotency_key)
);
create index learner_events_user on public.learner_events (user_id, occurred_at desc);

create table public.activity_days (
  user_id uuid not null references auth.users(id) on delete cascade,
  local_date date not null,
  active_seconds integer not null default 0 check (active_seconds >= 0),
  attempts integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, local_date)
);

create table public.consents (
  consent_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  purpose text not null check (purpose in ('voice_review_retention', 'owner_transcript_access', 'admin_learning_analytics_notice')),
  artifact_id text,
  reviewer_id uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  check (purpose <> 'voice_review_retention' or (expires_at is not null and expires_at <= granted_at + interval '30 days'))
);

create table public.speaking_sessions (
  session_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  scenario_id text not null references public.speaking_scenarios(scenario_id),
  scenario_hash text not null,
  mode text not null check (mode in ('a0_guided', 'course', 'roleplay', 'free_talk', 'tutor_help', 'b2_mock', 'real_greek')),
  input_mode text not null check (input_mode in ('voice', 'text_fallback')),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'PAUSED', 'ENDED', 'FAILED')),
  current_node text,
  repair_loops integer not null default 0,
  consent_id uuid references public.consents(consent_id),
  provider_snapshot jsonb not null,
  preview boolean not null default false,
  summary_private jsonb,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  local_date date not null
);

create table public.speaking_turns (
  turn_id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.speaking_sessions(session_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  seq integer not null,
  speaker text not null check (speaker in ('learner', 'assistant')),
  node_id text,
  text_el text,
  asr_text text,
  asr_confidence real,
  asr_provider text,
  transcript_confirmed boolean not null default false,
  interrupted boolean not null default false,
  playback_completed boolean,
  intent text,
  language_segments jsonb,
  help_used jsonb not null default '[]'::jsonb,
  audio_artifact_id uuid,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (session_id, seq),
  unique (user_id, idempotency_key)
);

create table public.voice_artifacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid references public.speaking_sessions(session_id) on delete cascade,
  consent_id uuid not null references public.consents(consent_id),
  object_path text not null,
  retention_until timestamptz not null,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.exam_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  component_id text not null references public.exam_components(component_id),
  component_hash text not null,
  mode text not null check (mode in ('simulation', 'practice')),
  status text not null default 'IN_PROGRESS' check (status in ('IN_PROGRESS', 'SUBMITTED', 'EXPIRED', 'ABANDONED')),
  server_started_at timestamptz not null default now(),
  server_expires_at timestamptz,
  answers_private jsonb not null default '{}'::jsonb,
  autosave_seq integer not null default 0,
  submitted_at timestamptz,
  results jsonb,
  idempotency_key text not null,
  unique (user_id, idempotency_key)
);

create table public.provider_usage (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  provider text not null,
  operation text not null,
  units numeric not null default 0,
  unit_kind text not null,
  estimated_cost_usd numeric not null default 0,
  ok boolean not null,
  latency_ms integer,
  created_at timestamptz not null default now()
);
create index provider_usage_day on public.provider_usage (created_at);

-- Append-only audit trail without raw secrets or transcripts.
create table public.admin_audit_log (
  event_id bigint generated always as identity primary key,
  actor_id uuid,
  action text not null,
  target_id text,
  target_user_id uuid,
  meta jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create trigger admin_audit_log_append_only
  before update or delete on public.admin_audit_log
  for each row execute function app_private.forbid_mutation();
