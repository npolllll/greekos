-- Content patches (revision history with reasons) for ΠΕΓΠ packets and content singletons too, not only
-- items and units: the ΠΕΓΠ completion revision of 14.11.2026 records changes to packets P01/P06 and to
-- the module overview. Widening a check constraint; reversible by restoring the previous list.
alter table public.content_patches drop constraint if exists content_patches_content_kind_check;
alter table public.content_patches add constraint content_patches_content_kind_check
  check (content_kind in ('item', 'unit', 'pegp_packet', 'singleton'));
