-- Onboarding answers of the learner (mandate §2.1): the goal of study, the learner's own estimate of
-- their level and their confidence per skill. These are orientation only — the route is set by the
-- diagnostic, never by a self-estimate — and they can be changed later without losing history.
alter table public.enrollments
  add column goal text check (goal in ('life_in_greece', 'keg_b2', 'work', 'study', 'travel', 'family', 'other')),
  add column self_level text check (self_level in ('A1', 'A2', 'B1', 'B2', 'unknown')),
  add column skill_confidence jsonb not null default '{}'::jsonb;
