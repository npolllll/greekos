-- GreekOS ops — read-only: the FAIL and NEEDS_REVIEW objects of the latest completed full QA batch, with
-- their blocking checks. Content identifiers and check messages only; no personal data.
\pset footer off
\pset format unaligned
\pset fieldsep '|'
\echo == latest full batch
with b as (select * from public.qa_batches where scope->>'kind' = 'all' and status = 'COMPLETED' order by started_at desc limit 1)
select id, label, started_at, counts::text from b;
\echo == FAIL / NEEDS_REVIEW objects
with b as (select id from public.qa_batches where scope->>'kind' = 'all' and status = 'COMPLETED' order by started_at desc limit 1)
select r.verdict, r.content_kind, r.content_id, r.module, r.unit_id, r.blocking_count, r.warning_count
  from public.qa_item_results r join b on b.id = r.batch_id where r.verdict in ('FAIL', 'NEEDS_REVIEW') order by 1, 2, 3;
\echo == blocking issues of those objects
with b as (select id from public.qa_batches where scope->>'kind' = 'all' and status = 'COMPLETED' order by started_at desc limit 1)
select i.content_kind, i.content_id, i.check_id, i.field, left(i.message_ru, 220), left(i.evidence::text, 400), left(coalesce(i.suggestion, ''), 160)
  from public.qa_issues i join b on b.id = i.batch_id where i.severity = 'blocking' order by 1, 2, 3;
\echo == warnings of NEEDS_REVIEW objects
with b as (select id from public.qa_batches where scope->>'kind' = 'all' and status = 'COMPLETED' order by started_at desc limit 1)
select i.content_id, i.check_id, i.field, left(i.message_ru, 220), left(i.evidence::text, 300)
  from public.qa_issues i join b on b.id = i.batch_id
  join public.qa_item_results r on r.batch_id = i.batch_id and r.content_kind = i.content_kind and r.content_id = i.content_id
  where i.severity = 'warning' and r.verdict = 'NEEDS_REVIEW' order by 1, 2;
\echo == check catalog
with b as (select * from public.qa_batches where scope->>'kind' = 'all' and status = 'COMPLETED' order by started_at desc limit 1)
select left(checks_catalog::text, 3000) from b;
