-- Owner-signed delegation of routine editorial steps to the AI editor (14.11.2026 owner instruction):
-- the sample review and the batch release of PASS material under the owner's signed digital policy, and
-- the choice of voices. Every such act is stored as the AI editor's (system actor), never as the owner's
-- or as a human review. The owner's own acts (policy signature = risk acceptance, provider terms) are not
-- delegable and keep their owner-only columns. Additive and reversible: new nullable columns and checks.

-- What the owner delegated when signing (null = nothing delegated).
alter table public.publication_policies add column if not exists delegation jsonb;

-- Sample reviews: by the owner (a user) or by the AI editor (a system actor, no user).
alter table public.qa_sample_reviews alter column reviewer_id drop not null;
alter table public.qa_sample_reviews add column if not exists reviewer_kind text not null default 'owner';
alter table public.qa_sample_reviews add column if not exists system_actor text;
alter table public.qa_sample_reviews drop constraint if exists qa_sample_reviews_reviewer_kind_check;
alter table public.qa_sample_reviews add constraint qa_sample_reviews_reviewer_kind_check check (reviewer_kind in ('owner', 'ai_editorial'));
alter table public.qa_sample_reviews drop constraint if exists qa_sample_reviews_actor_check;
alter table public.qa_sample_reviews add constraint qa_sample_reviews_actor_check check (
  (reviewer_kind = 'owner' and reviewer_id is not null and system_actor is null)
  or (reviewer_kind = 'ai_editorial' and reviewer_id is null and system_actor is not null));
create unique index if not exists qa_sample_reviews_ai_unique on public.qa_sample_reviews (batch_id, content_kind, content_id) where reviewer_kind = 'ai_editorial';

-- Release decisions: by the owner, or by the AI editor under a policy that delegates it.
alter table public.release_decisions alter column decided_by drop not null;
alter table public.release_decisions add column if not exists system_actor text;
alter table public.release_decisions drop constraint if exists release_decisions_actor_check;
alter table public.release_decisions add constraint release_decisions_actor_check check (decided_by is not null or system_actor is not null);

-- Voice / casting approvals: who approved and why.
alter table public.voice_catalog add column if not exists approval_source text;
alter table public.voice_catalog add column if not exists approval_note text;
alter table public.cast_roles add column if not exists approval_source text;
alter table public.cast_roles add column if not exists approval_note text;
alter table public.audio_job_casting add column if not exists approval_source text;
alter table public.voice_catalog drop constraint if exists voice_catalog_approval_source_check;
alter table public.voice_catalog add constraint voice_catalog_approval_source_check check (approval_source is null or approval_source in ('owner', 'ai_editorial_delegated'));
alter table public.cast_roles drop constraint if exists cast_roles_approval_source_check;
alter table public.cast_roles add constraint cast_roles_approval_source_check check (approval_source is null or approval_source in ('owner', 'ai_editorial_delegated'));
alter table public.audio_job_casting drop constraint if exists audio_job_casting_approval_source_check;
alter table public.audio_job_casting add constraint audio_job_casting_approval_source_check check (approval_source is null or approval_source in ('owner', 'ai_editorial_delegated'));

-- Revision history (content_patches) also for speaking scenarios, Real Greek cards and text objects (exam
-- texts): the final AI review of 15.11.2026 corrects Greek in them. Widening a check; reversible.
alter table public.content_patches drop constraint if exists content_patches_content_kind_check;
alter table public.content_patches add constraint content_patches_content_kind_check
  check (content_kind in ('item', 'unit', 'pegp_packet', 'singleton', 'scenario', 'rg_expression', 'object'));
