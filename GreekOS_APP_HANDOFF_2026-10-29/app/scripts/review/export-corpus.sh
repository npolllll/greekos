#!/usr/bin/env bash
# GreekOS review — exports the CURRENT corpus (after all revisions) from production for the editorial
# review: course content only (items, lessons, texts, scenarios, Real Greek, ΠΕΓΠ, exams, audio jobs and
# the audio assets' QA data). No learner data, no accounts, no keys. Output: reports/review/corpus/*.json.gz
set -euo pipefail
: "${DATABASE_URL:?}"
OUT=reports/review/corpus
mkdir -p "$OUT"
q() { psql "$DATABASE_URL" -X -qAt -v ON_ERROR_STOP=1 -c "$2" | gzip -9 > "$OUT/$1.json.gz"; echo "$1: $(zcat "$OUT/$1.json.gz" | wc -c) bytes"; }
q items "select coalesce(json_agg(t order by t.item_id), '[]') from (select item_id, module, unit_id, item_type, level, section, requires_audio, scoring_strategy, audio_job_ids, current_hash, envelope from public.items) t"
q units "select coalesce(json_agg(t order by t.sort_key), '[]') from (select unit_id, level, sort_key, title_ru, prerequisites, primary_competencies, current_hash, teaching from public.units) t"
q objects "select coalesce(json_agg(t order by t.object_id), '[]') from (select object_id, payload, current_hash from public.content_objects) t"
q scenarios "select coalesce(json_agg(t order by t.scenario_id), '[]') from (select scenario_id, level, domain, objective_ru, current_hash, payload from public.speaking_scenarios) t"
q rg "select coalesce(json_agg(t order by t.expression_id), '[]') from (select expression_id, expression, current_hash, payload from public.rg_expressions) t"
q pegp "select coalesce(json_agg(t order by t.packet_id), '[]') from (select packet_id, topic_code, packet_kind, current_hash, payload from public.pegp_packets) t"
q exams "select json_build_object('forms', (select coalesce(json_agg(f order by f.form_id), '[]') from (select form_id, payload from public.exam_forms) f), 'components', (select coalesce(json_agg(c order by c.component_id), '[]') from (select component_id, form_id, component_kind, duration_minutes, item_ids, text_ids, payload from public.exam_components) c))"
q audio_jobs "select coalesce(json_agg(t order by t.audio_id), '[]') from (select audio_id, status, text_el, segments, payload from public.audio_jobs) t"
q audio_assets "select coalesce(json_agg(t order by t.audio_id), '[]') from (select id, audio_id, provider, model, voice_map, object_path, duration_ms, sample_rate, segment_cues, technical_status, technical_report, asr_roundtrip, digital_status, render_status, rights_status, cast_snapshot, cast_approved from public.audio_assets where invalidated_at is null) t"
q casting "select json_build_object('cast_roles', (select json_agg(c order by c.cast_role_id) from public.cast_roles c), 'job_casting', (select json_agg(j order by j.audio_id, j.speaker_role) from (select audio_id, speaker_role, cast_role_id, required_presentation, source, evidence, approved from public.audio_job_casting) j), 'voices', (select json_agg(v order by v.voice_id) from (select voice_id, provider, provider_voice_name, display_name, presentation, locale, available, distribution_allowed, approved_by_owner, qa_status from public.voice_catalog) v))"
q competencies "select coalesce(json_agg(t), '[]') from (select * from public.competencies) t"
