-- Corrections made by a named system tool (e.g. the digital-QA homoglyph fixer) are recorded as such:
-- a patch has either a human author or a system actor, never neither.
alter table public.content_patches alter column created_by drop not null;
alter table public.content_patches add column if not exists system_actor text;
alter table public.content_patches drop constraint if exists content_patches_author_check;
alter table public.content_patches add constraint content_patches_author_check
  check (created_by is not null or (system_actor is not null and length(system_actor) between 3 and 80));
