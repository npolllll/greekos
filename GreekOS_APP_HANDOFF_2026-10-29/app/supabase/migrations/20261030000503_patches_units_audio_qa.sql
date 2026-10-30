-- Editorial corrections may also target unit teaching texts (new immutable revision, old releases
-- stop matching), and audio QA snapshots are stored as QA batches so audio releases cite them too.
alter table public.content_patches drop constraint if exists content_patches_content_kind_check;
alter table public.content_patches add constraint content_patches_content_kind_check check (content_kind in ('item', 'unit'));
alter table public.release_decisions add column if not exists expires_at timestamptz;
