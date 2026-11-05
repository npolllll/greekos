-- v5.4 A06: exam listening plays are counted on the server per attempt and asset.
-- Simulation allows the form's play limit (KEG B2 corpus: "two plays"); practice is unlimited.
alter table public.exam_attempts add column if not exists audio_plays jsonb not null default '{}'::jsonb;
alter table public.exam_attempts add constraint exam_attempts_audio_plays_object check (jsonb_typeof(audio_plays) = 'object');
