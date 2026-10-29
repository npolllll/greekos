# Справочник схемы БД GreekOS (сгенерировано из чистой БД после 9 миграций и импорта, 2026-10-29 06:28)

Схема `public` (+ служебная `app_private`). RLS включён на всех таблицах `public`. Гранты: `anon` — нет ничего; `authenticated` — только SELECT на таблицы ученика (свои строки); запись — только `service_role` через серверные обработчики, `commit_learning_event` и голосовой шлюз.

## Таблицы

| Таблица | Строк в снимке (чистый импорт) | RLS | SELECT для authenticated | Комментарий |
|---|---|---|---|---|
| `activity_days` | 0 | да | да (политика) |  |
| `admin_audit_log` | 0 | да | — |  |
| `appeals` | 0 | да | да (политика) |  |
| `assessments` | 0 | да | да (политика) |  |
| `attempts` | 0 | да | да (политика) |  |
| `audio_assets` | 0 | да | — |  |
| `audio_job_casting` | 0 | да | — |  |
| `audio_job_render_status` | 0 | да | — |  |
| `audio_jobs` | 142 | да | — |  |
| `cast_roles` | 6 | да | — |  |
| `competencies` | 167 | да | — |  |
| `competency_state` | 0 | да | да (политика) |  |
| `consents` | 0 | да | да (политика) |  |
| `content_examples` | 0 | да | — |  |
| `content_objects` | 172 | да | — |  |
| `content_releases` | 0 | да | — |  |
| `content_revisions` | 5275 | да | — |  |
| `content_singletons` | 11 | да | — |  |
| `context_transfer_attempts` | 0 | да | да (политика) |  |
| `digital_qa_runs` | 0 | да | — |  |
| `enrollments` | 0 | да | да (политика) |  |
| `error_evidence` | 0 | да | да (политика) |  |
| `exam_attempts` | 0 | да | да (политика) |  |
| `exam_components` | 15 | да | — |  |
| `exam_forms` | 3 | да | — |  |
| `example_review_events` | 0 | да | — |  |
| `example_variants` | 0 | да | — |  |
| `feedback_events` | 0 | да | да (политика) |  |
| `idempotency_keys` | 0 | да | — |  |
| `import_quarantine` | 0 | да | — |  |
| `import_runs` | 1 | да | — |  |
| `invitations` | 0 | да | — |  |
| `item_audio` | 226 | да | — |  |
| `item_competencies` | 5243 | да | — |  |
| `item_sources` | 3254 | да | — |  |
| `items` | 1843 | да | — |  |
| `learner_events` | 0 | да | да (политика) |  |
| `learning_routes` | 0 | да | да (политика) |  |
| `lesson_sessions` | 0 | да | да (политика) |  |
| `mastery_events` | 0 | да | да (политика) |  |
| `media_rights` | 0 | да | — |  |
| `pegp_packets` | 8 | да | — |  |
| `placement_axis_results` | 0 | да | да (политика) |  |
| `placement_sessions` | 0 | да | да (политика) |  |
| `preferences` | 0 | да | да (политика) |  |
| `profiles` | 0 | да | да (политика) |  |
| `provider_usage` | 0 | да | — |  |
| `publication_policies` | 0 | да | — |  |
| `rg_expressions` | 12 | да | — |  |
| `role_assignments` | 0 | да | да (политика) |  |
| `route_changes` | 0 | да | — |  |
| `rubrics` | 91 | да | — |  |
| `source_claims` | 2676 | да | — |  |
| `spaced_reviews` | 0 | да | да (политика) |  |
| `speaking_scenarios` | 48 | да | — |  |
| `speaking_sessions` | 0 | да | да (политика) |  |
| `speaking_turn_metrics` | 0 | да | да (политика) |  |
| `speaking_turns` | 0 | да | да (политика) |  |
| `units` | 87 | да | — |  |
| `voice_artifacts` | 0 | да | да (политика) |  |
| `voice_catalog` | 0 | да | — |  |

## Колонки


### `activity_days`

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| `user_id` | uuid | нет |  |
| `local_date` | date | нет |  |
| `active_seconds` | integer | нет | 0 |
| `attempts` | integer | нет | 0 |
| `updated_at` | timestamp with time zone | нет | now() |

### `admin_audit_log`

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| `event_id` | bigint | нет |  |
| `actor_id` | uuid | да |  |
| `action` | text | нет |  |
| `target_id` | text | да |  |
| `target_user_id` | uuid | да |  |
| `meta` | jsonb | нет | '{}'::jsonb |
| `occurred_at` | timestamp with time zone | нет | now() |

### `appeals`

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| `id` | uuid | нет | gen_random_uuid() |
| `user_id` | uuid | нет |  |
| `assessment_id` | uuid | нет |  |
| `reason_ru` | text | нет |  |
| `status` | text | нет | 'OPEN'::text |
| `resolution_note` | text | да |  |
| `resolved_by` | uuid | да |  |
| `created_at` | timestamp with time zone | нет | now() |
| `resolved_at` | timestamp with time zone | да |  |

### `assessments`

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| `assessment_id` | uuid | нет | gen_random_uuid() |
| `attempt_id` | uuid | нет |  |
| `user_id` | uuid | нет |  |
| `verdict` | text | нет |  |
| `scorer` | text | нет |  |
| `reliable` | boolean | нет |  |
| `meaning_changing` | boolean | да |  |
| `error_kind` | text | да |  |
| `error_tags` | ARRAY | да |  |
| `rubric_id` | text | да |  |
| `rubric_hash` | text | да |  |
| `assessor_version` | text | нет |  |
| `dimensions` | jsonb | да |  |
| `evidence` | jsonb | нет | '[]'::jsonb |
| `uncertainty` | text | да |  |
| `feedback_ru` | text | да |  |
| `status` | text | нет | 'ACTIVE'::text |
| `supersedes_id` | uuid | да |  |
| `created_at` | timestamp with time zone | нет | now() |

### `attempts`

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| `attempt_id` | uuid | нет | gen_random_uuid() |
| `user_id` | uuid | нет |  |
| `item_id` | text | нет |  |
| `content_hash` | text | нет |  |
| `context` | text | нет |  |
| `context_ref` | text | да |  |
| `response_private` | jsonb | нет |  |
| `assistance` | text | нет | 'none'::text |
| `released_snapshot` | boolean | нет |  |
| `preview` | boolean | нет | false |
| `idempotency_key` | text | нет |  |
| `local_date` | date | нет |  |
| `timezone` | text | нет |  |
| `active_ms` | integer | да |  |
| `created_at` | timestamp with time zone | нет | now() |

### `audio_assets`

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| `id` | uuid | нет | gen_random_uuid() |
| `audio_id` | text | нет |  |
| `script_hash` | text | нет |  |
| `idempotency_key` | text | нет |  |
| `provider` | text | нет |  |
| `model` | text | да |  |
| `voice_map` | jsonb | нет |  |
| `locale` | text | нет | 'el-GR'::text |
| `object_path` | text | да |  |
| `mime_type` | text | да |  |
| `sha256` | text | да |  |
| `byte_length` | integer | да |  |
| `duration_ms` | integer | да |  |
| `sample_rate` | integer | да |  |
| `channels` | integer | да |  |
| `segment_cues` | jsonb | да |  |
| `technical_status` | text | нет | 'PENDING'::text |
| `technical_report` | jsonb | да |  |
| `asr_roundtrip` | jsonb | да |  |
| `digital_status` | text | нет | 'PENDING'::text |
| `rights_status` | text | нет | 'RIGHTS_PENDING'::text |
| `rights_evidence` | jsonb | да |  |
| `synthetic_disclosure` | boolean | нет | true |
| `invalidated_at` | timestamp with time zone | да |  |
| `invalidated_reason` | text | да |  |
| `created_by` | uuid | да |  |
| `created_at` | timestamp with time zone | нет | now() |
| `render_status` | text | нет | 'GENERATED'::text |
| `synthesis_version` | text | да |  |
| `voice_ids` | ARRAY | нет | '{}'::text[] |
| `cast_snapshot` | jsonb | да |  |
| `generation_params` | jsonb | да |  |
| `master_object_path` | text | да |  |
| `master_sha256` | text | да |  |
| `normalization` | jsonb | да |  |
| `cast_approved` | boolean | нет | false |
| `history` | jsonb | нет | '[]'::jsonb |

### `audio_job_casting`

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| `audio_id` | text | нет |  |
| `speaker_role` | text | нет |  |
| `cast_role_id` | text | да |  |
| `required_presentation` | text | да |  |
| `source` | text | нет |  |
| `evidence` | text | да |  |
| `approved` | boolean | нет | false |
| `approved_by` | uuid | да |  |
| `approved_at` | timestamp with time zone | да |  |
| `updated_at` | timestamp with time zone | нет | now() |

### `audio_job_render_status`

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| `audio_id` | text | нет |  |
| `status` | text | нет |  |
| `reason` | text | да |  |
| `last_asset_id` | uuid | да |  |
| `attempts` | integer | нет | 0 |
| `estimated_cost_usd` | numeric | нет | 0 |
| `updated_at` | timestamp with time zone | нет | now() |

### `audio_jobs`

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| `audio_id` | text | нет |  |
| `status` | text | нет |  |
| `priority` | text | да |  |
| `script_hash` | text | нет |  |
| `text_el` | text | да |  |
| `segments` | jsonb | нет | '[]'::jsonb |
| `payload` | jsonb | нет |  |
| `current_hash` | text | нет |  |
| `revision_id` | bigint | нет |  |

### `cast_roles`

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| `cast_role_id` | text | нет |  |
| `requested_presentation` | text | нет |  |
| `locale` | text | нет | 'el-GR'::text |
| `use_case` | text | нет |  |
| `target_speed` | text | нет | 'normal'::text |
| `voice_id` | text | да |  |
| `approved` | boolean | нет | false |
| `approved_by` | uuid | да |  |
| `approved_at` | timestamp with time zone | да |  |
| `status` | text | нет | 'unapproved'::text |

### `competencies`

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| `competency_id` | text | нет |  |
| `scope` | text | нет |  |
| `module` | text | да |  |
| `level` | text | да |  |
| `name` | text | да |  |
| `prerequisites` | ARRAY | нет | '{}'::text[] |
| `primary_unit_ids` | ARRAY | нет | '{}'::text[] |
| `definition` | jsonb | нет |  |
| `current_hash` | text | нет |  |
| `revision_id` | bigint | нет |  |

### `competency_state`

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| `user_id` | uuid | нет |  |
| `competency_id` | text | нет |  |
| `state` | text | нет |  |
| `summary` | jsonb | нет | '{}'::jsonb |
| `updated_at` | timestamp with time zone | нет | now() |

### `consents`

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| `consent_id` | uuid | нет | gen_random_uuid() |
| `user_id` | uuid | нет |  |
| `purpose` | text | нет |  |
| `artifact_id` | text | да |  |
| `reviewer_id` | uuid | да |  |
| `granted_at` | timestamp with time zone | нет | now() |
| `expires_at` | timestamp with time zone | да |  |
| `revoked_at` | timestamp with time zone | да |  |

### `content_examples`

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| `id` | text | нет |  |
| `competency_id` | text | да |  |
| `error_code` | text | да |  |
| `cefr_min` | text | да |  |
| `cefr_max` | text | да |  |
| `register` | text | да |  |
| `locale` | text | нет | 'el-GR'::text |
| `example_type` | text | нет |  |
| `approved_text_gr` | text | нет |  |
| `translation_ru` | text | да |  |
| `meaning_notes_ru` | text | да |  |
| `contrast_id` | text | да |  |
| `provenance_json` | jsonb | нет |  |
| `text_hash` | text | нет |  |
| `quality_status` | text | нет |  |
| `version` | text | нет |  |
| `created_at` | timestamp with time zone | нет | now() |
| `published_at` | timestamp with time zone | да |  |

### `content_objects`

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| `object_id` | text | нет |  |
| `refs` | jsonb | нет |  |
| `payload` | jsonb | нет |  |
| `current_hash` | text | нет |  |
| `revision_id` | bigint | нет |  |

### `content_releases`

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| `id` | uuid | нет | gen_random_uuid() |
| `content_kind` | text | нет |  |
| `content_id` | text | нет |  |
| `content_hash` | text | нет |  |
| `review_type` | text | нет |  |
| `reviewer_identity` | text | нет |  |
| `reviewer_user_id` | uuid | да |  |
| `method` | text | нет |  |
| `scope` | text | нет |  |
| `evidence_path` | text | да |  |
| `evidence_hash` | text | да |  |
| `decision` | text | нет |  |
| `reviewed_at` | timestamp with time zone | нет | now() |
| `rights_scope` | text | нет |  |
| `expires_at` | timestamp with time zone | да |  |
| `policy_id` | uuid | да |  |
| `revoked_at` | timestamp with time zone | да |  |
| `revoked_reason` | text | да |  |
| `created_at` | timestamp with time zone | нет | now() |

### `content_revisions`

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| `id` | bigint | нет |  |
| `content_kind` | text | нет |  |
| `content_id` | text | нет |  |
| `content_hash` | text | нет |  |
| `module` | text | да |  |
| `payload_private` | jsonb | нет |  |
| `import_run_id` | uuid | да |  |
| `created_at` | timestamp with time zone | нет | now() |

### `content_singletons`

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| `singleton_id` | text | нет |  |
| `payload` | jsonb | нет |  |
| `current_hash` | text | нет |  |
| `revision_id` | bigint | нет |  |

### `context_transfer_attempts`

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| `id` | uuid | нет | gen_random_uuid() |
| `user_id` | uuid | нет |  |
| `feedback_event_id` | uuid | нет |  |
| `attempt_id` | uuid | нет |  |
| `verdict` | text | нет |  |
| `evaluated_at` | timestamp with time zone | нет | now() |

### `digital_qa_runs`

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| `id` | uuid | нет | gen_random_uuid() |
| `content_kind` | text | нет |  |
| `content_id` | text | нет |  |
| `content_hash` | text | нет |  |
| `check_kind` | text | нет |  |
| `tool_id` | text | нет |  |
| `verdict` | text | нет |  |
| `report` | jsonb | нет |  |
| `run_by` | uuid | да |  |
| `created_at` | timestamp with time zone | нет | now() |

### `enrollments`

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| `user_id` | uuid | нет |  |
| `start_date` | date | да |  |
| `timezone` | text | нет |  |
| `target_months` | integer | нет | 9 |
| `end_date` | date | да |  |
| `exam_date` | date | да |  |
| `daily_minutes` | integer | нет | 60 |
| `days_per_week` | integer | нет | 6 |
| `updated_at` | timestamp with time zone | нет | now() |

### `error_evidence`

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| `id` | uuid | нет | gen_random_uuid() |
| `user_id` | uuid | нет |  |
| `attempt_id` | uuid | нет |  |
| `assessment_id` | uuid | да |  |
| `item_id` | text | нет |  |
| `competency_id` | text | да |  |
| `verdict` | text | нет |  |
| `error_kind` | text | да |  |
| `error_tag` | text | да |  |
| `meaning_changing` | boolean | да |  |
| `evidence` | jsonb | нет |  |
| `uncertainty` | text | да |  |
| `correction_el` | text | да |  |
| `status` | text | нет | 'open'::text |
| `created_at` | timestamp with time zone | нет | now() |

### `exam_attempts`

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| `id` | uuid | нет | gen_random_uuid() |
| `user_id` | uuid | нет |  |
| `component_id` | text | нет |  |
| `component_hash` | text | нет |  |
| `mode` | text | нет |  |
| `status` | text | нет | 'IN_PROGRESS'::text |
| `server_started_at` | timestamp with time zone | нет | now() |
| `server_expires_at` | timestamp with time zone | да |  |
| `answers_private` | jsonb | нет | '{}'::jsonb |
| `autosave_seq` | integer | нет | 0 |
| `submitted_at` | timestamp with time zone | да |  |
| `results` | jsonb | да |  |
| `idempotency_key` | text | нет |  |
| `audio_plays` | jsonb | нет | '{}'::jsonb |

### `exam_components`

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| `component_id` | text | нет |  |
| `form_id` | text | нет |  |
| `logical_id` | text | да |  |
| `component_kind` | text | нет |  |
| `duration_minutes` | integer | да |  |
| `item_ids` | ARRAY | нет | '{}'::text[] |
| `text_ids` | ARRAY | нет | '{}'::text[] |
| `payload` | jsonb | нет |  |
| `current_hash` | text | нет |  |
| `revision_id` | bigint | нет |  |

### `exam_forms`

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| `form_id` | text | нет |  |
| `payload` | jsonb | нет |  |
| `current_hash` | text | нет |  |
| `revision_id` | bigint | нет |  |

### `example_review_events`

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| `id` | bigint | нет |  |
| `example_id` | text | нет |  |
| `tool_id` | text | нет |  |
| `verdict` | text | нет |  |
| `checked_hash` | text | нет |  |
| `evidence_ref` | text | да |  |
| `checked_at` | timestamp with time zone | нет | now() |

### `example_variants`

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| `id` | bigint | нет |  |
| `example_id` | text | нет |  |
| `role` | text | да |  |
| `speech_text_gr` | text | нет |  |
| `localized_text_ru` | text | да |  |
| `pragmatic_intent` | text | да |  |
| `voice_profile_id` | text | да |  |
| `seq` | integer | нет |  |
| `timing_hint` | text | да |  |

### `feedback_events`

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| `id` | uuid | нет | gen_random_uuid() |
| `user_id` | uuid | нет |  |
| `attempt_id` | uuid | нет |  |
| `competency_id` | text | да |  |
| `error_code` | text | да |  |
| `verdict` | text | нет |  |
| `explanation_version` | text | нет |  |
| `example_refs` | jsonb | нет | '[]'::jsonb |
| `captured_at` | timestamp with time zone | нет | now() |

### `idempotency_keys`

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| `user_id` | uuid | нет |  |
| `key` | text | нет |  |
| `scope` | text | нет |  |
| `result` | jsonb | да |  |
| `created_at` | timestamp with time zone | нет | now() |

### `import_quarantine`

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| `id` | bigint | нет |  |
| `import_run_id` | uuid | нет |  |
| `content_kind` | text | нет |  |
| `content_id` | text | да |  |
| `json_path` | text | да |  |
| `reason` | text | нет |  |
| `created_at` | timestamp with time zone | нет | now() |

### `import_runs`

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| `id` | uuid | нет | gen_random_uuid() |
| `started_at` | timestamp with time zone | нет | now() |
| `finished_at` | timestamp with time zone | да |  |
| `status` | text | нет |  |
| `tool_version` | text | нет |  |
| `corpus_label` | text | да |  |
| `input_hashes` | jsonb | нет | '{}'::jsonb |
| `counts` | jsonb | нет | '{}'::jsonb |
| `report` | jsonb | нет | '{}'::jsonb |

### `invitations`

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| `id` | uuid | нет | gen_random_uuid() |
| `email` | text | нет |  |
| `display_name` | text | нет |  |
| `entry_path` | text | нет |  |
| `invited_by` | uuid | да |  |
| `invited_user_id` | uuid | да |  |
| `status` | text | нет | 'SENT'::text |
| `created_at` | timestamp with time zone | нет | now() |
| `accepted_at` | timestamp with time zone | да |  |

### `item_audio`

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| `item_id` | text | нет |  |
| `audio_id` | text | нет |  |

### `item_competencies`

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| `item_id` | text | нет |  |
| `competency_id` | text | нет |  |
| `relation` | text | нет |  |

### `item_sources`

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| `item_id` | text | нет |  |
| `claim_id` | text | нет |  |

### `items`

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| `item_id` | text | нет |  |
| `module` | text | нет |  |
| `unit_id` | text | да |  |
| `item_type` | text | нет |  |
| `level` | text | да |  |
| `pool` | text | да |  |
| `section` | text | да |  |
| `requires_audio` | boolean | нет |  |
| `scoring_strategy` | text | нет |  |
| `competency_ids` | ARRAY | нет | '{}'::text[] |
| `prerequisite_ids` | ARRAY | нет | '{}'::text[] |
| `audio_job_ids` | ARRAY | нет | '{}'::text[] |
| `error_tags` | ARRAY | да |  |
| `envelope` | jsonb | нет |  |
| `current_hash` | text | нет |  |
| `revision_id` | bigint | нет |  |

### `learner_events`

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| `id` | bigint | нет |  |
| `user_id` | uuid | нет |  |
| `event_type` | text | нет |  |
| `idempotency_key` | text | нет |  |
| `source_version` | text | да |  |
| `payload` | jsonb | нет | '{}'::jsonb |
| `occurred_at` | timestamp with time zone | нет | now() |

### `learning_routes`

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| `user_id` | uuid | нет |  |
| `route_kind` | text | нет |  |
| `start_unit_id` | text | да |  |
| `skill_profile` | jsonb | нет | '{}'::jsonb |
| `reason` | text | нет |  |
| `set_by` | uuid | да |  |
| `set_at` | timestamp with time zone | нет | now() |

### `lesson_sessions`

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| `id` | uuid | нет | gen_random_uuid() |
| `user_id` | uuid | нет |  |
| `unit_id` | text | нет |  |
| `unit_hash` | text | нет |  |
| `preview` | boolean | нет | false |
| `status` | text | нет | 'IN_PROGRESS'::text |
| `current_step` | text | да |  |
| `started_at` | timestamp with time zone | нет | now() |
| `completed_at` | timestamp with time zone | да |  |

### `mastery_events`

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| `event_id` | uuid | нет | gen_random_uuid() |
| `user_id` | uuid | нет |  |
| `competency_id` | text | нет |  |
| `attempt_id` | uuid | да |  |
| `item_id` | text | да |  |
| `event_type` | text | нет |  |
| `task_kind` | text | да |  |
| `reliable` | boolean | нет |  |
| `meaning_changing` | boolean | да |  |
| `review_interval_days` | integer | да |  |
| `supersedes_id` | uuid | да |  |
| `local_date` | date | нет |  |
| `created_at` | timestamp with time zone | нет | now() |

### `media_rights`

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| `id` | bigint | нет |  |
| `example_id` | text | нет |  |
| `source_url` | text | да |  |
| `owner` | text | да |  |
| `license_basis` | text | да |  |
| `embed_policy` | text | да |  |
| `excerpt_policy` | text | да |  |
| `reviewed_on` | date | да |  |
| `valid_until` | date | да |  |
| `status` | text | нет |  |

### `pegp_packets`

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| `packet_id` | text | нет |  |
| `topic_code` | text | да |  |
| `packet_kind` | text | нет |  |
| `payload` | jsonb | нет |  |
| `current_hash` | text | нет |  |
| `revision_id` | bigint | нет |  |

### `placement_axis_results`

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| `session_id` | uuid | нет |  |
| `user_id` | uuid | нет |  |
| `axis` | text | нет |  |
| `status` | text | нет |  |
| `observations` | jsonb | нет | '[]'::jsonb |
| `candidate_start` | text | да |  |
| `confidence` | text | да |  |
| `not_observed_reason` | text | да |  |
| `updated_at` | timestamp with time zone | нет | now() |

### `placement_sessions`

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| `id` | uuid | нет | gen_random_uuid() |
| `user_id` | uuid | нет |  |
| `entry_path` | text | нет |  |
| `protocol_hash` | text | нет |  |
| `status` | text | нет | 'IN_PROGRESS'::text |
| `state` | jsonb | нет | '{}'::jsonb |
| `result` | jsonb | да |  |
| `started_at` | timestamp with time zone | нет | now() |
| `completed_at` | timestamp with time zone | да |  |

### `preferences`

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| `user_id` | uuid | нет |  |
| `reduced_motion` | boolean | нет | false |
| `relevance` | jsonb | нет | '{}'::jsonb |
| `speaking_rate` | text | нет | 'normal'::text |
| `updated_at` | timestamp with time zone | нет | now() |

### `profiles`

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| `user_id` | uuid | нет |  |
| `display_name` | text | нет |  |
| `email` | text | да |  |
| `timezone` | text | нет | 'Europe/Athens'::text |
| `active` | boolean | нет | true |
| `entry_path` | text | да |  |
| `lifecycle_state` | text | нет | 'invited'::text |
| `invited_at` | timestamp with time zone | да |  |
| `activated_at` | timestamp with time zone | да |  |
| `deactivated_at` | timestamp with time zone | да |  |
| `created_at` | timestamp with time zone | нет | now() |

### `provider_usage`

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| `id` | bigint | нет |  |
| `user_id` | uuid | да |  |
| `provider` | text | нет |  |
| `operation` | text | нет |  |
| `units` | numeric | нет | 0 |
| `unit_kind` | text | нет |  |
| `estimated_cost_usd` | numeric | нет | 0 |
| `ok` | boolean | нет |  |
| `latency_ms` | integer | да |  |
| `created_at` | timestamp with time zone | нет | now() |

### `publication_policies`

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| `id` | uuid | нет | gen_random_uuid() |
| `kind` | text | нет |  |
| `version` | text | нет |  |
| `statement_ru` | text | нет |  |
| `risks_acknowledged` | jsonb | нет |  |
| `signed_by` | uuid | нет |  |
| `signed_at` | timestamp with time zone | нет | now() |
| `revoked_at` | timestamp with time zone | да |  |
| `revoked_by` | uuid | да |  |

### `rg_expressions`

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| `expression_id` | text | нет |  |
| `expression` | text | нет |  |
| `payload` | jsonb | нет |  |
| `current_hash` | text | нет |  |
| `revision_id` | bigint | нет |  |

### `role_assignments`

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| `user_id` | uuid | нет |  |
| `role` | text | нет |  |
| `granted_by` | uuid | да |  |
| `granted_at` | timestamp with time zone | нет | now() |

### `route_changes`

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| `id` | bigint | нет |  |
| `user_id` | uuid | нет |  |
| `previous` | jsonb | да |  |
| `next` | jsonb | нет |  |
| `reason` | text | нет |  |
| `changed_by` | uuid | да |  |
| `changed_at` | timestamp with time zone | нет | now() |

### `rubrics`

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| `rubric_id` | text | нет |  |
| `refs` | jsonb | нет |  |
| `payload` | jsonb | нет |  |
| `current_hash` | text | нет |  |
| `revision_id` | bigint | нет |  |

### `source_claims`

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| `claim_id` | text | нет |  |
| `source_id` | text | да |  |
| `status` | text | да |  |
| `record` | jsonb | нет |  |
| `evidence_path` | text | да |  |
| `evidence_file_sha256` | text | да |  |
| `current_hash` | text | нет |  |
| `revision_id` | bigint | нет |  |

### `spaced_reviews`

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| `id` | uuid | нет | gen_random_uuid() |
| `user_id` | uuid | нет |  |
| `competency_id` | text | нет |  |
| `anchor_attempt_id` | uuid | нет |  |
| `anchor_item_id` | text | нет |  |
| `anchor_local_date` | date | нет |  |
| `interval_days` | integer | нет |  |
| `due_local_date` | date | нет |  |
| `status` | text | нет | 'due'::text |
| `completed_attempt_id` | uuid | да |  |
| `completed_local_date` | date | да |  |
| `content_hash` | text | да |  |
| `created_at` | timestamp with time zone | нет | now() |

### `speaking_scenarios`

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| `scenario_id` | text | нет |  |
| `level` | text | да |  |
| `domain` | text | да |  |
| `objective_ru` | text | да |  |
| `competency_ids` | ARRAY | нет | '{}'::text[] |
| `payload` | jsonb | нет |  |
| `current_hash` | text | нет |  |
| `revision_id` | bigint | нет |  |

### `speaking_sessions`

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| `session_id` | uuid | нет | gen_random_uuid() |
| `user_id` | uuid | нет |  |
| `scenario_id` | text | нет |  |
| `scenario_hash` | text | нет |  |
| `mode` | text | нет |  |
| `input_mode` | text | нет |  |
| `status` | text | нет | 'ACTIVE'::text |
| `current_node` | text | да |  |
| `repair_loops` | integer | нет | 0 |
| `consent_id` | uuid | да |  |
| `provider_snapshot` | jsonb | нет |  |
| `preview` | boolean | нет | false |
| `summary_private` | jsonb | да |  |
| `started_at` | timestamp with time zone | нет | now() |
| `ended_at` | timestamp with time zone | да |  |
| `local_date` | date | нет |  |
| `voice_persona` | text | да |  |
| `transport` | text | нет | 'batch'::text |

### `speaking_turn_metrics`

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| `id` | bigint | нет |  |
| `session_id` | uuid | нет |  |
| `user_id` | uuid | нет |  |
| `turn_seq` | integer | нет |  |
| `transport` | text | нет |  |
| `asr_engine` | text | да |  |
| `tts_engine` | text | да |  |
| `dialogue_engine` | text | да |  |
| `speech_ms` | integer | да |  |
| `vad_hangover_ms` | integer | да |  |
| `asr_partial_first_ms` | integer | да |  |
| `asr_final_ms` | integer | да |  |
| `llm_first_token_ms` | integer | да |  |
| `tts_first_audio_ms` | integer | да |  |
| `playback_start_ms` | integer | да |  |
| `end_of_speech_to_audio_ms` | integer | да |  |
| `interrupted` | boolean | нет | false |
| `heard_ms` | integer | да |  |
| `input_source` | text | нет | 'microphone'::text |
| `created_at` | timestamp with time zone | нет | now() |
| `listen_ready_ms` | integer | да |  |

### `speaking_turns`

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| `turn_id` | uuid | нет | gen_random_uuid() |
| `session_id` | uuid | нет |  |
| `user_id` | uuid | нет |  |
| `seq` | integer | нет |  |
| `speaker` | text | нет |  |
| `node_id` | text | да |  |
| `text_el` | text | да |  |
| `asr_text` | text | да |  |
| `asr_confidence` | real | да |  |
| `asr_provider` | text | да |  |
| `transcript_confirmed` | boolean | нет | false |
| `interrupted` | boolean | нет | false |
| `playback_completed` | boolean | да |  |
| `intent` | text | да |  |
| `language_segments` | jsonb | да |  |
| `help_used` | jsonb | нет | '[]'::jsonb |
| `audio_artifact_id` | uuid | да |  |
| `idempotency_key` | text | нет |  |
| `created_at` | timestamp with time zone | нет | now() |
| `heard_text` | text | да |  |
| `heard_ms` | integer | да |  |

### `units`

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| `unit_id` | text | нет |  |
| `level` | text | нет |  |
| `sort_key` | integer | нет |  |
| `title_ru` | text | нет |  |
| `prerequisites` | ARRAY | нет | '{}'::text[] |
| `soft_prerequisites` | ARRAY | нет | '{}'::text[] |
| `competency_ids` | ARRAY | нет | '{}'::text[] |
| `primary_competencies` | ARRAY | нет | '{}'::text[] |
| `estimated_active_minutes` | integer | да |  |
| `teaching` | jsonb | нет |  |
| `current_hash` | text | нет |  |
| `revision_id` | bigint | нет |  |

### `voice_artifacts`

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| `id` | uuid | нет | gen_random_uuid() |
| `user_id` | uuid | нет |  |
| `session_id` | uuid | да |  |
| `consent_id` | uuid | нет |  |
| `object_path` | text | нет |  |
| `retention_until` | timestamp with time zone | нет |  |
| `deleted_at` | timestamp with time zone | да |  |
| `created_at` | timestamp with time zone | нет | now() |

### `voice_catalog`

| Колонка | Тип | NULL | По умолчанию |
|---|---|---|---|
| `voice_id` | text | нет |  |
| `provider` | text | нет |  |
| `provider_voice_name` | text | нет |  |
| `display_name` | text | нет |  |
| `locale` | text | нет | 'el-GR'::text |
| `presentation` | text | нет |  |
| `presentation_source` | text | нет |  |
| `quality_tier` | text | да |  |
| `engine_kind` | text | нет |  |
| `available` | boolean | нет | false |
| `streaming_capable` | boolean | нет | false |
| `speed_profile` | jsonb | нет | '{"fast": 1.1, "slow": 0.88, "normal": 1.0}'::jsonb |
| `style_support` | jsonb | нет | '[]'::jsonb |
| `version` | text | да |  |
| `rights` | jsonb | нет | '{}'::jsonb |
| `distribution_allowed` | boolean | нет | false |
| `sample_object_path` | text | да |  |
| `sample_sha256` | text | да |  |
| `approved_by_owner` | boolean | нет | false |
| `approved_by` | uuid | да |  |
| `approved_at` | timestamp with time zone | да |  |
| `qa_status` | text | нет | 'NOT_TESTED'::text |
| `last_synced_at` | timestamp with time zone | да |  |
| `notes` | text | да |  |

## Ограничения CHECK / UNIQUE / FK

| Таблица | Ограничение | Определение |
|---|---|---|
| `activity_days` | `activity_days_active_seconds_check` | CHECK ((active_seconds >= 0)) |
| `activity_days` | `activity_days_user_id_fkey` | FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE |
| `appeals` | `appeals_assessment_id_fkey` | FOREIGN KEY (assessment_id) REFERENCES assessments(assessment_id) ON DELETE CASCADE |
| `appeals` | `appeals_assessment_id_key` | UNIQUE (assessment_id) |
| `appeals` | `appeals_reason_ru_check` | CHECK (((char_length(reason_ru) >= 3) AND (char_length(reason_ru) <= 2000))) |
| `appeals` | `appeals_resolved_by_fkey` | FOREIGN KEY (resolved_by) REFERENCES auth.users(id) ON DELETE SET NULL |
| `appeals` | `appeals_status_check` | CHECK ((status = ANY (ARRAY['OPEN'::text, 'UPHELD'::text, 'REJECTED'::text]))) |
| `appeals` | `appeals_user_id_fkey` | FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE |
| `assessments` | `assessments_attempt_id_fkey` | FOREIGN KEY (attempt_id) REFERENCES attempts(attempt_id) ON DELETE CASCADE |
| `assessments` | `assessments_scorer_check` | CHECK ((scorer = ANY (ARRAY['key'::text, 'structured'::text, 'joint_bank'::text, 'ai_assessor'::text, 'human'::text, 'none'::text]))) |
| `assessments` | `assessments_status_check` | CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'SUPERSEDED'::text, 'UNDER_APPEAL'::text]))) |
| `assessments` | `assessments_supersedes_id_fkey` | FOREIGN KEY (supersedes_id) REFERENCES assessments(assessment_id) |
| `assessments` | `assessments_user_id_fkey` | FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE |
| `assessments` | `assessments_verdict_check` | CHECK ((verdict = ANY (ARRAY['CORRECT'::text, 'ACCEPTABLE_VARIANT'::text, 'INCORRECT_CONFIRMED'::text, 'AMBIGUOUS'::text, 'ASR_UNCERTAIN'::text, 'UNSUPPORTED'::text, 'PENDING_REVIEW'::text, 'ABSTAIN'::text, 'NOT_ASSESSED'::text]))) |
| `attempts` | `attempts_active_ms_check` | CHECK (((active_ms IS NULL) OR (active_ms >= 0))) |
| `attempts` | `attempts_assistance_check` | CHECK ((assistance = ANY (ARRAY['none'::text, 'hint'::text, 'model_shown'::text, 'retry_after_model'::text, 'translation'::text, 'tutor_help'::text]))) |
| `attempts` | `attempts_context_check` | CHECK ((context = ANY (ARRAY['lesson'::text, 'review'::text, 'diagnostic'::text, 'exam'::text, 'transfer'::text, 'preview'::text, 'speaking'::text, 'pegp'::text, 'real_greek'::text, 'writing'::text, 'corrective'::text]))) |
| `attempts` | `attempts_item_id_fkey` | FOREIGN KEY (item_id) REFERENCES items(item_id) |
| `attempts` | `attempts_user_id_fkey` | FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE |
| `attempts` | `attempts_user_id_idempotency_key_key` | UNIQUE (user_id, idempotency_key) |
| `audio_assets` | `audio_assets_audio_id_fkey` | FOREIGN KEY (audio_id) REFERENCES audio_jobs(audio_id) |
| `audio_assets` | `audio_assets_created_by_fkey` | FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL |
| `audio_assets` | `audio_assets_digital_status_check` | CHECK ((digital_status = ANY (ARRAY['PENDING'::text, 'AUDIO_VERIFIED_DIGITAL'::text, 'NEEDS_REVIEW'::text, 'BLOCKED'::text]))) |
| `audio_assets` | `audio_assets_idempotency_key_key` | UNIQUE (idempotency_key) |
| `audio_assets` | `audio_assets_mock_never_verified` | CHECK (((provider <> 'mock'::text) OR ((digital_status <> 'AUDIO_VERIFIED_DIGITAL'::text) AND (rights_status = 'RIGHTS_PENDING'::text) AND (render_status <> ALL (ARRAY['DIGITAL_REVIEWED'::text, 'RELEASE_ELIGIBLE'::text]))))) |
| `audio_assets` | `audio_assets_release_eligible_requirements` | CHECK (((render_status <> 'RELEASE_ELIGIBLE'::text) OR (cast_approved AND (rights_status = 'PROVIDER_TERMS_RECORDED'::text) AND (digital_status = 'AUDIO_VERIFIED_DIGITAL'::text)))) |
| `audio_assets` | `audio_assets_render_status_check` | CHECK ((render_status = ANY (ARRAY['AUDIO_PENDING'::text, 'GENERATED'::text, 'TECH_QA_PASS'::text, 'TECH_QA_FAIL'::text, 'LINGUISTIC_QA_PENDING'::text, 'DIGITAL_REVIEWED'::text, 'RELEASE_ELIGIBLE'::text, 'BLOCKED'::text]))) |
| `audio_assets` | `audio_assets_rights_status_check` | CHECK ((rights_status = ANY (ARRAY['RIGHTS_PENDING'::text, 'PROVIDER_TERMS_RECORDED'::text, 'DEV_LOCAL_ONLY'::text, 'BLOCKED'::text]))) |
| `audio_assets` | `audio_assets_synthetic_disclosure_check` | CHECK (synthetic_disclosure) |
| `audio_assets` | `audio_assets_technical_status_check` | CHECK ((technical_status = ANY (ARRAY['PENDING'::text, 'TECHNICAL_PASS'::text, 'TECHNICAL_FAIL'::text]))) |
| `audio_job_casting` | `audio_job_casting_approved_by_fkey` | FOREIGN KEY (approved_by) REFERENCES auth.users(id) ON DELETE SET NULL |
| `audio_job_casting` | `audio_job_casting_audio_id_fkey` | FOREIGN KEY (audio_id) REFERENCES audio_jobs(audio_id) ON DELETE CASCADE |
| `audio_job_casting` | `audio_job_casting_cast_role_id_fkey` | FOREIGN KEY (cast_role_id) REFERENCES cast_roles(cast_role_id) |
| `audio_job_casting` | `audio_job_casting_required_presentation_check` | CHECK ((required_presentation = ANY (ARRAY['female'::text, 'male'::text, 'any'::text]))) |
| `audio_job_casting` | `audio_job_casting_source_check` | CHECK ((source = ANY (ARRAY['owner'::text, 'grammatical_gender_proposal'::text, 'self_reference_proposal'::text, 'narrator_default_proposal'::text, 'needs_casting'::text]))) |
| `audio_job_render_status` | `audio_job_render_status_audio_id_fkey` | FOREIGN KEY (audio_id) REFERENCES audio_jobs(audio_id) ON DELETE CASCADE |
| `audio_job_render_status` | `audio_job_render_status_last_asset_id_fkey` | FOREIGN KEY (last_asset_id) REFERENCES audio_assets(id) ON DELETE SET NULL |
| `audio_job_render_status` | `audio_job_render_status_status_check` | CHECK ((status = ANY (ARRAY['AUDIO_PENDING'::text, 'BLOCKED_MISSING_VOICE_METADATA'::text, 'BLOCKED_NO_SUITABLE_VOICE'::text, 'BLOCKED_BUDGET'::text, 'RENDER_FAILED'::text, 'GENERATED'::text, 'TECH_QA_PASS'::text, 'TECH_QA_FAIL'::text, 'DIGITAL_REVIEWED'::text, 'RELEASE_ELIGIBLE'::text]))) |
| `audio_jobs` | `audio_jobs_revision_id_fkey` | FOREIGN KEY (revision_id) REFERENCES content_revisions(id) |
| `cast_roles` | `cast_roles_approved_by_fkey` | FOREIGN KEY (approved_by) REFERENCES auth.users(id) ON DELETE SET NULL |
| `cast_roles` | `cast_roles_requested_presentation_check` | CHECK ((requested_presentation = ANY (ARRAY['female'::text, 'male'::text, 'any'::text]))) |
| `cast_roles` | `cast_roles_voice_id_fkey` | FOREIGN KEY (voice_id) REFERENCES voice_catalog(voice_id) ON DELETE SET NULL |
| `competencies` | `competencies_revision_id_fkey` | FOREIGN KEY (revision_id) REFERENCES content_revisions(id) |
| `competencies` | `competencies_scope_check` | CHECK ((scope = ANY (ARRAY['core'::text, 'external'::text]))) |
| `competency_state` | `competency_state_competency_id_fkey` | FOREIGN KEY (competency_id) REFERENCES competencies(competency_id) |
| `competency_state` | `competency_state_state_check` | CHECK ((state = ANY (ARRAY['unseen'::text, 'familiar'::text, 'recognition'::text, 'controlled'::text, 'spontaneous'::text, 'retention_due'::text, 'retained'::text, 'transfer_confirmed'::text, 'needs_review'::text, 'insufficient_evidence'::text]))) |
| `competency_state` | `competency_state_user_id_fkey` | FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE |
| `consents` | `consents_check` | CHECK (((purpose <> 'voice_review_retention'::text) OR ((expires_at IS NOT NULL) AND (expires_at <= (granted_at + '30 days'::interval))))) |
| `consents` | `consents_purpose_check` | CHECK ((purpose = ANY (ARRAY['voice_review_retention'::text, 'owner_transcript_access'::text, 'admin_learning_analytics_notice'::text]))) |
| `consents` | `consents_reviewer_id_fkey` | FOREIGN KEY (reviewer_id) REFERENCES auth.users(id) ON DELETE SET NULL |
| `consents` | `consents_user_id_fkey` | FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE |
| `content_examples` | `content_examples_competency_id_fkey` | FOREIGN KEY (competency_id) REFERENCES competencies(competency_id) |
| `content_examples` | `content_examples_example_type_check` | CHECK ((example_type = ANY (ARRAY['situation'::text, 'dialogue'::text, 'pronunciation'::text, 'media'::text]))) |
| `content_examples` | `content_examples_quality_status_check` | CHECK ((quality_status = ANY (ARRAY['DRAFT'::text, 'NEEDS_SOURCE'::text, 'DIGITAL_LINGUISTIC_QA'::text, 'HUMAN_VERIFIED'::text, 'BLOCKED'::text]))) |
| `content_objects` | `content_objects_revision_id_fkey` | FOREIGN KEY (revision_id) REFERENCES content_revisions(id) |
| `content_releases` | `content_releases_check` | CHECK (((review_type = 'SYNTHETIC_TEST_FIXTURE'::text) = (content_id ~~ 'SYN-%'::text))) |
| `content_releases` | `content_releases_check1` | CHECK (((review_type <> 'OWNER_DIGITAL_POLICY'::text) OR (policy_id IS NOT NULL))) |
| `content_releases` | `content_releases_check2` | CHECK (((review_type !~~ 'HUMAN_%'::text) OR ((evidence_path IS NOT NULL) AND (evidence_hash IS NOT NULL)))) |
| `content_releases` | `content_releases_content_kind_check` | CHECK ((content_kind = ANY (ARRAY['item'::text, 'unit'::text, 'scenario'::text, 'audio_asset'::text, 'exam_component'::text, 'rg_expression'::text, 'pegp_packet'::text, 'context_example'::text]))) |
| `content_releases` | `content_releases_decision_check` | CHECK ((decision = ANY (ARRAY['APPROVED'::text, 'REJECTED'::text]))) |
| `content_releases` | `content_releases_policy_id_fkey` | FOREIGN KEY (policy_id) REFERENCES publication_policies(id) |
| `content_releases` | `content_releases_review_type_check` | CHECK ((review_type = ANY (ARRAY['HUMAN_TEACHER_REVIEW'::text, 'HUMAN_EXAMINER_REVIEW'::text, 'OWNER_DIGITAL_POLICY'::text, 'SYNTHETIC_TEST_FIXTURE'::text]))) |
| `content_releases` | `content_releases_reviewer_user_id_fkey` | FOREIGN KEY (reviewer_user_id) REFERENCES auth.users(id) ON DELETE SET NULL |
| `content_releases` | `content_releases_scope_check` | CHECK ((scope = ANY (ARRAY['learner_practice'::text, 'diagnostic'::text, 'exam_practice'::text, 'pegp_session'::text, 'real_greek'::text, 'audio_playback'::text]))) |
| `content_revisions` | `content_revisions_content_hash_check` | CHECK ((content_hash ~ '^[0-9a-f]{64}$'::text)) |
| `content_revisions` | `content_revisions_content_kind_check` | CHECK ((content_kind = ANY (ARRAY['item'::text, 'unit'::text, 'competency'::text, 'source_claim'::text, 'rubric'::text, 'object'::text, 'audio_job'::text, 'scenario'::text, 'exam_form'::text, 'exam_component'::text, 'rg_expression'::text, 'pegp_packet'::text, 'pegp_catalog'::text, 'singleton'::text, 'context_example'::text]))) |
| `content_revisions` | `content_revisions_content_kind_content_id_content_hash_key` | UNIQUE (content_kind, content_id, content_hash) |
| `content_revisions` | `content_revisions_import_run_id_fkey` | FOREIGN KEY (import_run_id) REFERENCES import_runs(id) |
| `content_singletons` | `content_singletons_revision_id_fkey` | FOREIGN KEY (revision_id) REFERENCES content_revisions(id) |
| `context_transfer_attempts` | `context_transfer_attempts_attempt_id_fkey` | FOREIGN KEY (attempt_id) REFERENCES attempts(attempt_id) ON DELETE CASCADE |
| `context_transfer_attempts` | `context_transfer_attempts_feedback_event_id_fkey` | FOREIGN KEY (feedback_event_id) REFERENCES feedback_events(id) ON DELETE CASCADE |
| `context_transfer_attempts` | `context_transfer_attempts_user_id_fkey` | FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE |
| `digital_qa_runs` | `digital_qa_runs_check_kind_check` | CHECK ((check_kind = ANY (ARRAY['STRUCTURAL'::text, 'DIGITAL_LINGUISTIC_QA'::text, 'DIGITAL_AUDIO_QA'::text, 'AUTO_SOURCE_CHECKED'::text]))) |
| `digital_qa_runs` | `digital_qa_runs_run_by_fkey` | FOREIGN KEY (run_by) REFERENCES auth.users(id) ON DELETE SET NULL |
| `digital_qa_runs` | `digital_qa_runs_verdict_check` | CHECK ((verdict = ANY (ARRAY['PASS'::text, 'NEEDS_REVIEW'::text, 'FAIL'::text, 'ABSTAIN'::text]))) |
| `enrollments` | `enrollments_daily_minutes_check` | CHECK (((daily_minutes >= 10) AND (daily_minutes <= 480))) |
| `enrollments` | `enrollments_days_per_week_check` | CHECK (((days_per_week >= 1) AND (days_per_week <= 7))) |
| `enrollments` | `enrollments_target_months_check` | CHECK ((target_months = 9)) |
| `enrollments` | `enrollments_user_id_fkey` | FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE |
| `error_evidence` | `error_evidence_assessment_id_fkey` | FOREIGN KEY (assessment_id) REFERENCES assessments(assessment_id) ON DELETE CASCADE |
| `error_evidence` | `error_evidence_attempt_id_fkey` | FOREIGN KEY (attempt_id) REFERENCES attempts(attempt_id) ON DELETE CASCADE |
| `error_evidence` | `error_evidence_competency_id_fkey` | FOREIGN KEY (competency_id) REFERENCES competencies(competency_id) |
| `error_evidence` | `error_evidence_status_check` | CHECK ((status = ANY (ARRAY['open'::text, 'practised'::text, 'resolved'::text, 'appealed'::text, 'withdrawn'::text]))) |
| `error_evidence` | `error_evidence_user_id_fkey` | FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE |
| `exam_attempts` | `exam_attempts_audio_plays_object` | CHECK ((jsonb_typeof(audio_plays) = 'object'::text)) |
| `exam_attempts` | `exam_attempts_component_id_fkey` | FOREIGN KEY (component_id) REFERENCES exam_components(component_id) |
| `exam_attempts` | `exam_attempts_mode_check` | CHECK ((mode = ANY (ARRAY['simulation'::text, 'practice'::text]))) |
| `exam_attempts` | `exam_attempts_status_check` | CHECK ((status = ANY (ARRAY['IN_PROGRESS'::text, 'SUBMITTED'::text, 'EXPIRED'::text, 'ABANDONED'::text]))) |
| `exam_attempts` | `exam_attempts_user_id_fkey` | FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE |
| `exam_attempts` | `exam_attempts_user_id_idempotency_key_key` | UNIQUE (user_id, idempotency_key) |
| `exam_components` | `exam_components_component_kind_check` | CHECK ((component_kind = ANY (ARRAY['reading'::text, 'use_of_language'::text, 'listening'::text, 'writing'::text, 'speaking'::text]))) |
| `exam_components` | `exam_components_form_id_fkey` | FOREIGN KEY (form_id) REFERENCES exam_forms(form_id) |
| `exam_components` | `exam_components_revision_id_fkey` | FOREIGN KEY (revision_id) REFERENCES content_revisions(id) |
| `exam_forms` | `exam_forms_revision_id_fkey` | FOREIGN KEY (revision_id) REFERENCES content_revisions(id) |
| `example_review_events` | `example_review_events_example_id_fkey` | FOREIGN KEY (example_id) REFERENCES content_examples(id) ON DELETE CASCADE |
| `example_variants` | `example_variants_example_id_fkey` | FOREIGN KEY (example_id) REFERENCES content_examples(id) ON DELETE CASCADE |
| `feedback_events` | `feedback_events_attempt_id_fkey` | FOREIGN KEY (attempt_id) REFERENCES attempts(attempt_id) ON DELETE CASCADE |
| `feedback_events` | `feedback_events_competency_id_fkey` | FOREIGN KEY (competency_id) REFERENCES competencies(competency_id) |
| `feedback_events` | `feedback_events_user_id_fkey` | FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE |
| `idempotency_keys` | `idempotency_keys_key_check` | CHECK (((char_length(key) >= 8) AND (char_length(key) <= 200))) |
| `idempotency_keys` | `idempotency_keys_user_id_fkey` | FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE |
| `import_quarantine` | `import_quarantine_import_run_id_fkey` | FOREIGN KEY (import_run_id) REFERENCES import_runs(id) ON DELETE CASCADE |
| `import_runs` | `import_runs_status_check` | CHECK ((status = ANY (ARRAY['RUNNING'::text, 'COMMITTED'::text, 'FAILED'::text, 'VALIDATED_ONLY'::text]))) |
| `invitations` | `invitations_entry_path_check` | CHECK ((entry_path = ANY (ARRAY['from_zero'::text, 'prior_learning'::text, 'unsure'::text]))) |
| `invitations` | `invitations_invited_by_fkey` | FOREIGN KEY (invited_by) REFERENCES auth.users(id) ON DELETE SET NULL |
| `invitations` | `invitations_invited_user_id_fkey` | FOREIGN KEY (invited_user_id) REFERENCES auth.users(id) ON DELETE SET NULL |
| `invitations` | `invitations_status_check` | CHECK ((status = ANY (ARRAY['SENT'::text, 'ACCEPTED'::text, 'REVOKED'::text, 'FAILED'::text]))) |
| `item_audio` | `item_audio_audio_id_fkey` | FOREIGN KEY (audio_id) REFERENCES audio_jobs(audio_id) |
| `item_audio` | `item_audio_item_id_fkey` | FOREIGN KEY (item_id) REFERENCES items(item_id) ON DELETE CASCADE |
| `item_competencies` | `item_competencies_competency_id_fkey` | FOREIGN KEY (competency_id) REFERENCES competencies(competency_id) |
| `item_competencies` | `item_competencies_item_id_fkey` | FOREIGN KEY (item_id) REFERENCES items(item_id) ON DELETE CASCADE |
| `item_competencies` | `item_competencies_relation_check` | CHECK ((relation = ANY (ARRAY['target'::text, 'prerequisite'::text]))) |
| `item_sources` | `item_sources_claim_id_fkey` | FOREIGN KEY (claim_id) REFERENCES source_claims(claim_id) |
| `item_sources` | `item_sources_item_id_fkey` | FOREIGN KEY (item_id) REFERENCES items(item_id) ON DELETE CASCADE |
| `items` | `items_check` | CHECK (((module = 'synthetic_fixture'::text) = (item_id ~~ 'SYN-%'::text))) |
| `items` | `items_current_hash_check` | CHECK ((current_hash ~ '^[0-9a-f]{64}$'::text)) |
| `items` | `items_module_check` | CHECK ((module = ANY (ARRAY['core'::text, 'keg_b2'::text, 'pegp'::text, 'real_greek'::text, 'synthetic_fixture'::text]))) |
| `items` | `items_revision_id_fkey` | FOREIGN KEY (revision_id) REFERENCES content_revisions(id) |
| `items` | `items_unit_id_fkey` | FOREIGN KEY (unit_id) REFERENCES units(unit_id) |
| `learner_events` | `learner_events_event_type_check` | CHECK ((event_type = ANY (ARRAY['lesson_started'::text, 'lesson_completed'::text, 'exercise_submitted'::text, 'mistake_detected'::text, 'review_due'::text, 'delayed_review_passed'::text, 'delayed_review_failed'::text, 'placement_updated'::text, 'speaking_assessed'::text, 'speaking_session_ended'::text, 'writing_assessed'::text, 'exam_started'::text, 'exam_completed'::text, 'content_approved'::text, 'context_transfer_passed'::text, 'competency_mastery_updated'::text, 'route_changed'::text, 'profile_activated'::text, 'appeal_opened'::text, 'appeal_resolved'::text, 'activity'::text]))) |
| `learner_events` | `learner_events_user_id_event_type_idempotency_key_key` | UNIQUE (user_id, event_type, idempotency_key) |
| `learner_events` | `learner_events_user_id_fkey` | FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE |
| `learning_routes` | `learning_routes_route_kind_check` | CHECK ((route_kind = ANY (ARRAY['foundations'::text, 'provisional'::text, 'verified'::text, 'manual'::text]))) |
| `learning_routes` | `learning_routes_set_by_fkey` | FOREIGN KEY (set_by) REFERENCES auth.users(id) ON DELETE SET NULL |
| `learning_routes` | `learning_routes_start_unit_id_fkey` | FOREIGN KEY (start_unit_id) REFERENCES units(unit_id) |
| `learning_routes` | `learning_routes_user_id_fkey` | FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE |
| `lesson_sessions` | `lesson_sessions_status_check` | CHECK ((status = ANY (ARRAY['IN_PROGRESS'::text, 'COMPLETED'::text, 'ABANDONED'::text]))) |
| `lesson_sessions` | `lesson_sessions_unit_id_fkey` | FOREIGN KEY (unit_id) REFERENCES units(unit_id) |
| `lesson_sessions` | `lesson_sessions_user_id_fkey` | FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE |
| `mastery_events` | `mastery_events_attempt_id_fkey` | FOREIGN KEY (attempt_id) REFERENCES attempts(attempt_id) ON DELETE CASCADE |
| `mastery_events` | `mastery_events_competency_id_fkey` | FOREIGN KEY (competency_id) REFERENCES competencies(competency_id) |
| `mastery_events` | `mastery_events_event_type_check` | CHECK ((event_type = ANY (ARRAY['independent_correct'::text, 'independent_incorrect'::text, 'assisted_observation'::text, 'review_passed'::text, 'review_failed'::text, 'transfer_passed'::text, 'transfer_failed'::text, 'compensation'::text, 'placement_observation'::text]))) |
| `mastery_events` | `mastery_events_supersedes_id_fkey` | FOREIGN KEY (supersedes_id) REFERENCES mastery_events(event_id) |
| `mastery_events` | `mastery_events_task_kind_check` | CHECK ((task_kind = ANY (ARRAY['recognition'::text, 'controlled'::text, 'spontaneous'::text, 'retention'::text, 'transfer'::text]))) |
| `mastery_events` | `mastery_events_user_id_fkey` | FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE |
| `media_rights` | `media_rights_example_id_fkey` | FOREIGN KEY (example_id) REFERENCES content_examples(id) ON DELETE CASCADE |
| `media_rights` | `media_rights_status_check` | CHECK ((status = ANY (ARRAY['RIGHTS_PENDING'::text, 'EMBED_ALLOWED'::text, 'LINK_ONLY'::text, 'BLOCKED'::text]))) |
| `pegp_packets` | `pegp_packets_packet_kind_check` | CHECK ((packet_kind = ANY (ARRAY['thematic'::text, 'language_support'::text]))) |
| `pegp_packets` | `pegp_packets_revision_id_fkey` | FOREIGN KEY (revision_id) REFERENCES content_revisions(id) |
| `placement_axis_results` | `placement_axis_results_axis_check` | CHECK ((axis = ANY (ARRAY['listening'::text, 'reading'::text, 'spoken_interaction'::text, 'spoken_production'::text, 'writing'::text, 'pronunciation'::text, 'grammar'::text, 'vocabulary'::text]))) |
| `placement_axis_results` | `placement_axis_results_confidence_check` | CHECK ((confidence = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text]))) |
| `placement_axis_results` | `placement_axis_results_session_id_fkey` | FOREIGN KEY (session_id) REFERENCES placement_sessions(id) ON DELETE CASCADE |
| `placement_axis_results` | `placement_axis_results_status_check` | CHECK ((status = ANY (ARRAY['IN_PROGRESS'::text, 'OBSERVED'::text, 'NOT_OBSERVED'::text, 'PENDING_REVIEW'::text, 'STOPPED'::text, 'NO_RELEASED_CONTENT'::text]))) |
| `placement_axis_results` | `placement_axis_results_user_id_fkey` | FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE |
| `placement_sessions` | `placement_sessions_status_check` | CHECK ((status = ANY (ARRAY['IN_PROGRESS'::text, 'COMPLETED'::text, 'ABANDONED'::text]))) |
| `placement_sessions` | `placement_sessions_user_id_fkey` | FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE |
| `preferences` | `preferences_speaking_rate_check` | CHECK ((speaking_rate = ANY (ARRAY['slow'::text, 'normal'::text]))) |
| `preferences` | `preferences_user_id_fkey` | FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE |
| `profiles` | `profiles_display_name_check` | CHECK (((char_length(display_name) >= 1) AND (char_length(display_name) <= 80))) |
| `profiles` | `profiles_entry_path_check` | CHECK ((entry_path = ANY (ARRAY['from_zero'::text, 'prior_learning'::text, 'unsure'::text]))) |
| `profiles` | `profiles_lifecycle_state_check` | CHECK ((lifecycle_state = ANY (ARRAY['invited'::text, 'activated'::text, 'foundations'::text, 'placement_pending'::text, 'placement_in_progress'::text, 'provisional_route'::text, 'placement_verified'::text, 'studying'::text, 'inactive'::text]))) |
| `profiles` | `profiles_user_id_fkey` | FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE |
| `provider_usage` | `provider_usage_user_id_fkey` | FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL |
| `publication_policies` | `publication_policies_kind_check` | CHECK ((kind = 'DIGITAL_ONLY_RISK_ACCEPTED'::text)) |
| `publication_policies` | `publication_policies_revoked_by_fkey` | FOREIGN KEY (revoked_by) REFERENCES auth.users(id) ON DELETE SET NULL |
| `publication_policies` | `publication_policies_signed_by_fkey` | FOREIGN KEY (signed_by) REFERENCES auth.users(id) |
| `rg_expressions` | `rg_expressions_revision_id_fkey` | FOREIGN KEY (revision_id) REFERENCES content_revisions(id) |
| `role_assignments` | `role_assignments_granted_by_fkey` | FOREIGN KEY (granted_by) REFERENCES auth.users(id) ON DELETE SET NULL |
| `role_assignments` | `role_assignments_role_check` | CHECK ((role = ANY (ARRAY['learner'::text, 'owner_admin'::text]))) |
| `role_assignments` | `role_assignments_user_id_fkey` | FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE |
| `route_changes` | `route_changes_changed_by_fkey` | FOREIGN KEY (changed_by) REFERENCES auth.users(id) ON DELETE SET NULL |
| `route_changes` | `route_changes_user_id_fkey` | FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE |
| `rubrics` | `rubrics_revision_id_fkey` | FOREIGN KEY (revision_id) REFERENCES content_revisions(id) |
| `source_claims` | `source_claims_revision_id_fkey` | FOREIGN KEY (revision_id) REFERENCES content_revisions(id) |
| `spaced_reviews` | `spaced_reviews_anchor_attempt_id_fkey` | FOREIGN KEY (anchor_attempt_id) REFERENCES attempts(attempt_id) ON DELETE CASCADE |
| `spaced_reviews` | `spaced_reviews_competency_id_fkey` | FOREIGN KEY (competency_id) REFERENCES competencies(competency_id) |
| `spaced_reviews` | `spaced_reviews_completed_attempt_id_fkey` | FOREIGN KEY (completed_attempt_id) REFERENCES attempts(attempt_id) ON DELETE SET NULL |
| `spaced_reviews` | `spaced_reviews_interval_days_check` | CHECK ((interval_days = ANY (ARRAY[1, 3, 7, 14, 28]))) |
| `spaced_reviews` | `spaced_reviews_status_check` | CHECK ((status = ANY (ARRAY['due'::text, 'passed'::text, 'failed'::text, 'assisted'::text, 'superseded'::text]))) |
| `spaced_reviews` | `spaced_reviews_user_id_competency_id_anchor_attempt_id_inte_key` | UNIQUE (user_id, competency_id, anchor_attempt_id, interval_days) |
| `spaced_reviews` | `spaced_reviews_user_id_fkey` | FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE |
| `speaking_scenarios` | `speaking_scenarios_revision_id_fkey` | FOREIGN KEY (revision_id) REFERENCES content_revisions(id) |
| `speaking_sessions` | `speaking_sessions_consent_id_fkey` | FOREIGN KEY (consent_id) REFERENCES consents(consent_id) |
| `speaking_sessions` | `speaking_sessions_input_mode_check` | CHECK ((input_mode = ANY (ARRAY['voice'::text, 'text_fallback'::text]))) |
| `speaking_sessions` | `speaking_sessions_mode_check` | CHECK ((mode = ANY (ARRAY['a0_guided'::text, 'course'::text, 'roleplay'::text, 'free_talk'::text, 'tutor_help'::text, 'b2_mock'::text, 'real_greek'::text]))) |
| `speaking_sessions` | `speaking_sessions_scenario_id_fkey` | FOREIGN KEY (scenario_id) REFERENCES speaking_scenarios(scenario_id) |
| `speaking_sessions` | `speaking_sessions_status_check` | CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'PAUSED'::text, 'ENDED'::text, 'FAILED'::text]))) |
| `speaking_sessions` | `speaking_sessions_transport_check` | CHECK ((transport = ANY (ARRAY['batch'::text, 'stream_local_gateway'::text, 'stream_cloud_gateway'::text]))) |
| `speaking_sessions` | `speaking_sessions_user_id_fkey` | FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE |
| `speaking_sessions` | `speaking_sessions_voice_persona_fkey` | FOREIGN KEY (voice_persona) REFERENCES cast_roles(cast_role_id) |
| `speaking_turn_metrics` | `speaking_turn_metrics_input_source_check` | CHECK ((input_source = ANY (ARRAY['microphone'::text, 'synthetic_test_clip'::text]))) |
| `speaking_turn_metrics` | `speaking_turn_metrics_session_id_fkey` | FOREIGN KEY (session_id) REFERENCES speaking_sessions(session_id) ON DELETE CASCADE |
| `speaking_turn_metrics` | `speaking_turn_metrics_session_id_turn_seq_key` | UNIQUE (session_id, turn_seq) |
| `speaking_turn_metrics` | `speaking_turn_metrics_user_id_fkey` | FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE |
| `speaking_turns` | `speaking_turns_session_id_fkey` | FOREIGN KEY (session_id) REFERENCES speaking_sessions(session_id) ON DELETE CASCADE |
| `speaking_turns` | `speaking_turns_session_id_seq_key` | UNIQUE (session_id, seq) |
| `speaking_turns` | `speaking_turns_speaker_check` | CHECK ((speaker = ANY (ARRAY['learner'::text, 'assistant'::text]))) |
| `speaking_turns` | `speaking_turns_user_id_fkey` | FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE |
| `speaking_turns` | `speaking_turns_user_id_idempotency_key_key` | UNIQUE (user_id, idempotency_key) |
| `units` | `units_level_check` | CHECK ((level = ANY (ARRAY['A1'::text, 'A2'::text, 'B1'::text, 'B2'::text]))) |
| `units` | `units_revision_id_fkey` | FOREIGN KEY (revision_id) REFERENCES content_revisions(id) |
| `voice_artifacts` | `voice_artifacts_consent_id_fkey` | FOREIGN KEY (consent_id) REFERENCES consents(consent_id) |
| `voice_artifacts` | `voice_artifacts_session_id_fkey` | FOREIGN KEY (session_id) REFERENCES speaking_sessions(session_id) ON DELETE CASCADE |
| `voice_artifacts` | `voice_artifacts_user_id_fkey` | FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE |
| `voice_catalog` | `voice_catalog_approved_by_fkey` | FOREIGN KEY (approved_by) REFERENCES auth.users(id) ON DELETE SET NULL |
| `voice_catalog` | `voice_catalog_check` | CHECK (((provider <> 'mock'::text) OR ((distribution_allowed = false) AND (approved_by_owner = false)))) |
| `voice_catalog` | `voice_catalog_engine_kind_check` | CHECK ((engine_kind = ANY (ARRAY['local'::text, 'cloud'::text, 'test'::text]))) |
| `voice_catalog` | `voice_catalog_presentation_check` | CHECK ((presentation = ANY (ARRAY['female'::text, 'male'::text, 'other'::text, 'unspecified'::text]))) |
| `voice_catalog` | `voice_catalog_provider_check` | CHECK ((provider = ANY (ARRAY['local_macos'::text, 'azure'::text, 'google'::text, 'openai'::text, 'mock'::text]))) |
| `voice_catalog` | `voice_catalog_qa_status_check` | CHECK ((qa_status = ANY (ARRAY['NOT_TESTED'::text, 'TECH_QA_PASS'::text, 'TECH_QA_FAIL'::text, 'OWNER_LISTENED'::text, 'REJECTED'::text]))) |

## Политики RLS

| Таблица | Политика | Команда | Роли | Условие |
|---|---|---|---|---|
| `activity_days` | `activity_days_select_own` | SELECT | authenticated | ((user_id = ( SELECT auth.uid() AS uid)) AND app_private.is_active_user(( SELECT auth.uid() AS uid))) |
| `appeals` | `appeals_select_own` | SELECT | authenticated | ((user_id = ( SELECT auth.uid() AS uid)) AND app_private.is_active_user(( SELECT auth.uid() AS uid))) |
| `assessments` | `assessments_select_own` | SELECT | authenticated | ((user_id = ( SELECT auth.uid() AS uid)) AND app_private.is_active_user(( SELECT auth.uid() AS uid))) |
| `attempts` | `attempts_select_own` | SELECT | authenticated | ((user_id = ( SELECT auth.uid() AS uid)) AND app_private.is_active_user(( SELECT auth.uid() AS uid))) |
| `competency_state` | `competency_state_select_own` | SELECT | authenticated | ((user_id = ( SELECT auth.uid() AS uid)) AND app_private.is_active_user(( SELECT auth.uid() AS uid))) |
| `consents` | `consents_select_own` | SELECT | authenticated | ((user_id = ( SELECT auth.uid() AS uid)) AND app_private.is_active_user(( SELECT auth.uid() AS uid))) |
| `context_transfer_attempts` | `context_transfer_attempts_select_own` | SELECT | authenticated | ((user_id = ( SELECT auth.uid() AS uid)) AND app_private.is_active_user(( SELECT auth.uid() AS uid))) |
| `enrollments` | `enrollments_select_own` | SELECT | authenticated | ((user_id = ( SELECT auth.uid() AS uid)) AND app_private.is_active_user(( SELECT auth.uid() AS uid))) |
| `error_evidence` | `error_evidence_select_own` | SELECT | authenticated | ((user_id = ( SELECT auth.uid() AS uid)) AND app_private.is_active_user(( SELECT auth.uid() AS uid))) |
| `exam_attempts` | `exam_attempts_select_own` | SELECT | authenticated | ((user_id = ( SELECT auth.uid() AS uid)) AND app_private.is_active_user(( SELECT auth.uid() AS uid))) |
| `feedback_events` | `feedback_events_select_own` | SELECT | authenticated | ((user_id = ( SELECT auth.uid() AS uid)) AND app_private.is_active_user(( SELECT auth.uid() AS uid))) |
| `learner_events` | `learner_events_select` | SELECT | authenticated | (((user_id = ( SELECT auth.uid() AS uid)) AND app_private.is_active_user(( SELECT auth.uid() AS uid))) OR app_private.is_owner_admin(( SELECT auth.uid() AS uid))) |
| `learning_routes` | `learning_routes_select_own` | SELECT | authenticated | ((user_id = ( SELECT auth.uid() AS uid)) AND app_private.is_active_user(( SELECT auth.uid() AS uid))) |
| `lesson_sessions` | `lesson_sessions_select_own` | SELECT | authenticated | ((user_id = ( SELECT auth.uid() AS uid)) AND app_private.is_active_user(( SELECT auth.uid() AS uid))) |
| `mastery_events` | `mastery_events_select_own` | SELECT | authenticated | ((user_id = ( SELECT auth.uid() AS uid)) AND app_private.is_active_user(( SELECT auth.uid() AS uid))) |
| `placement_axis_results` | `placement_axis_results_select_own` | SELECT | authenticated | ((user_id = ( SELECT auth.uid() AS uid)) AND app_private.is_active_user(( SELECT auth.uid() AS uid))) |
| `placement_sessions` | `placement_sessions_select_own` | SELECT | authenticated | ((user_id = ( SELECT auth.uid() AS uid)) AND app_private.is_active_user(( SELECT auth.uid() AS uid))) |
| `preferences` | `preferences_select_own` | SELECT | authenticated | ((user_id = ( SELECT auth.uid() AS uid)) AND app_private.is_active_user(( SELECT auth.uid() AS uid))) |
| `profiles` | `profiles_select_own_or_owner` | SELECT | authenticated | (((user_id = ( SELECT auth.uid() AS uid)) AND active) OR app_private.is_owner_admin(( SELECT auth.uid() AS uid))) |
| `role_assignments` | `role_assignments_select_own` | SELECT | authenticated | ((user_id = ( SELECT auth.uid() AS uid)) AND app_private.is_active_user(( SELECT auth.uid() AS uid))) |
| `spaced_reviews` | `spaced_reviews_select_own` | SELECT | authenticated | ((user_id = ( SELECT auth.uid() AS uid)) AND app_private.is_active_user(( SELECT auth.uid() AS uid))) |
| `speaking_sessions` | `speaking_sessions_select_own` | SELECT | authenticated | ((user_id = ( SELECT auth.uid() AS uid)) AND app_private.is_active_user(( SELECT auth.uid() AS uid))) |
| `speaking_turn_metrics` | `speaking_turn_metrics_select_own` | SELECT | authenticated | ((user_id = ( SELECT auth.uid() AS uid)) AND app_private.is_active_user(( SELECT auth.uid() AS uid))) |
| `speaking_turns` | `speaking_turns_select_own` | SELECT | authenticated | ((user_id = ( SELECT auth.uid() AS uid)) AND app_private.is_active_user(( SELECT auth.uid() AS uid))) |
| `voice_artifacts` | `voice_artifacts_select_own` | SELECT | authenticated | ((user_id = ( SELECT auth.uid() AS uid)) AND app_private.is_active_user(( SELECT auth.uid() AS uid))) |

## Функции и триггеры

| Функция | SECURITY DEFINER | EXECUTE для |
|---|---|---|
| `app_private.assert_owner_rows(uid uuid, rows jsonb, label text)` | нет | service_role |
| `app_private.forbid_mutation()` | нет | anon,authenticated,service_role |
| `app_private.is_active_user(uid uuid)` | да | anon,authenticated,service_role |
| `app_private.is_owner_admin(uid uuid)` | да | anon,authenticated,service_role |
| `public.admin_revoke_user_sessions(target uuid)` | да | service_role |
| `public.commit_learning_event(p jsonb)` | да | service_role |

| Триггер | Таблица | Функция |
|---|---|---|
| `admin_audit_log_append_only` | `admin_audit_log` | `app_private.forbid_mutation` |
| `content_revisions_immutable` | `content_revisions` | `app_private.forbid_mutation` |

## Storage (приватные бакеты)

| Бакет | Публичный | Лимит, байт | MIME |
|---|---|---|---|
| `course-audio` | нет | 52428800 | audio/wav, audio/x-wav, audio/mpeg, audio/ogg, audio/webm |
| `tts-cache` | нет | 10485760 | audio/wav, audio/x-wav, audio/mpeg, audio/ogg |
| `voice-review` | нет | 10485760 | audio/webm, audio/ogg, audio/wav, audio/mp4, audio/mpeg |

## Realtime

- Публикация `supabase_realtime`: `public.learner_events`
