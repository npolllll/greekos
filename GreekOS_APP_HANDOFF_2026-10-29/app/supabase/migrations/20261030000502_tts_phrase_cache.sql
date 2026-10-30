-- On-demand phrase audio for lesson examples/vocabulary ("Послушать"): synthesized once per
-- (voice, speed, text, synthesis version), screened by ASR round-trip before it is ever served,
-- cached in the private tts-cache bucket. Server-only table; learners get 5-minute signed URLs.
create table public.tts_cache_entries (
  cache_key text primary key check (cache_key ~ '^[0-9a-f]{64}$'),
  text_el text not null check (char_length(text_el) between 1 and 600),
  voice_id text not null,
  speed text not null check (speed in ('normal', 'slow')),
  synthesis_version text not null,
  object_path text not null,
  sha256 text not null,
  duration_ms integer,
  roundtrip jsonb not null,
  qa_verdict text not null check (qa_verdict in ('PASS', 'NEEDS_REVIEW')),
  dev_only boolean not null,
  hits integer not null default 0,
  created_at timestamptz not null default now()
);
alter table public.tts_cache_entries enable row level security;
revoke all on table public.tts_cache_entries from anon, authenticated, public;
grant all on table public.tts_cache_entries to service_role;
