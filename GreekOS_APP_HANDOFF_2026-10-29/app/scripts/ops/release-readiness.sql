-- GreekOS ops — read-only: what the owner's release decision would open, and what still waits for the
-- owner (policy, sample, voices, Azure terms). Content identifiers and counts only; no personal data.
\pset footer off
\echo == latest full QA batch
select label, started_at, counts::text from public.qa_batches where scope->>'kind' = 'all' and status = 'COMPLETED' order by started_at desc limit 1;
\echo == verdicts of that batch by kind and module
with b as (select id from public.qa_batches where scope->>'kind' = 'all' and status = 'COMPLETED' order by started_at desc limit 1)
select r.content_kind, coalesce(r.module, '—') as module, r.verdict, count(*) from public.qa_item_results r join b on b.id = r.batch_id group by 1, 2, 3 order by 1, 2, 3;
\echo == objects changed after that batch (would be STALE for a release from it)
with b as (select id from public.qa_batches where scope->>'kind' = 'all' and status = 'COMPLETED' order by started_at desc limit 1)
select 'item' as kind, count(*) from public.items i where not exists (select 1 from public.qa_item_results r, b where r.batch_id = b.id and r.content_kind = 'item' and r.content_id = i.item_id and r.content_hash = i.current_hash)
union all select 'unit', count(*) from public.units u where not exists (select 1 from public.qa_item_results r, b where r.batch_id = b.id and r.content_kind = 'unit' and r.content_id = u.unit_id and r.content_hash = u.current_hash);
\echo == items that need released audio (listening), by module
select module, count(*) filter (where requires_audio and cardinality(audio_job_ids) > 0) as need_audio, count(*) as items from public.items group by 1 order by 1;
\echo == units whose every in-lesson task needs audio (would open with nothing to do)
select count(*) as units_audio_only from public.units u where not exists (select 1 from public.items i where i.unit_id = u.unit_id and coalesce(i.section, '') <> 'retention' and not (i.requires_audio and cardinality(i.audio_job_ids) > 0));
\echo == voices and casting (owner approval)
select c.cast_role_id, c.requested_presentation, v.provider_voice_name, c.approved, c.status from public.cast_roles c left join public.voice_catalog v on v.voice_id = c.voice_id order by 1;
\echo == audio assets by status
select digital_status, rights_status, technical_status, count(*) from public.audio_assets where invalidated_at is null group by 1, 2, 3 order by 4 desc;
\echo == owner decisions on record
select (select count(*) from public.publication_policies where revoked_at is null) as active_policies,
       (select count(*) from public.release_decisions where revoked_at is null) as active_release_decisions,
       (select count(*) from public.content_releases where revoked_at is null and decision = 'APPROVED') as released_objects,
       (select count(*) from public.cast_roles where approved) as approved_cast_roles;
