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
\echo == audio: ready for the AI editor's release except the owner's items (provider terms recorded, signed policy)
with cur as (
  select a.audio_id, a.technical_status, a.digital_status, a.cast_approved, a.script_hash = j.script_hash as script_current,
         (select h from jsonb_array_elements(a.history) h where h->>'event' = 'editorial_reviewed' and (h->>'sha256' is null or h->>'sha256' = a.sha256) order by h->>'at' desc limit 1) as ed
  from public.audio_assets a join public.audio_jobs j on j.audio_id = a.audio_id where a.invalidated_at is null)
select (select count(*) from public.audio_jobs) as jobs, count(distinct audio_id) as jobs_with_current_file, count(*) as current_files,
       count(*) filter (where technical_status = 'TECHNICAL_PASS' and digital_status = 'AUDIO_VERIFIED_DIGITAL' and cast_approved and script_current and ed->>'decision' = 'OK') as ready_except_owner_items,
       count(*) filter (where digital_status <> 'AUDIO_VERIFIED_DIGITAL') as not_verified, count(*) filter (where not cast_approved) as cast_not_approved,
       count(*) filter (where ed is null) as no_editorial_review_of_this_file, count(*) filter (where ed->>'decision' = 'ISSUE') as editorial_issue
from cur;
with cur as (
  select a.audio_id, a.technical_status, a.digital_status, a.cast_approved, a.script_hash = j.script_hash as script_current,
         (select h from jsonb_array_elements(a.history) h where h->>'event' = 'editorial_reviewed' and (h->>'sha256' is null or h->>'sha256' = a.sha256) order by h->>'at' desc limit 1) as ed
  from public.audio_assets a join public.audio_jobs j on j.audio_id = a.audio_id where a.invalidated_at is null)
select audio_id, technical_status, digital_status, cast_approved, script_current, ed->>'decision' as editorial from cur
where not (technical_status = 'TECHNICAL_PASS' and digital_status = 'AUDIO_VERIFIED_DIGITAL' and cast_approved and script_current and coalesce(ed->>'decision', '') = 'OK') order by 1;
\echo == audio jobs whose last render attempt failed
select audio_id, status, left(reason, 120) as reason from public.audio_job_render_status where status = 'RENDER_FAILED' order by 1;
\echo == owner decisions on record
select (select count(*) from public.publication_policies where revoked_at is null) as active_policies,
       (select count(*) from public.release_decisions where revoked_at is null) as active_release_decisions,
       (select count(*) from public.content_releases where revoked_at is null and decision = 'APPROVED') as released_objects,
       (select count(*) from public.cast_roles where approved) as approved_cast_roles;
