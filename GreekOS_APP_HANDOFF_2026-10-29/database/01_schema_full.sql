


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "app_private";


ALTER SCHEMA "app_private" OWNER TO "postgres";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "app_private"."assert_owner_rows"("uid" "uuid", "rows" "jsonb", "label" "text") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
declare r jsonb;
begin
  if rows is null or jsonb_typeof(rows) <> 'array' then
    return;
  end if;
  for r in select value from jsonb_array_elements(rows) loop
    if r is null or jsonb_typeof(r) = 'null' then
      continue;
    end if;
    if jsonb_typeof(r) <> 'object' or (r->>'user_id')::uuid is distinct from uid then
      raise exception 'ownership mismatch in %', label using errcode = '42501';
    end if;
  end loop;
end;
$$;


ALTER FUNCTION "app_private"."assert_owner_rows"("uid" "uuid", "rows" "jsonb", "label" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "app_private"."forbid_mutation"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  raise exception 'immutable table %: % is not allowed', tg_table_name, tg_op using errcode = '42501';
end;
$$;


ALTER FUNCTION "app_private"."forbid_mutation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "app_private"."is_active_user"("uid" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (select 1 from public.profiles p where p.user_id = uid and p.active);
$$;


ALTER FUNCTION "app_private"."is_active_user"("uid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "app_private"."is_owner_admin"("uid" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1 from public.role_assignments r
    join public.profiles p on p.user_id = r.user_id
    where r.user_id = uid and r.role = 'owner_admin' and p.active
  );
$$;


ALTER FUNCTION "app_private"."is_owner_admin"("uid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_revoke_user_sessions"("target" "uuid") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare n integer;
begin
  delete from auth.refresh_tokens where user_id = target::text;
  delete from auth.sessions where user_id = target;
  get diagnostics n = row_count;
  return n;
end;
$$;


ALTER FUNCTION "public"."admin_revoke_user_sessions"("target" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."commit_learning_event"("p" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  uid uuid := (p->>'user_id')::uuid;
  ikey text := p->>'idempotency_key';
  stored jsonb;
  r jsonb;
begin
  if uid is null or ikey is null then
    raise exception 'user_id and idempotency_key are required' using errcode = '22023';
  end if;
  if not exists (select 1 from profiles where user_id = uid and active) then
    raise exception 'inactive or unknown learner' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(uid::text, 42));

  insert into idempotency_keys (user_id, key, scope, result)
  values (uid, ikey, coalesce(p->>'scope', 'learning'), p->'result')
  on conflict (user_id, key) do nothing;
  if not found then
    select result into stored from idempotency_keys where user_id = uid and key = ikey;
    return jsonb_build_object('replayed', true, 'result', stored);
  end if;

  perform app_private.assert_owner_rows(uid, jsonb_build_array(p->'attempt'), 'attempt');
  perform app_private.assert_owner_rows(uid, jsonb_build_array(p->'assessment'), 'assessment');
  perform app_private.assert_owner_rows(uid, p->'mastery_events', 'mastery_events');
  perform app_private.assert_owner_rows(uid, p->'spaced_reviews_new', 'spaced_reviews_new');
  perform app_private.assert_owner_rows(uid, p->'error_evidence', 'error_evidence');
  perform app_private.assert_owner_rows(uid, jsonb_build_array(p->'feedback_event'), 'feedback_event');
  perform app_private.assert_owner_rows(uid, jsonb_build_array(p->'transfer_attempt'), 'transfer_attempt');

  if jsonb_typeof(p->'attempt') = 'object' then
    insert into attempts select * from jsonb_populate_record(null::attempts, p->'attempt');
  end if;

  if jsonb_typeof(p->'assessment') = 'object' then
    insert into assessments select * from jsonb_populate_record(null::assessments, p->'assessment');
  end if;

  if jsonb_typeof(p->'mastery_events') = 'array' then
    insert into mastery_events select * from jsonb_populate_recordset(null::mastery_events, p->'mastery_events');
  end if;

  if jsonb_typeof(p->'spaced_reviews_new') = 'array' then
    insert into spaced_reviews select * from jsonb_populate_recordset(null::spaced_reviews, p->'spaced_reviews_new')
    on conflict (user_id, competency_id, anchor_attempt_id, interval_days) do nothing;
  end if;

  if jsonb_typeof(p->'spaced_review_completions') = 'array' then
    for r in select value from jsonb_array_elements(p->'spaced_review_completions') loop
      update spaced_reviews
         set status = r->>'status',
             completed_attempt_id = (r->>'completed_attempt_id')::uuid,
             completed_local_date = (r->>'completed_local_date')::date
       where id = (r->>'id')::uuid and user_id = uid and status = 'due';
    end loop;
  end if;

  if jsonb_typeof(p->'error_evidence') = 'array' then
    insert into error_evidence select * from jsonb_populate_recordset(null::error_evidence, p->'error_evidence');
  end if;

  if jsonb_typeof(p->'error_evidence_updates') = 'array' then
    for r in select value from jsonb_array_elements(p->'error_evidence_updates') loop
      update error_evidence set status = r->>'status'
       where id = (r->>'id')::uuid and user_id = uid and status in ('open', 'practised');
    end loop;
  end if;

  if jsonb_typeof(p->'feedback_event') = 'object' then
    insert into feedback_events select * from jsonb_populate_record(null::feedback_events, p->'feedback_event');
  end if;

  if jsonb_typeof(p->'transfer_attempt') = 'object' then
    insert into context_transfer_attempts select * from jsonb_populate_record(null::context_transfer_attempts, p->'transfer_attempt');
  end if;

  if jsonb_typeof(p->'lesson_session') = 'object' then
    update lesson_sessions
       set status = coalesce(p->'lesson_session'->>'status', status),
           current_step = coalesce(p->'lesson_session'->>'current_step', current_step),
           completed_at = case when p->'lesson_session'->>'status' = 'COMPLETED' then now() else completed_at end
     where id = (p->'lesson_session'->>'id')::uuid and user_id = uid;
  end if;

  if jsonb_typeof(p->'competency_state') = 'array' then
    for r in select value from jsonb_array_elements(p->'competency_state') loop
      insert into competency_state (user_id, competency_id, state, summary, updated_at)
      values (uid, r->>'competency_id', r->>'state', coalesce(r->'summary', '{}'::jsonb), now())
      on conflict (user_id, competency_id) do update
        set state = excluded.state, summary = excluded.summary, updated_at = now();
    end loop;
  end if;

  if jsonb_typeof(p->'activity') = 'object' then
    insert into activity_days (user_id, local_date, active_seconds, attempts, updated_at)
    values (
      uid,
      (p->'activity'->>'local_date')::date,
      greatest(0, coalesce((p->'activity'->>'active_seconds')::int, 0)),
      greatest(0, coalesce((p->'activity'->>'attempts')::int, 0)),
      now()
    )
    on conflict (user_id, local_date) do update
      set active_seconds = activity_days.active_seconds + excluded.active_seconds,
          attempts = activity_days.attempts + excluded.attempts,
          updated_at = now();
  end if;

  if jsonb_typeof(p->'events') = 'array' then
    for r in select value from jsonb_array_elements(p->'events') loop
      insert into learner_events (user_id, event_type, idempotency_key, source_version, payload)
      values (uid, r->>'event_type', coalesce(r->>'idempotency_key', ikey), r->>'source_version', coalesce(r->'payload', '{}'::jsonb))
      on conflict (user_id, event_type, idempotency_key) do nothing;
    end loop;
  end if;

  return jsonb_build_object('replayed', false, 'result', p->'result');
end;
$$;


ALTER FUNCTION "public"."commit_learning_event"("p" "jsonb") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."content_releases" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "content_kind" "text" NOT NULL,
    "content_id" "text" NOT NULL,
    "content_hash" "text" NOT NULL,
    "review_type" "text" NOT NULL,
    "reviewer_identity" "text" NOT NULL,
    "reviewer_user_id" "uuid",
    "method" "text" NOT NULL,
    "scope" "text" NOT NULL,
    "evidence_path" "text",
    "evidence_hash" "text",
    "decision" "text" NOT NULL,
    "reviewed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "rights_scope" "text" NOT NULL,
    "expires_at" timestamp with time zone,
    "policy_id" "uuid",
    "revoked_at" timestamp with time zone,
    "revoked_reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "content_releases_check" CHECK ((("review_type" = 'SYNTHETIC_TEST_FIXTURE'::"text") = ("content_id" ~~ 'SYN-%'::"text"))),
    CONSTRAINT "content_releases_check1" CHECK ((("review_type" <> 'OWNER_DIGITAL_POLICY'::"text") OR ("policy_id" IS NOT NULL))),
    CONSTRAINT "content_releases_check2" CHECK ((("review_type" !~~ 'HUMAN_%'::"text") OR (("evidence_path" IS NOT NULL) AND ("evidence_hash" IS NOT NULL)))),
    CONSTRAINT "content_releases_content_kind_check" CHECK (("content_kind" = ANY (ARRAY['item'::"text", 'unit'::"text", 'scenario'::"text", 'audio_asset'::"text", 'exam_component'::"text", 'rg_expression'::"text", 'pegp_packet'::"text", 'context_example'::"text"]))),
    CONSTRAINT "content_releases_decision_check" CHECK (("decision" = ANY (ARRAY['APPROVED'::"text", 'REJECTED'::"text"]))),
    CONSTRAINT "content_releases_review_type_check" CHECK (("review_type" = ANY (ARRAY['HUMAN_TEACHER_REVIEW'::"text", 'HUMAN_EXAMINER_REVIEW'::"text", 'OWNER_DIGITAL_POLICY'::"text", 'SYNTHETIC_TEST_FIXTURE'::"text"]))),
    CONSTRAINT "content_releases_scope_check" CHECK (("scope" = ANY (ARRAY['learner_practice'::"text", 'diagnostic'::"text", 'exam_practice'::"text", 'pegp_session'::"text", 'real_greek'::"text", 'audio_playback'::"text"])))
);


ALTER TABLE "public"."content_releases" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."items" (
    "item_id" "text" NOT NULL,
    "module" "text" NOT NULL,
    "unit_id" "text",
    "item_type" "text" NOT NULL,
    "level" "text",
    "pool" "text",
    "section" "text",
    "requires_audio" boolean NOT NULL,
    "scoring_strategy" "text" NOT NULL,
    "competency_ids" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "prerequisite_ids" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "audio_job_ids" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "error_tags" "text"[],
    "envelope" "jsonb" NOT NULL,
    "current_hash" "text" NOT NULL,
    "revision_id" bigint NOT NULL,
    CONSTRAINT "items_check" CHECK ((("module" = 'synthetic_fixture'::"text") = ("item_id" ~~ 'SYN-%'::"text"))),
    CONSTRAINT "items_current_hash_check" CHECK (("current_hash" ~ '^[0-9a-f]{64}$'::"text")),
    CONSTRAINT "items_module_check" CHECK (("module" = ANY (ARRAY['core'::"text", 'keg_b2'::"text", 'pegp'::"text", 'real_greek'::"text", 'synthetic_fixture'::"text"])))
);


ALTER TABLE "public"."items" OWNER TO "postgres";


CREATE OR REPLACE VIEW "app_private"."current_item_release" AS
 SELECT "item_id",
    "module",
    "current_hash",
    "requires_audio",
    (EXISTS ( SELECT 1
           FROM "public"."content_releases" "r"
          WHERE (("r"."content_kind" = 'item'::"text") AND ("r"."content_id" = "i"."item_id") AND ("r"."content_hash" = "i"."current_hash") AND ("r"."decision" = 'APPROVED'::"text") AND ("r"."revoked_at" IS NULL) AND (("r"."expires_at" IS NULL) OR ("r"."expires_at" > "now"()))))) AS "text_released"
   FROM "public"."items" "i";


ALTER VIEW "app_private"."current_item_release" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."activity_days" (
    "user_id" "uuid" NOT NULL,
    "local_date" "date" NOT NULL,
    "active_seconds" integer DEFAULT 0 NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "activity_days_active_seconds_check" CHECK (("active_seconds" >= 0))
);


ALTER TABLE "public"."activity_days" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."admin_audit_log" (
    "event_id" bigint NOT NULL,
    "actor_id" "uuid",
    "action" "text" NOT NULL,
    "target_id" "text",
    "target_user_id" "uuid",
    "meta" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "occurred_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."admin_audit_log" OWNER TO "postgres";


ALTER TABLE "public"."admin_audit_log" ALTER COLUMN "event_id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."admin_audit_log_event_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."appeals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "assessment_id" "uuid" NOT NULL,
    "reason_ru" "text" NOT NULL,
    "status" "text" DEFAULT 'OPEN'::"text" NOT NULL,
    "resolution_note" "text",
    "resolved_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "resolved_at" timestamp with time zone,
    CONSTRAINT "appeals_reason_ru_check" CHECK ((("char_length"("reason_ru") >= 3) AND ("char_length"("reason_ru") <= 2000))),
    CONSTRAINT "appeals_status_check" CHECK (("status" = ANY (ARRAY['OPEN'::"text", 'UPHELD'::"text", 'REJECTED'::"text"])))
);


ALTER TABLE "public"."appeals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."assessments" (
    "assessment_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "attempt_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "verdict" "text" NOT NULL,
    "scorer" "text" NOT NULL,
    "reliable" boolean NOT NULL,
    "meaning_changing" boolean,
    "error_kind" "text",
    "error_tags" "text"[],
    "rubric_id" "text",
    "rubric_hash" "text",
    "assessor_version" "text" NOT NULL,
    "dimensions" "jsonb",
    "evidence" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "uncertainty" "text",
    "feedback_ru" "text",
    "status" "text" DEFAULT 'ACTIVE'::"text" NOT NULL,
    "supersedes_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "assessments_scorer_check" CHECK (("scorer" = ANY (ARRAY['key'::"text", 'structured'::"text", 'joint_bank'::"text", 'ai_assessor'::"text", 'human'::"text", 'none'::"text"]))),
    CONSTRAINT "assessments_status_check" CHECK (("status" = ANY (ARRAY['ACTIVE'::"text", 'SUPERSEDED'::"text", 'UNDER_APPEAL'::"text"]))),
    CONSTRAINT "assessments_verdict_check" CHECK (("verdict" = ANY (ARRAY['CORRECT'::"text", 'ACCEPTABLE_VARIANT'::"text", 'INCORRECT_CONFIRMED'::"text", 'AMBIGUOUS'::"text", 'ASR_UNCERTAIN'::"text", 'UNSUPPORTED'::"text", 'PENDING_REVIEW'::"text", 'ABSTAIN'::"text", 'NOT_ASSESSED'::"text"])))
);


ALTER TABLE "public"."assessments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."attempts" (
    "attempt_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "item_id" "text" NOT NULL,
    "content_hash" "text" NOT NULL,
    "context" "text" NOT NULL,
    "context_ref" "text",
    "response_private" "jsonb" NOT NULL,
    "assistance" "text" DEFAULT 'none'::"text" NOT NULL,
    "released_snapshot" boolean NOT NULL,
    "preview" boolean DEFAULT false NOT NULL,
    "idempotency_key" "text" NOT NULL,
    "local_date" "date" NOT NULL,
    "timezone" "text" NOT NULL,
    "active_ms" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "attempts_active_ms_check" CHECK ((("active_ms" IS NULL) OR ("active_ms" >= 0))),
    CONSTRAINT "attempts_assistance_check" CHECK (("assistance" = ANY (ARRAY['none'::"text", 'hint'::"text", 'model_shown'::"text", 'retry_after_model'::"text", 'translation'::"text", 'tutor_help'::"text"]))),
    CONSTRAINT "attempts_context_check" CHECK (("context" = ANY (ARRAY['lesson'::"text", 'review'::"text", 'diagnostic'::"text", 'exam'::"text", 'transfer'::"text", 'preview'::"text", 'speaking'::"text", 'pegp'::"text", 'real_greek'::"text", 'writing'::"text", 'corrective'::"text"])))
);


ALTER TABLE "public"."attempts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."audio_assets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "audio_id" "text" NOT NULL,
    "script_hash" "text" NOT NULL,
    "idempotency_key" "text" NOT NULL,
    "provider" "text" NOT NULL,
    "model" "text",
    "voice_map" "jsonb" NOT NULL,
    "locale" "text" DEFAULT 'el-GR'::"text" NOT NULL,
    "object_path" "text",
    "mime_type" "text",
    "sha256" "text",
    "byte_length" integer,
    "duration_ms" integer,
    "sample_rate" integer,
    "channels" integer,
    "segment_cues" "jsonb",
    "technical_status" "text" DEFAULT 'PENDING'::"text" NOT NULL,
    "technical_report" "jsonb",
    "asr_roundtrip" "jsonb",
    "digital_status" "text" DEFAULT 'PENDING'::"text" NOT NULL,
    "rights_status" "text" DEFAULT 'RIGHTS_PENDING'::"text" NOT NULL,
    "rights_evidence" "jsonb",
    "synthetic_disclosure" boolean DEFAULT true NOT NULL,
    "invalidated_at" timestamp with time zone,
    "invalidated_reason" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "render_status" "text" DEFAULT 'GENERATED'::"text" NOT NULL,
    "synthesis_version" "text",
    "voice_ids" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "cast_snapshot" "jsonb",
    "generation_params" "jsonb",
    "master_object_path" "text",
    "master_sha256" "text",
    "normalization" "jsonb",
    "cast_approved" boolean DEFAULT false NOT NULL,
    "history" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    CONSTRAINT "audio_assets_digital_status_check" CHECK (("digital_status" = ANY (ARRAY['PENDING'::"text", 'AUDIO_VERIFIED_DIGITAL'::"text", 'NEEDS_REVIEW'::"text", 'BLOCKED'::"text"]))),
    CONSTRAINT "audio_assets_mock_never_verified" CHECK ((("provider" <> 'mock'::"text") OR (("digital_status" <> 'AUDIO_VERIFIED_DIGITAL'::"text") AND ("rights_status" = 'RIGHTS_PENDING'::"text") AND ("render_status" <> ALL (ARRAY['DIGITAL_REVIEWED'::"text", 'RELEASE_ELIGIBLE'::"text"]))))),
    CONSTRAINT "audio_assets_release_eligible_requirements" CHECK ((("render_status" <> 'RELEASE_ELIGIBLE'::"text") OR ("cast_approved" AND ("rights_status" = 'PROVIDER_TERMS_RECORDED'::"text") AND ("digital_status" = 'AUDIO_VERIFIED_DIGITAL'::"text")))),
    CONSTRAINT "audio_assets_render_status_check" CHECK (("render_status" = ANY (ARRAY['AUDIO_PENDING'::"text", 'GENERATED'::"text", 'TECH_QA_PASS'::"text", 'TECH_QA_FAIL'::"text", 'LINGUISTIC_QA_PENDING'::"text", 'DIGITAL_REVIEWED'::"text", 'RELEASE_ELIGIBLE'::"text", 'BLOCKED'::"text"]))),
    CONSTRAINT "audio_assets_rights_status_check" CHECK (("rights_status" = ANY (ARRAY['RIGHTS_PENDING'::"text", 'PROVIDER_TERMS_RECORDED'::"text", 'DEV_LOCAL_ONLY'::"text", 'BLOCKED'::"text"]))),
    CONSTRAINT "audio_assets_synthetic_disclosure_check" CHECK ("synthetic_disclosure"),
    CONSTRAINT "audio_assets_technical_status_check" CHECK (("technical_status" = ANY (ARRAY['PENDING'::"text", 'TECHNICAL_PASS'::"text", 'TECHNICAL_FAIL'::"text"])))
);


ALTER TABLE "public"."audio_assets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."audio_job_casting" (
    "audio_id" "text" NOT NULL,
    "speaker_role" "text" NOT NULL,
    "cast_role_id" "text",
    "required_presentation" "text",
    "source" "text" NOT NULL,
    "evidence" "text",
    "approved" boolean DEFAULT false NOT NULL,
    "approved_by" "uuid",
    "approved_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "audio_job_casting_required_presentation_check" CHECK (("required_presentation" = ANY (ARRAY['female'::"text", 'male'::"text", 'any'::"text"]))),
    CONSTRAINT "audio_job_casting_source_check" CHECK (("source" = ANY (ARRAY['owner'::"text", 'grammatical_gender_proposal'::"text", 'self_reference_proposal'::"text", 'narrator_default_proposal'::"text", 'needs_casting'::"text"])))
);


ALTER TABLE "public"."audio_job_casting" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."audio_job_render_status" (
    "audio_id" "text" NOT NULL,
    "status" "text" NOT NULL,
    "reason" "text",
    "last_asset_id" "uuid",
    "attempts" integer DEFAULT 0 NOT NULL,
    "estimated_cost_usd" numeric DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "audio_job_render_status_status_check" CHECK (("status" = ANY (ARRAY['AUDIO_PENDING'::"text", 'BLOCKED_MISSING_VOICE_METADATA'::"text", 'BLOCKED_NO_SUITABLE_VOICE'::"text", 'BLOCKED_BUDGET'::"text", 'RENDER_FAILED'::"text", 'GENERATED'::"text", 'TECH_QA_PASS'::"text", 'TECH_QA_FAIL'::"text", 'DIGITAL_REVIEWED'::"text", 'RELEASE_ELIGIBLE'::"text"])))
);


ALTER TABLE "public"."audio_job_render_status" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."audio_jobs" (
    "audio_id" "text" NOT NULL,
    "status" "text" NOT NULL,
    "priority" "text",
    "script_hash" "text" NOT NULL,
    "text_el" "text",
    "segments" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "payload" "jsonb" NOT NULL,
    "current_hash" "text" NOT NULL,
    "revision_id" bigint NOT NULL
);


ALTER TABLE "public"."audio_jobs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cast_roles" (
    "cast_role_id" "text" NOT NULL,
    "requested_presentation" "text" NOT NULL,
    "locale" "text" DEFAULT 'el-GR'::"text" NOT NULL,
    "use_case" "text" NOT NULL,
    "target_speed" "text" DEFAULT 'normal'::"text" NOT NULL,
    "voice_id" "text",
    "approved" boolean DEFAULT false NOT NULL,
    "approved_by" "uuid",
    "approved_at" timestamp with time zone,
    "status" "text" DEFAULT 'unapproved'::"text" NOT NULL,
    CONSTRAINT "cast_roles_requested_presentation_check" CHECK (("requested_presentation" = ANY (ARRAY['female'::"text", 'male'::"text", 'any'::"text"])))
);


ALTER TABLE "public"."cast_roles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."competencies" (
    "competency_id" "text" NOT NULL,
    "scope" "text" NOT NULL,
    "module" "text",
    "level" "text",
    "name" "text",
    "prerequisites" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "primary_unit_ids" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "definition" "jsonb" NOT NULL,
    "current_hash" "text" NOT NULL,
    "revision_id" bigint NOT NULL,
    CONSTRAINT "competencies_scope_check" CHECK (("scope" = ANY (ARRAY['core'::"text", 'external'::"text"])))
);


ALTER TABLE "public"."competencies" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."competency_state" (
    "user_id" "uuid" NOT NULL,
    "competency_id" "text" NOT NULL,
    "state" "text" NOT NULL,
    "summary" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "competency_state_state_check" CHECK (("state" = ANY (ARRAY['unseen'::"text", 'familiar'::"text", 'recognition'::"text", 'controlled'::"text", 'spontaneous'::"text", 'retention_due'::"text", 'retained'::"text", 'transfer_confirmed'::"text", 'needs_review'::"text", 'insufficient_evidence'::"text"])))
);


ALTER TABLE "public"."competency_state" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."consents" (
    "consent_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "purpose" "text" NOT NULL,
    "artifact_id" "text",
    "reviewer_id" "uuid",
    "granted_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone,
    "revoked_at" timestamp with time zone,
    CONSTRAINT "consents_check" CHECK ((("purpose" <> 'voice_review_retention'::"text") OR (("expires_at" IS NOT NULL) AND ("expires_at" <= ("granted_at" + '30 days'::interval))))),
    CONSTRAINT "consents_purpose_check" CHECK (("purpose" = ANY (ARRAY['voice_review_retention'::"text", 'owner_transcript_access'::"text", 'admin_learning_analytics_notice'::"text"])))
);


ALTER TABLE "public"."consents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."content_examples" (
    "id" "text" NOT NULL,
    "competency_id" "text",
    "error_code" "text",
    "cefr_min" "text",
    "cefr_max" "text",
    "register" "text",
    "locale" "text" DEFAULT 'el-GR'::"text" NOT NULL,
    "example_type" "text" NOT NULL,
    "approved_text_gr" "text" NOT NULL,
    "translation_ru" "text",
    "meaning_notes_ru" "text",
    "contrast_id" "text",
    "provenance_json" "jsonb" NOT NULL,
    "text_hash" "text" NOT NULL,
    "quality_status" "text" NOT NULL,
    "version" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "published_at" timestamp with time zone,
    CONSTRAINT "content_examples_example_type_check" CHECK (("example_type" = ANY (ARRAY['situation'::"text", 'dialogue'::"text", 'pronunciation'::"text", 'media'::"text"]))),
    CONSTRAINT "content_examples_quality_status_check" CHECK (("quality_status" = ANY (ARRAY['DRAFT'::"text", 'NEEDS_SOURCE'::"text", 'DIGITAL_LINGUISTIC_QA'::"text", 'HUMAN_VERIFIED'::"text", 'BLOCKED'::"text"])))
);


ALTER TABLE "public"."content_examples" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."content_objects" (
    "object_id" "text" NOT NULL,
    "refs" "jsonb" NOT NULL,
    "payload" "jsonb" NOT NULL,
    "current_hash" "text" NOT NULL,
    "revision_id" bigint NOT NULL
);


ALTER TABLE "public"."content_objects" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."content_revisions" (
    "id" bigint NOT NULL,
    "content_kind" "text" NOT NULL,
    "content_id" "text" NOT NULL,
    "content_hash" "text" NOT NULL,
    "module" "text",
    "payload_private" "jsonb" NOT NULL,
    "import_run_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "content_revisions_content_hash_check" CHECK (("content_hash" ~ '^[0-9a-f]{64}$'::"text")),
    CONSTRAINT "content_revisions_content_kind_check" CHECK (("content_kind" = ANY (ARRAY['item'::"text", 'unit'::"text", 'competency'::"text", 'source_claim'::"text", 'rubric'::"text", 'object'::"text", 'audio_job'::"text", 'scenario'::"text", 'exam_form'::"text", 'exam_component'::"text", 'rg_expression'::"text", 'pegp_packet'::"text", 'pegp_catalog'::"text", 'singleton'::"text", 'context_example'::"text"])))
);


ALTER TABLE "public"."content_revisions" OWNER TO "postgres";


ALTER TABLE "public"."content_revisions" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."content_revisions_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."content_singletons" (
    "singleton_id" "text" NOT NULL,
    "payload" "jsonb" NOT NULL,
    "current_hash" "text" NOT NULL,
    "revision_id" bigint NOT NULL
);


ALTER TABLE "public"."content_singletons" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."context_transfer_attempts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "feedback_event_id" "uuid" NOT NULL,
    "attempt_id" "uuid" NOT NULL,
    "verdict" "text" NOT NULL,
    "evaluated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."context_transfer_attempts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."digital_qa_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "content_kind" "text" NOT NULL,
    "content_id" "text" NOT NULL,
    "content_hash" "text" NOT NULL,
    "check_kind" "text" NOT NULL,
    "tool_id" "text" NOT NULL,
    "verdict" "text" NOT NULL,
    "report" "jsonb" NOT NULL,
    "run_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "digital_qa_runs_check_kind_check" CHECK (("check_kind" = ANY (ARRAY['STRUCTURAL'::"text", 'DIGITAL_LINGUISTIC_QA'::"text", 'DIGITAL_AUDIO_QA'::"text", 'AUTO_SOURCE_CHECKED'::"text"]))),
    CONSTRAINT "digital_qa_runs_verdict_check" CHECK (("verdict" = ANY (ARRAY['PASS'::"text", 'NEEDS_REVIEW'::"text", 'FAIL'::"text", 'ABSTAIN'::"text"])))
);


ALTER TABLE "public"."digital_qa_runs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."enrollments" (
    "user_id" "uuid" NOT NULL,
    "start_date" "date",
    "timezone" "text" NOT NULL,
    "target_months" integer DEFAULT 9 NOT NULL,
    "end_date" "date",
    "exam_date" "date",
    "daily_minutes" integer DEFAULT 60 NOT NULL,
    "days_per_week" integer DEFAULT 6 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "enrollments_daily_minutes_check" CHECK ((("daily_minutes" >= 10) AND ("daily_minutes" <= 480))),
    CONSTRAINT "enrollments_days_per_week_check" CHECK ((("days_per_week" >= 1) AND ("days_per_week" <= 7))),
    CONSTRAINT "enrollments_target_months_check" CHECK (("target_months" = 9))
);


ALTER TABLE "public"."enrollments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."error_evidence" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "attempt_id" "uuid" NOT NULL,
    "assessment_id" "uuid",
    "item_id" "text" NOT NULL,
    "competency_id" "text",
    "verdict" "text" NOT NULL,
    "error_kind" "text",
    "error_tag" "text",
    "meaning_changing" boolean,
    "evidence" "jsonb" NOT NULL,
    "uncertainty" "text",
    "correction_el" "text",
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "error_evidence_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'practised'::"text", 'resolved'::"text", 'appealed'::"text", 'withdrawn'::"text"])))
);


ALTER TABLE "public"."error_evidence" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."exam_attempts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "component_id" "text" NOT NULL,
    "component_hash" "text" NOT NULL,
    "mode" "text" NOT NULL,
    "status" "text" DEFAULT 'IN_PROGRESS'::"text" NOT NULL,
    "server_started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "server_expires_at" timestamp with time zone,
    "answers_private" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "autosave_seq" integer DEFAULT 0 NOT NULL,
    "submitted_at" timestamp with time zone,
    "results" "jsonb",
    "idempotency_key" "text" NOT NULL,
    "audio_plays" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "exam_attempts_audio_plays_object" CHECK (("jsonb_typeof"("audio_plays") = 'object'::"text")),
    CONSTRAINT "exam_attempts_mode_check" CHECK (("mode" = ANY (ARRAY['simulation'::"text", 'practice'::"text"]))),
    CONSTRAINT "exam_attempts_status_check" CHECK (("status" = ANY (ARRAY['IN_PROGRESS'::"text", 'SUBMITTED'::"text", 'EXPIRED'::"text", 'ABANDONED'::"text"])))
);


ALTER TABLE "public"."exam_attempts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."exam_components" (
    "component_id" "text" NOT NULL,
    "form_id" "text" NOT NULL,
    "logical_id" "text",
    "component_kind" "text" NOT NULL,
    "duration_minutes" integer,
    "item_ids" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "text_ids" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "payload" "jsonb" NOT NULL,
    "current_hash" "text" NOT NULL,
    "revision_id" bigint NOT NULL,
    CONSTRAINT "exam_components_component_kind_check" CHECK (("component_kind" = ANY (ARRAY['reading'::"text", 'use_of_language'::"text", 'listening'::"text", 'writing'::"text", 'speaking'::"text"])))
);


ALTER TABLE "public"."exam_components" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."exam_forms" (
    "form_id" "text" NOT NULL,
    "payload" "jsonb" NOT NULL,
    "current_hash" "text" NOT NULL,
    "revision_id" bigint NOT NULL
);


ALTER TABLE "public"."exam_forms" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."example_review_events" (
    "id" bigint NOT NULL,
    "example_id" "text" NOT NULL,
    "tool_id" "text" NOT NULL,
    "verdict" "text" NOT NULL,
    "checked_hash" "text" NOT NULL,
    "evidence_ref" "text",
    "checked_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."example_review_events" OWNER TO "postgres";


ALTER TABLE "public"."example_review_events" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."example_review_events_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."example_variants" (
    "id" bigint NOT NULL,
    "example_id" "text" NOT NULL,
    "role" "text",
    "speech_text_gr" "text" NOT NULL,
    "localized_text_ru" "text",
    "pragmatic_intent" "text",
    "voice_profile_id" "text",
    "seq" integer NOT NULL,
    "timing_hint" "text"
);


ALTER TABLE "public"."example_variants" OWNER TO "postgres";


ALTER TABLE "public"."example_variants" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."example_variants_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."feedback_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "attempt_id" "uuid" NOT NULL,
    "competency_id" "text",
    "error_code" "text",
    "verdict" "text" NOT NULL,
    "explanation_version" "text" NOT NULL,
    "example_refs" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "captured_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."feedback_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."idempotency_keys" (
    "user_id" "uuid" NOT NULL,
    "key" "text" NOT NULL,
    "scope" "text" NOT NULL,
    "result" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "idempotency_keys_key_check" CHECK ((("char_length"("key") >= 8) AND ("char_length"("key") <= 200)))
);


ALTER TABLE "public"."idempotency_keys" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."import_quarantine" (
    "id" bigint NOT NULL,
    "import_run_id" "uuid" NOT NULL,
    "content_kind" "text" NOT NULL,
    "content_id" "text",
    "json_path" "text",
    "reason" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."import_quarantine" OWNER TO "postgres";


ALTER TABLE "public"."import_quarantine" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."import_quarantine_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."import_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "finished_at" timestamp with time zone,
    "status" "text" NOT NULL,
    "tool_version" "text" NOT NULL,
    "corpus_label" "text",
    "input_hashes" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "counts" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "report" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "import_runs_status_check" CHECK (("status" = ANY (ARRAY['RUNNING'::"text", 'COMMITTED'::"text", 'FAILED'::"text", 'VALIDATED_ONLY'::"text"])))
);


ALTER TABLE "public"."import_runs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invitations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email" "text" NOT NULL,
    "display_name" "text" NOT NULL,
    "entry_path" "text" NOT NULL,
    "invited_by" "uuid",
    "invited_user_id" "uuid",
    "status" "text" DEFAULT 'SENT'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "accepted_at" timestamp with time zone,
    CONSTRAINT "invitations_entry_path_check" CHECK (("entry_path" = ANY (ARRAY['from_zero'::"text", 'prior_learning'::"text", 'unsure'::"text"]))),
    CONSTRAINT "invitations_status_check" CHECK (("status" = ANY (ARRAY['SENT'::"text", 'ACCEPTED'::"text", 'REVOKED'::"text", 'FAILED'::"text"])))
);


ALTER TABLE "public"."invitations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."item_audio" (
    "item_id" "text" NOT NULL,
    "audio_id" "text" NOT NULL
);


ALTER TABLE "public"."item_audio" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."item_competencies" (
    "item_id" "text" NOT NULL,
    "competency_id" "text" NOT NULL,
    "relation" "text" NOT NULL,
    CONSTRAINT "item_competencies_relation_check" CHECK (("relation" = ANY (ARRAY['target'::"text", 'prerequisite'::"text"])))
);


ALTER TABLE "public"."item_competencies" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."item_sources" (
    "item_id" "text" NOT NULL,
    "claim_id" "text" NOT NULL
);


ALTER TABLE "public"."item_sources" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."learner_events" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "event_type" "text" NOT NULL,
    "idempotency_key" "text" NOT NULL,
    "source_version" "text",
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "occurred_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "learner_events_event_type_check" CHECK (("event_type" = ANY (ARRAY['lesson_started'::"text", 'lesson_completed'::"text", 'exercise_submitted'::"text", 'mistake_detected'::"text", 'review_due'::"text", 'delayed_review_passed'::"text", 'delayed_review_failed'::"text", 'placement_updated'::"text", 'speaking_assessed'::"text", 'speaking_session_ended'::"text", 'writing_assessed'::"text", 'exam_started'::"text", 'exam_completed'::"text", 'content_approved'::"text", 'context_transfer_passed'::"text", 'competency_mastery_updated'::"text", 'route_changed'::"text", 'profile_activated'::"text", 'appeal_opened'::"text", 'appeal_resolved'::"text", 'activity'::"text"])))
);


ALTER TABLE "public"."learner_events" OWNER TO "postgres";


ALTER TABLE "public"."learner_events" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."learner_events_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."learning_routes" (
    "user_id" "uuid" NOT NULL,
    "route_kind" "text" NOT NULL,
    "start_unit_id" "text",
    "skill_profile" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "reason" "text" NOT NULL,
    "set_by" "uuid",
    "set_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "learning_routes_route_kind_check" CHECK (("route_kind" = ANY (ARRAY['foundations'::"text", 'provisional'::"text", 'verified'::"text", 'manual'::"text"])))
);


ALTER TABLE "public"."learning_routes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lesson_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "unit_id" "text" NOT NULL,
    "unit_hash" "text" NOT NULL,
    "preview" boolean DEFAULT false NOT NULL,
    "status" "text" DEFAULT 'IN_PROGRESS'::"text" NOT NULL,
    "current_step" "text",
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    CONSTRAINT "lesson_sessions_status_check" CHECK (("status" = ANY (ARRAY['IN_PROGRESS'::"text", 'COMPLETED'::"text", 'ABANDONED'::"text"])))
);


ALTER TABLE "public"."lesson_sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."mastery_events" (
    "event_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "competency_id" "text" NOT NULL,
    "attempt_id" "uuid",
    "item_id" "text",
    "event_type" "text" NOT NULL,
    "task_kind" "text",
    "reliable" boolean NOT NULL,
    "meaning_changing" boolean,
    "review_interval_days" integer,
    "supersedes_id" "uuid",
    "local_date" "date" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "mastery_events_event_type_check" CHECK (("event_type" = ANY (ARRAY['independent_correct'::"text", 'independent_incorrect'::"text", 'assisted_observation'::"text", 'review_passed'::"text", 'review_failed'::"text", 'transfer_passed'::"text", 'transfer_failed'::"text", 'compensation'::"text", 'placement_observation'::"text"]))),
    CONSTRAINT "mastery_events_task_kind_check" CHECK (("task_kind" = ANY (ARRAY['recognition'::"text", 'controlled'::"text", 'spontaneous'::"text", 'retention'::"text", 'transfer'::"text"])))
);


ALTER TABLE "public"."mastery_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."media_rights" (
    "id" bigint NOT NULL,
    "example_id" "text" NOT NULL,
    "source_url" "text",
    "owner" "text",
    "license_basis" "text",
    "embed_policy" "text",
    "excerpt_policy" "text",
    "reviewed_on" "date",
    "valid_until" "date",
    "status" "text" NOT NULL,
    CONSTRAINT "media_rights_status_check" CHECK (("status" = ANY (ARRAY['RIGHTS_PENDING'::"text", 'EMBED_ALLOWED'::"text", 'LINK_ONLY'::"text", 'BLOCKED'::"text"])))
);


ALTER TABLE "public"."media_rights" OWNER TO "postgres";


ALTER TABLE "public"."media_rights" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."media_rights_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."pegp_packets" (
    "packet_id" "text" NOT NULL,
    "topic_code" "text",
    "packet_kind" "text" NOT NULL,
    "payload" "jsonb" NOT NULL,
    "current_hash" "text" NOT NULL,
    "revision_id" bigint NOT NULL,
    CONSTRAINT "pegp_packets_packet_kind_check" CHECK (("packet_kind" = ANY (ARRAY['thematic'::"text", 'language_support'::"text"])))
);


ALTER TABLE "public"."pegp_packets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."placement_axis_results" (
    "session_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "axis" "text" NOT NULL,
    "status" "text" NOT NULL,
    "observations" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "candidate_start" "text",
    "confidence" "text",
    "not_observed_reason" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "placement_axis_results_axis_check" CHECK (("axis" = ANY (ARRAY['listening'::"text", 'reading'::"text", 'spoken_interaction'::"text", 'spoken_production'::"text", 'writing'::"text", 'pronunciation'::"text", 'grammar'::"text", 'vocabulary'::"text"]))),
    CONSTRAINT "placement_axis_results_confidence_check" CHECK (("confidence" = ANY (ARRAY['low'::"text", 'medium'::"text", 'high'::"text"]))),
    CONSTRAINT "placement_axis_results_status_check" CHECK (("status" = ANY (ARRAY['IN_PROGRESS'::"text", 'OBSERVED'::"text", 'NOT_OBSERVED'::"text", 'PENDING_REVIEW'::"text", 'STOPPED'::"text", 'NO_RELEASED_CONTENT'::"text"])))
);


ALTER TABLE "public"."placement_axis_results" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."placement_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "entry_path" "text" NOT NULL,
    "protocol_hash" "text" NOT NULL,
    "status" "text" DEFAULT 'IN_PROGRESS'::"text" NOT NULL,
    "state" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "result" "jsonb",
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    CONSTRAINT "placement_sessions_status_check" CHECK (("status" = ANY (ARRAY['IN_PROGRESS'::"text", 'COMPLETED'::"text", 'ABANDONED'::"text"])))
);


ALTER TABLE "public"."placement_sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."preferences" (
    "user_id" "uuid" NOT NULL,
    "reduced_motion" boolean DEFAULT false NOT NULL,
    "relevance" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "speaking_rate" "text" DEFAULT 'normal'::"text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "preferences_speaking_rate_check" CHECK (("speaking_rate" = ANY (ARRAY['slow'::"text", 'normal'::"text"])))
);


ALTER TABLE "public"."preferences" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "user_id" "uuid" NOT NULL,
    "display_name" "text" NOT NULL,
    "email" "text",
    "timezone" "text" DEFAULT 'Europe/Athens'::"text" NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "entry_path" "text",
    "lifecycle_state" "text" DEFAULT 'invited'::"text" NOT NULL,
    "invited_at" timestamp with time zone,
    "activated_at" timestamp with time zone,
    "deactivated_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "profiles_display_name_check" CHECK ((("char_length"("display_name") >= 1) AND ("char_length"("display_name") <= 80))),
    CONSTRAINT "profiles_entry_path_check" CHECK (("entry_path" = ANY (ARRAY['from_zero'::"text", 'prior_learning'::"text", 'unsure'::"text"]))),
    CONSTRAINT "profiles_lifecycle_state_check" CHECK (("lifecycle_state" = ANY (ARRAY['invited'::"text", 'activated'::"text", 'foundations'::"text", 'placement_pending'::"text", 'placement_in_progress'::"text", 'provisional_route'::"text", 'placement_verified'::"text", 'studying'::"text", 'inactive'::"text"])))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."provider_usage" (
    "id" bigint NOT NULL,
    "user_id" "uuid",
    "provider" "text" NOT NULL,
    "operation" "text" NOT NULL,
    "units" numeric DEFAULT 0 NOT NULL,
    "unit_kind" "text" NOT NULL,
    "estimated_cost_usd" numeric DEFAULT 0 NOT NULL,
    "ok" boolean NOT NULL,
    "latency_ms" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."provider_usage" OWNER TO "postgres";


ALTER TABLE "public"."provider_usage" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."provider_usage_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."publication_policies" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "kind" "text" NOT NULL,
    "version" "text" NOT NULL,
    "statement_ru" "text" NOT NULL,
    "risks_acknowledged" "jsonb" NOT NULL,
    "signed_by" "uuid" NOT NULL,
    "signed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "revoked_at" timestamp with time zone,
    "revoked_by" "uuid",
    CONSTRAINT "publication_policies_kind_check" CHECK (("kind" = 'DIGITAL_ONLY_RISK_ACCEPTED'::"text"))
);


ALTER TABLE "public"."publication_policies" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rg_expressions" (
    "expression_id" "text" NOT NULL,
    "expression" "text" NOT NULL,
    "payload" "jsonb" NOT NULL,
    "current_hash" "text" NOT NULL,
    "revision_id" bigint NOT NULL
);


ALTER TABLE "public"."rg_expressions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."role_assignments" (
    "user_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "granted_by" "uuid",
    "granted_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "role_assignments_role_check" CHECK (("role" = ANY (ARRAY['learner'::"text", 'owner_admin'::"text"])))
);


ALTER TABLE "public"."role_assignments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."route_changes" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "previous" "jsonb",
    "next" "jsonb" NOT NULL,
    "reason" "text" NOT NULL,
    "changed_by" "uuid",
    "changed_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."route_changes" OWNER TO "postgres";


ALTER TABLE "public"."route_changes" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."route_changes_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."rubrics" (
    "rubric_id" "text" NOT NULL,
    "refs" "jsonb" NOT NULL,
    "payload" "jsonb" NOT NULL,
    "current_hash" "text" NOT NULL,
    "revision_id" bigint NOT NULL
);


ALTER TABLE "public"."rubrics" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."source_claims" (
    "claim_id" "text" NOT NULL,
    "source_id" "text",
    "status" "text",
    "record" "jsonb" NOT NULL,
    "evidence_path" "text",
    "evidence_file_sha256" "text",
    "current_hash" "text" NOT NULL,
    "revision_id" bigint NOT NULL
);


ALTER TABLE "public"."source_claims" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."spaced_reviews" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "competency_id" "text" NOT NULL,
    "anchor_attempt_id" "uuid" NOT NULL,
    "anchor_item_id" "text" NOT NULL,
    "anchor_local_date" "date" NOT NULL,
    "interval_days" integer NOT NULL,
    "due_local_date" "date" NOT NULL,
    "status" "text" DEFAULT 'due'::"text" NOT NULL,
    "completed_attempt_id" "uuid",
    "completed_local_date" "date",
    "content_hash" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "spaced_reviews_interval_days_check" CHECK (("interval_days" = ANY (ARRAY[1, 3, 7, 14, 28]))),
    CONSTRAINT "spaced_reviews_status_check" CHECK (("status" = ANY (ARRAY['due'::"text", 'passed'::"text", 'failed'::"text", 'assisted'::"text", 'superseded'::"text"])))
);


ALTER TABLE "public"."spaced_reviews" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."speaking_scenarios" (
    "scenario_id" "text" NOT NULL,
    "level" "text",
    "domain" "text",
    "objective_ru" "text",
    "competency_ids" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "payload" "jsonb" NOT NULL,
    "current_hash" "text" NOT NULL,
    "revision_id" bigint NOT NULL
);


ALTER TABLE "public"."speaking_scenarios" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."speaking_sessions" (
    "session_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "scenario_id" "text" NOT NULL,
    "scenario_hash" "text" NOT NULL,
    "mode" "text" NOT NULL,
    "input_mode" "text" NOT NULL,
    "status" "text" DEFAULT 'ACTIVE'::"text" NOT NULL,
    "current_node" "text",
    "repair_loops" integer DEFAULT 0 NOT NULL,
    "consent_id" "uuid",
    "provider_snapshot" "jsonb" NOT NULL,
    "preview" boolean DEFAULT false NOT NULL,
    "summary_private" "jsonb",
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ended_at" timestamp with time zone,
    "local_date" "date" NOT NULL,
    "voice_persona" "text",
    "transport" "text" DEFAULT 'batch'::"text" NOT NULL,
    CONSTRAINT "speaking_sessions_input_mode_check" CHECK (("input_mode" = ANY (ARRAY['voice'::"text", 'text_fallback'::"text"]))),
    CONSTRAINT "speaking_sessions_mode_check" CHECK (("mode" = ANY (ARRAY['a0_guided'::"text", 'course'::"text", 'roleplay'::"text", 'free_talk'::"text", 'tutor_help'::"text", 'b2_mock'::"text", 'real_greek'::"text"]))),
    CONSTRAINT "speaking_sessions_status_check" CHECK (("status" = ANY (ARRAY['ACTIVE'::"text", 'PAUSED'::"text", 'ENDED'::"text", 'FAILED'::"text"]))),
    CONSTRAINT "speaking_sessions_transport_check" CHECK (("transport" = ANY (ARRAY['batch'::"text", 'stream_local_gateway'::"text", 'stream_cloud_gateway'::"text"])))
);


ALTER TABLE "public"."speaking_sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."speaking_turn_metrics" (
    "id" bigint NOT NULL,
    "session_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "turn_seq" integer NOT NULL,
    "transport" "text" NOT NULL,
    "asr_engine" "text",
    "tts_engine" "text",
    "dialogue_engine" "text",
    "speech_ms" integer,
    "vad_hangover_ms" integer,
    "asr_partial_first_ms" integer,
    "asr_final_ms" integer,
    "llm_first_token_ms" integer,
    "tts_first_audio_ms" integer,
    "playback_start_ms" integer,
    "end_of_speech_to_audio_ms" integer,
    "interrupted" boolean DEFAULT false NOT NULL,
    "heard_ms" integer,
    "input_source" "text" DEFAULT 'microphone'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "listen_ready_ms" integer,
    CONSTRAINT "speaking_turn_metrics_input_source_check" CHECK (("input_source" = ANY (ARRAY['microphone'::"text", 'synthetic_test_clip'::"text"])))
);


ALTER TABLE "public"."speaking_turn_metrics" OWNER TO "postgres";


ALTER TABLE "public"."speaking_turn_metrics" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."speaking_turn_metrics_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."speaking_turns" (
    "turn_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "session_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "seq" integer NOT NULL,
    "speaker" "text" NOT NULL,
    "node_id" "text",
    "text_el" "text",
    "asr_text" "text",
    "asr_confidence" real,
    "asr_provider" "text",
    "transcript_confirmed" boolean DEFAULT false NOT NULL,
    "interrupted" boolean DEFAULT false NOT NULL,
    "playback_completed" boolean,
    "intent" "text",
    "language_segments" "jsonb",
    "help_used" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "audio_artifact_id" "uuid",
    "idempotency_key" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "heard_text" "text",
    "heard_ms" integer,
    CONSTRAINT "speaking_turns_speaker_check" CHECK (("speaker" = ANY (ARRAY['learner'::"text", 'assistant'::"text"])))
);


ALTER TABLE "public"."speaking_turns" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."units" (
    "unit_id" "text" NOT NULL,
    "level" "text" NOT NULL,
    "sort_key" integer NOT NULL,
    "title_ru" "text" NOT NULL,
    "prerequisites" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "soft_prerequisites" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "competency_ids" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "primary_competencies" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "estimated_active_minutes" integer,
    "teaching" "jsonb" NOT NULL,
    "current_hash" "text" NOT NULL,
    "revision_id" bigint NOT NULL,
    CONSTRAINT "units_level_check" CHECK (("level" = ANY (ARRAY['A1'::"text", 'A2'::"text", 'B1'::"text", 'B2'::"text"])))
);


ALTER TABLE "public"."units" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."voice_artifacts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "session_id" "uuid",
    "consent_id" "uuid" NOT NULL,
    "object_path" "text" NOT NULL,
    "retention_until" timestamp with time zone NOT NULL,
    "deleted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."voice_artifacts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."voice_catalog" (
    "voice_id" "text" NOT NULL,
    "provider" "text" NOT NULL,
    "provider_voice_name" "text" NOT NULL,
    "display_name" "text" NOT NULL,
    "locale" "text" DEFAULT 'el-GR'::"text" NOT NULL,
    "presentation" "text" NOT NULL,
    "presentation_source" "text" NOT NULL,
    "quality_tier" "text",
    "engine_kind" "text" NOT NULL,
    "available" boolean DEFAULT false NOT NULL,
    "streaming_capable" boolean DEFAULT false NOT NULL,
    "speed_profile" "jsonb" DEFAULT '{"fast": 1.1, "slow": 0.88, "normal": 1.0}'::"jsonb" NOT NULL,
    "style_support" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "version" "text",
    "rights" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "distribution_allowed" boolean DEFAULT false NOT NULL,
    "sample_object_path" "text",
    "sample_sha256" "text",
    "approved_by_owner" boolean DEFAULT false NOT NULL,
    "approved_by" "uuid",
    "approved_at" timestamp with time zone,
    "qa_status" "text" DEFAULT 'NOT_TESTED'::"text" NOT NULL,
    "last_synced_at" timestamp with time zone,
    "notes" "text",
    CONSTRAINT "voice_catalog_check" CHECK ((("provider" <> 'mock'::"text") OR (("distribution_allowed" = false) AND ("approved_by_owner" = false)))),
    CONSTRAINT "voice_catalog_engine_kind_check" CHECK (("engine_kind" = ANY (ARRAY['local'::"text", 'cloud'::"text", 'test'::"text"]))),
    CONSTRAINT "voice_catalog_presentation_check" CHECK (("presentation" = ANY (ARRAY['female'::"text", 'male'::"text", 'other'::"text", 'unspecified'::"text"]))),
    CONSTRAINT "voice_catalog_provider_check" CHECK (("provider" = ANY (ARRAY['local_macos'::"text", 'azure'::"text", 'google'::"text", 'openai'::"text", 'mock'::"text"]))),
    CONSTRAINT "voice_catalog_qa_status_check" CHECK (("qa_status" = ANY (ARRAY['NOT_TESTED'::"text", 'TECH_QA_PASS'::"text", 'TECH_QA_FAIL'::"text", 'OWNER_LISTENED'::"text", 'REJECTED'::"text"])))
);


ALTER TABLE "public"."voice_catalog" OWNER TO "postgres";


ALTER TABLE ONLY "public"."activity_days"
    ADD CONSTRAINT "activity_days_pkey" PRIMARY KEY ("user_id", "local_date");



ALTER TABLE ONLY "public"."admin_audit_log"
    ADD CONSTRAINT "admin_audit_log_pkey" PRIMARY KEY ("event_id");



ALTER TABLE ONLY "public"."appeals"
    ADD CONSTRAINT "appeals_assessment_id_key" UNIQUE ("assessment_id");



ALTER TABLE ONLY "public"."appeals"
    ADD CONSTRAINT "appeals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."assessments"
    ADD CONSTRAINT "assessments_pkey" PRIMARY KEY ("assessment_id");



ALTER TABLE ONLY "public"."attempts"
    ADD CONSTRAINT "attempts_pkey" PRIMARY KEY ("attempt_id");



ALTER TABLE ONLY "public"."attempts"
    ADD CONSTRAINT "attempts_user_id_idempotency_key_key" UNIQUE ("user_id", "idempotency_key");



ALTER TABLE ONLY "public"."audio_assets"
    ADD CONSTRAINT "audio_assets_idempotency_key_key" UNIQUE ("idempotency_key");



ALTER TABLE ONLY "public"."audio_assets"
    ADD CONSTRAINT "audio_assets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."audio_job_casting"
    ADD CONSTRAINT "audio_job_casting_pkey" PRIMARY KEY ("audio_id", "speaker_role");



ALTER TABLE ONLY "public"."audio_job_render_status"
    ADD CONSTRAINT "audio_job_render_status_pkey" PRIMARY KEY ("audio_id");



ALTER TABLE ONLY "public"."audio_jobs"
    ADD CONSTRAINT "audio_jobs_pkey" PRIMARY KEY ("audio_id");



ALTER TABLE ONLY "public"."cast_roles"
    ADD CONSTRAINT "cast_roles_pkey" PRIMARY KEY ("cast_role_id");



ALTER TABLE ONLY "public"."competencies"
    ADD CONSTRAINT "competencies_pkey" PRIMARY KEY ("competency_id");



ALTER TABLE ONLY "public"."competency_state"
    ADD CONSTRAINT "competency_state_pkey" PRIMARY KEY ("user_id", "competency_id");



ALTER TABLE ONLY "public"."consents"
    ADD CONSTRAINT "consents_pkey" PRIMARY KEY ("consent_id");



ALTER TABLE ONLY "public"."content_examples"
    ADD CONSTRAINT "content_examples_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."content_objects"
    ADD CONSTRAINT "content_objects_pkey" PRIMARY KEY ("object_id");



ALTER TABLE ONLY "public"."content_releases"
    ADD CONSTRAINT "content_releases_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."content_revisions"
    ADD CONSTRAINT "content_revisions_content_kind_content_id_content_hash_key" UNIQUE ("content_kind", "content_id", "content_hash");



ALTER TABLE ONLY "public"."content_revisions"
    ADD CONSTRAINT "content_revisions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."content_singletons"
    ADD CONSTRAINT "content_singletons_pkey" PRIMARY KEY ("singleton_id");



ALTER TABLE ONLY "public"."context_transfer_attempts"
    ADD CONSTRAINT "context_transfer_attempts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."digital_qa_runs"
    ADD CONSTRAINT "digital_qa_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."enrollments"
    ADD CONSTRAINT "enrollments_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."error_evidence"
    ADD CONSTRAINT "error_evidence_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."exam_attempts"
    ADD CONSTRAINT "exam_attempts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."exam_attempts"
    ADD CONSTRAINT "exam_attempts_user_id_idempotency_key_key" UNIQUE ("user_id", "idempotency_key");



ALTER TABLE ONLY "public"."exam_components"
    ADD CONSTRAINT "exam_components_pkey" PRIMARY KEY ("component_id");



ALTER TABLE ONLY "public"."exam_forms"
    ADD CONSTRAINT "exam_forms_pkey" PRIMARY KEY ("form_id");



ALTER TABLE ONLY "public"."example_review_events"
    ADD CONSTRAINT "example_review_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."example_variants"
    ADD CONSTRAINT "example_variants_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."feedback_events"
    ADD CONSTRAINT "feedback_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."idempotency_keys"
    ADD CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("user_id", "key");



ALTER TABLE ONLY "public"."import_quarantine"
    ADD CONSTRAINT "import_quarantine_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."import_runs"
    ADD CONSTRAINT "import_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."item_audio"
    ADD CONSTRAINT "item_audio_pkey" PRIMARY KEY ("item_id", "audio_id");



ALTER TABLE ONLY "public"."item_competencies"
    ADD CONSTRAINT "item_competencies_pkey" PRIMARY KEY ("item_id", "competency_id", "relation");



ALTER TABLE ONLY "public"."item_sources"
    ADD CONSTRAINT "item_sources_pkey" PRIMARY KEY ("item_id", "claim_id");



ALTER TABLE ONLY "public"."items"
    ADD CONSTRAINT "items_pkey" PRIMARY KEY ("item_id");



ALTER TABLE ONLY "public"."learner_events"
    ADD CONSTRAINT "learner_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."learner_events"
    ADD CONSTRAINT "learner_events_user_id_event_type_idempotency_key_key" UNIQUE ("user_id", "event_type", "idempotency_key");



ALTER TABLE ONLY "public"."learning_routes"
    ADD CONSTRAINT "learning_routes_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."lesson_sessions"
    ADD CONSTRAINT "lesson_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mastery_events"
    ADD CONSTRAINT "mastery_events_pkey" PRIMARY KEY ("event_id");



ALTER TABLE ONLY "public"."media_rights"
    ADD CONSTRAINT "media_rights_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pegp_packets"
    ADD CONSTRAINT "pegp_packets_pkey" PRIMARY KEY ("packet_id");



ALTER TABLE ONLY "public"."placement_axis_results"
    ADD CONSTRAINT "placement_axis_results_pkey" PRIMARY KEY ("session_id", "axis");



ALTER TABLE ONLY "public"."placement_sessions"
    ADD CONSTRAINT "placement_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."preferences"
    ADD CONSTRAINT "preferences_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."provider_usage"
    ADD CONSTRAINT "provider_usage_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."publication_policies"
    ADD CONSTRAINT "publication_policies_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rg_expressions"
    ADD CONSTRAINT "rg_expressions_pkey" PRIMARY KEY ("expression_id");



ALTER TABLE ONLY "public"."role_assignments"
    ADD CONSTRAINT "role_assignments_pkey" PRIMARY KEY ("user_id", "role");



ALTER TABLE ONLY "public"."route_changes"
    ADD CONSTRAINT "route_changes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rubrics"
    ADD CONSTRAINT "rubrics_pkey" PRIMARY KEY ("rubric_id");



ALTER TABLE ONLY "public"."source_claims"
    ADD CONSTRAINT "source_claims_pkey" PRIMARY KEY ("claim_id");



ALTER TABLE ONLY "public"."spaced_reviews"
    ADD CONSTRAINT "spaced_reviews_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."spaced_reviews"
    ADD CONSTRAINT "spaced_reviews_user_id_competency_id_anchor_attempt_id_inte_key" UNIQUE ("user_id", "competency_id", "anchor_attempt_id", "interval_days");



ALTER TABLE ONLY "public"."speaking_scenarios"
    ADD CONSTRAINT "speaking_scenarios_pkey" PRIMARY KEY ("scenario_id");



ALTER TABLE ONLY "public"."speaking_sessions"
    ADD CONSTRAINT "speaking_sessions_pkey" PRIMARY KEY ("session_id");



ALTER TABLE ONLY "public"."speaking_turn_metrics"
    ADD CONSTRAINT "speaking_turn_metrics_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."speaking_turn_metrics"
    ADD CONSTRAINT "speaking_turn_metrics_session_id_turn_seq_key" UNIQUE ("session_id", "turn_seq");



ALTER TABLE ONLY "public"."speaking_turns"
    ADD CONSTRAINT "speaking_turns_pkey" PRIMARY KEY ("turn_id");



ALTER TABLE ONLY "public"."speaking_turns"
    ADD CONSTRAINT "speaking_turns_session_id_seq_key" UNIQUE ("session_id", "seq");



ALTER TABLE ONLY "public"."speaking_turns"
    ADD CONSTRAINT "speaking_turns_user_id_idempotency_key_key" UNIQUE ("user_id", "idempotency_key");



ALTER TABLE ONLY "public"."units"
    ADD CONSTRAINT "units_pkey" PRIMARY KEY ("unit_id");



ALTER TABLE ONLY "public"."voice_artifacts"
    ADD CONSTRAINT "voice_artifacts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."voice_catalog"
    ADD CONSTRAINT "voice_catalog_pkey" PRIMARY KEY ("voice_id");



CREATE INDEX "assessments_attempt" ON "public"."assessments" USING "btree" ("attempt_id");



CREATE INDEX "assessments_user" ON "public"."assessments" USING "btree" ("user_id", "created_at");



CREATE INDEX "attempts_user_item" ON "public"."attempts" USING "btree" ("user_id", "item_id", "created_at");



CREATE INDEX "audio_assets_job" ON "public"."audio_assets" USING "btree" ("audio_id") WHERE ("invalidated_at" IS NULL);



CREATE INDEX "content_releases_lookup" ON "public"."content_releases" USING "btree" ("content_kind", "content_id", "content_hash") WHERE ("revoked_at" IS NULL);



CREATE INDEX "digital_qa_runs_lookup" ON "public"."digital_qa_runs" USING "btree" ("content_kind", "content_id", "content_hash");



CREATE INDEX "error_evidence_user" ON "public"."error_evidence" USING "btree" ("user_id", "status", "created_at");



CREATE INDEX "items_competencies_idx" ON "public"."items" USING "gin" ("competency_ids");



CREATE INDEX "items_module_idx" ON "public"."items" USING "btree" ("module");



CREATE INDEX "items_unit_idx" ON "public"."items" USING "btree" ("unit_id");



CREATE INDEX "learner_events_user" ON "public"."learner_events" USING "btree" ("user_id", "occurred_at" DESC);



CREATE INDEX "lesson_sessions_user" ON "public"."lesson_sessions" USING "btree" ("user_id", "unit_id");



CREATE INDEX "mastery_events_user_comp" ON "public"."mastery_events" USING "btree" ("user_id", "competency_id", "created_at");



CREATE INDEX "provider_usage_day" ON "public"."provider_usage" USING "btree" ("created_at");



CREATE INDEX "spaced_reviews_due" ON "public"."spaced_reviews" USING "btree" ("user_id", "status", "due_local_date");



CREATE INDEX "speaking_turn_metrics_created" ON "public"."speaking_turn_metrics" USING "btree" ("created_at");



CREATE OR REPLACE TRIGGER "admin_audit_log_append_only" BEFORE DELETE OR UPDATE ON "public"."admin_audit_log" FOR EACH ROW EXECUTE FUNCTION "app_private"."forbid_mutation"();



CREATE OR REPLACE TRIGGER "content_revisions_immutable" BEFORE DELETE OR UPDATE ON "public"."content_revisions" FOR EACH ROW EXECUTE FUNCTION "app_private"."forbid_mutation"();



ALTER TABLE ONLY "public"."activity_days"
    ADD CONSTRAINT "activity_days_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."appeals"
    ADD CONSTRAINT "appeals_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("assessment_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."appeals"
    ADD CONSTRAINT "appeals_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."appeals"
    ADD CONSTRAINT "appeals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."assessments"
    ADD CONSTRAINT "assessments_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "public"."attempts"("attempt_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."assessments"
    ADD CONSTRAINT "assessments_supersedes_id_fkey" FOREIGN KEY ("supersedes_id") REFERENCES "public"."assessments"("assessment_id");



ALTER TABLE ONLY "public"."assessments"
    ADD CONSTRAINT "assessments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."attempts"
    ADD CONSTRAINT "attempts_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."items"("item_id");



ALTER TABLE ONLY "public"."attempts"
    ADD CONSTRAINT "attempts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."audio_assets"
    ADD CONSTRAINT "audio_assets_audio_id_fkey" FOREIGN KEY ("audio_id") REFERENCES "public"."audio_jobs"("audio_id");



ALTER TABLE ONLY "public"."audio_assets"
    ADD CONSTRAINT "audio_assets_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."audio_job_casting"
    ADD CONSTRAINT "audio_job_casting_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."audio_job_casting"
    ADD CONSTRAINT "audio_job_casting_audio_id_fkey" FOREIGN KEY ("audio_id") REFERENCES "public"."audio_jobs"("audio_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."audio_job_casting"
    ADD CONSTRAINT "audio_job_casting_cast_role_id_fkey" FOREIGN KEY ("cast_role_id") REFERENCES "public"."cast_roles"("cast_role_id");



ALTER TABLE ONLY "public"."audio_job_render_status"
    ADD CONSTRAINT "audio_job_render_status_audio_id_fkey" FOREIGN KEY ("audio_id") REFERENCES "public"."audio_jobs"("audio_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."audio_job_render_status"
    ADD CONSTRAINT "audio_job_render_status_last_asset_id_fkey" FOREIGN KEY ("last_asset_id") REFERENCES "public"."audio_assets"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."audio_jobs"
    ADD CONSTRAINT "audio_jobs_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "public"."content_revisions"("id");



ALTER TABLE ONLY "public"."cast_roles"
    ADD CONSTRAINT "cast_roles_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cast_roles"
    ADD CONSTRAINT "cast_roles_voice_id_fkey" FOREIGN KEY ("voice_id") REFERENCES "public"."voice_catalog"("voice_id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."competencies"
    ADD CONSTRAINT "competencies_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "public"."content_revisions"("id");



ALTER TABLE ONLY "public"."competency_state"
    ADD CONSTRAINT "competency_state_competency_id_fkey" FOREIGN KEY ("competency_id") REFERENCES "public"."competencies"("competency_id");



ALTER TABLE ONLY "public"."competency_state"
    ADD CONSTRAINT "competency_state_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."consents"
    ADD CONSTRAINT "consents_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."consents"
    ADD CONSTRAINT "consents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."content_examples"
    ADD CONSTRAINT "content_examples_competency_id_fkey" FOREIGN KEY ("competency_id") REFERENCES "public"."competencies"("competency_id");



ALTER TABLE ONLY "public"."content_objects"
    ADD CONSTRAINT "content_objects_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "public"."content_revisions"("id");



ALTER TABLE ONLY "public"."content_releases"
    ADD CONSTRAINT "content_releases_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "public"."publication_policies"("id");



ALTER TABLE ONLY "public"."content_releases"
    ADD CONSTRAINT "content_releases_reviewer_user_id_fkey" FOREIGN KEY ("reviewer_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."content_revisions"
    ADD CONSTRAINT "content_revisions_import_run_id_fkey" FOREIGN KEY ("import_run_id") REFERENCES "public"."import_runs"("id");



ALTER TABLE ONLY "public"."content_singletons"
    ADD CONSTRAINT "content_singletons_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "public"."content_revisions"("id");



ALTER TABLE ONLY "public"."context_transfer_attempts"
    ADD CONSTRAINT "context_transfer_attempts_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "public"."attempts"("attempt_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."context_transfer_attempts"
    ADD CONSTRAINT "context_transfer_attempts_feedback_event_id_fkey" FOREIGN KEY ("feedback_event_id") REFERENCES "public"."feedback_events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."context_transfer_attempts"
    ADD CONSTRAINT "context_transfer_attempts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."digital_qa_runs"
    ADD CONSTRAINT "digital_qa_runs_run_by_fkey" FOREIGN KEY ("run_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."enrollments"
    ADD CONSTRAINT "enrollments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."error_evidence"
    ADD CONSTRAINT "error_evidence_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("assessment_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."error_evidence"
    ADD CONSTRAINT "error_evidence_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "public"."attempts"("attempt_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."error_evidence"
    ADD CONSTRAINT "error_evidence_competency_id_fkey" FOREIGN KEY ("competency_id") REFERENCES "public"."competencies"("competency_id");



ALTER TABLE ONLY "public"."error_evidence"
    ADD CONSTRAINT "error_evidence_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."exam_attempts"
    ADD CONSTRAINT "exam_attempts_component_id_fkey" FOREIGN KEY ("component_id") REFERENCES "public"."exam_components"("component_id");



ALTER TABLE ONLY "public"."exam_attempts"
    ADD CONSTRAINT "exam_attempts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."exam_components"
    ADD CONSTRAINT "exam_components_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "public"."exam_forms"("form_id");



ALTER TABLE ONLY "public"."exam_components"
    ADD CONSTRAINT "exam_components_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "public"."content_revisions"("id");



ALTER TABLE ONLY "public"."exam_forms"
    ADD CONSTRAINT "exam_forms_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "public"."content_revisions"("id");



ALTER TABLE ONLY "public"."example_review_events"
    ADD CONSTRAINT "example_review_events_example_id_fkey" FOREIGN KEY ("example_id") REFERENCES "public"."content_examples"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."example_variants"
    ADD CONSTRAINT "example_variants_example_id_fkey" FOREIGN KEY ("example_id") REFERENCES "public"."content_examples"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."feedback_events"
    ADD CONSTRAINT "feedback_events_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "public"."attempts"("attempt_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."feedback_events"
    ADD CONSTRAINT "feedback_events_competency_id_fkey" FOREIGN KEY ("competency_id") REFERENCES "public"."competencies"("competency_id");



ALTER TABLE ONLY "public"."feedback_events"
    ADD CONSTRAINT "feedback_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."idempotency_keys"
    ADD CONSTRAINT "idempotency_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."import_quarantine"
    ADD CONSTRAINT "import_quarantine_import_run_id_fkey" FOREIGN KEY ("import_run_id") REFERENCES "public"."import_runs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_invited_user_id_fkey" FOREIGN KEY ("invited_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."item_audio"
    ADD CONSTRAINT "item_audio_audio_id_fkey" FOREIGN KEY ("audio_id") REFERENCES "public"."audio_jobs"("audio_id");



ALTER TABLE ONLY "public"."item_audio"
    ADD CONSTRAINT "item_audio_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."items"("item_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."item_competencies"
    ADD CONSTRAINT "item_competencies_competency_id_fkey" FOREIGN KEY ("competency_id") REFERENCES "public"."competencies"("competency_id");



ALTER TABLE ONLY "public"."item_competencies"
    ADD CONSTRAINT "item_competencies_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."items"("item_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."item_sources"
    ADD CONSTRAINT "item_sources_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "public"."source_claims"("claim_id");



ALTER TABLE ONLY "public"."item_sources"
    ADD CONSTRAINT "item_sources_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."items"("item_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."items"
    ADD CONSTRAINT "items_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "public"."content_revisions"("id");



ALTER TABLE ONLY "public"."items"
    ADD CONSTRAINT "items_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("unit_id");



ALTER TABLE ONLY "public"."learner_events"
    ADD CONSTRAINT "learner_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."learning_routes"
    ADD CONSTRAINT "learning_routes_set_by_fkey" FOREIGN KEY ("set_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."learning_routes"
    ADD CONSTRAINT "learning_routes_start_unit_id_fkey" FOREIGN KEY ("start_unit_id") REFERENCES "public"."units"("unit_id");



ALTER TABLE ONLY "public"."learning_routes"
    ADD CONSTRAINT "learning_routes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lesson_sessions"
    ADD CONSTRAINT "lesson_sessions_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("unit_id");



ALTER TABLE ONLY "public"."lesson_sessions"
    ADD CONSTRAINT "lesson_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."mastery_events"
    ADD CONSTRAINT "mastery_events_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "public"."attempts"("attempt_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."mastery_events"
    ADD CONSTRAINT "mastery_events_competency_id_fkey" FOREIGN KEY ("competency_id") REFERENCES "public"."competencies"("competency_id");



ALTER TABLE ONLY "public"."mastery_events"
    ADD CONSTRAINT "mastery_events_supersedes_id_fkey" FOREIGN KEY ("supersedes_id") REFERENCES "public"."mastery_events"("event_id");



ALTER TABLE ONLY "public"."mastery_events"
    ADD CONSTRAINT "mastery_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."media_rights"
    ADD CONSTRAINT "media_rights_example_id_fkey" FOREIGN KEY ("example_id") REFERENCES "public"."content_examples"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pegp_packets"
    ADD CONSTRAINT "pegp_packets_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "public"."content_revisions"("id");



ALTER TABLE ONLY "public"."placement_axis_results"
    ADD CONSTRAINT "placement_axis_results_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."placement_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."placement_axis_results"
    ADD CONSTRAINT "placement_axis_results_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."placement_sessions"
    ADD CONSTRAINT "placement_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."preferences"
    ADD CONSTRAINT "preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."provider_usage"
    ADD CONSTRAINT "provider_usage_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."publication_policies"
    ADD CONSTRAINT "publication_policies_revoked_by_fkey" FOREIGN KEY ("revoked_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."publication_policies"
    ADD CONSTRAINT "publication_policies_signed_by_fkey" FOREIGN KEY ("signed_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."rg_expressions"
    ADD CONSTRAINT "rg_expressions_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "public"."content_revisions"("id");



ALTER TABLE ONLY "public"."role_assignments"
    ADD CONSTRAINT "role_assignments_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."role_assignments"
    ADD CONSTRAINT "role_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."route_changes"
    ADD CONSTRAINT "route_changes_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."route_changes"
    ADD CONSTRAINT "route_changes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rubrics"
    ADD CONSTRAINT "rubrics_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "public"."content_revisions"("id");



ALTER TABLE ONLY "public"."source_claims"
    ADD CONSTRAINT "source_claims_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "public"."content_revisions"("id");



ALTER TABLE ONLY "public"."spaced_reviews"
    ADD CONSTRAINT "spaced_reviews_anchor_attempt_id_fkey" FOREIGN KEY ("anchor_attempt_id") REFERENCES "public"."attempts"("attempt_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."spaced_reviews"
    ADD CONSTRAINT "spaced_reviews_competency_id_fkey" FOREIGN KEY ("competency_id") REFERENCES "public"."competencies"("competency_id");



ALTER TABLE ONLY "public"."spaced_reviews"
    ADD CONSTRAINT "spaced_reviews_completed_attempt_id_fkey" FOREIGN KEY ("completed_attempt_id") REFERENCES "public"."attempts"("attempt_id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."spaced_reviews"
    ADD CONSTRAINT "spaced_reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."speaking_scenarios"
    ADD CONSTRAINT "speaking_scenarios_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "public"."content_revisions"("id");



ALTER TABLE ONLY "public"."speaking_sessions"
    ADD CONSTRAINT "speaking_sessions_consent_id_fkey" FOREIGN KEY ("consent_id") REFERENCES "public"."consents"("consent_id");



ALTER TABLE ONLY "public"."speaking_sessions"
    ADD CONSTRAINT "speaking_sessions_scenario_id_fkey" FOREIGN KEY ("scenario_id") REFERENCES "public"."speaking_scenarios"("scenario_id");



ALTER TABLE ONLY "public"."speaking_sessions"
    ADD CONSTRAINT "speaking_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."speaking_sessions"
    ADD CONSTRAINT "speaking_sessions_voice_persona_fkey" FOREIGN KEY ("voice_persona") REFERENCES "public"."cast_roles"("cast_role_id");



ALTER TABLE ONLY "public"."speaking_turn_metrics"
    ADD CONSTRAINT "speaking_turn_metrics_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."speaking_sessions"("session_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."speaking_turn_metrics"
    ADD CONSTRAINT "speaking_turn_metrics_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."speaking_turns"
    ADD CONSTRAINT "speaking_turns_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."speaking_sessions"("session_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."speaking_turns"
    ADD CONSTRAINT "speaking_turns_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."units"
    ADD CONSTRAINT "units_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "public"."content_revisions"("id");



ALTER TABLE ONLY "public"."voice_artifacts"
    ADD CONSTRAINT "voice_artifacts_consent_id_fkey" FOREIGN KEY ("consent_id") REFERENCES "public"."consents"("consent_id");



ALTER TABLE ONLY "public"."voice_artifacts"
    ADD CONSTRAINT "voice_artifacts_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."speaking_sessions"("session_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."voice_artifacts"
    ADD CONSTRAINT "voice_artifacts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."voice_catalog"
    ADD CONSTRAINT "voice_catalog_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE "public"."activity_days" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "activity_days_select_own" ON "public"."activity_days" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "app_private"."is_active_user"(( SELECT "auth"."uid"() AS "uid"))));



ALTER TABLE "public"."admin_audit_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."appeals" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "appeals_select_own" ON "public"."appeals" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "app_private"."is_active_user"(( SELECT "auth"."uid"() AS "uid"))));



ALTER TABLE "public"."assessments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "assessments_select_own" ON "public"."assessments" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "app_private"."is_active_user"(( SELECT "auth"."uid"() AS "uid"))));



ALTER TABLE "public"."attempts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "attempts_select_own" ON "public"."attempts" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "app_private"."is_active_user"(( SELECT "auth"."uid"() AS "uid"))));



ALTER TABLE "public"."audio_assets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."audio_job_casting" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."audio_job_render_status" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."audio_jobs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cast_roles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."competencies" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."competency_state" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "competency_state_select_own" ON "public"."competency_state" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "app_private"."is_active_user"(( SELECT "auth"."uid"() AS "uid"))));



ALTER TABLE "public"."consents" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "consents_select_own" ON "public"."consents" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "app_private"."is_active_user"(( SELECT "auth"."uid"() AS "uid"))));



ALTER TABLE "public"."content_examples" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."content_objects" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."content_releases" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."content_revisions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."content_singletons" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."context_transfer_attempts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "context_transfer_attempts_select_own" ON "public"."context_transfer_attempts" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "app_private"."is_active_user"(( SELECT "auth"."uid"() AS "uid"))));



ALTER TABLE "public"."digital_qa_runs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."enrollments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "enrollments_select_own" ON "public"."enrollments" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "app_private"."is_active_user"(( SELECT "auth"."uid"() AS "uid"))));



ALTER TABLE "public"."error_evidence" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "error_evidence_select_own" ON "public"."error_evidence" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "app_private"."is_active_user"(( SELECT "auth"."uid"() AS "uid"))));



ALTER TABLE "public"."exam_attempts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "exam_attempts_select_own" ON "public"."exam_attempts" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "app_private"."is_active_user"(( SELECT "auth"."uid"() AS "uid"))));



ALTER TABLE "public"."exam_components" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."exam_forms" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."example_review_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."example_variants" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."feedback_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "feedback_events_select_own" ON "public"."feedback_events" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "app_private"."is_active_user"(( SELECT "auth"."uid"() AS "uid"))));



ALTER TABLE "public"."idempotency_keys" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."import_quarantine" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."import_runs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."invitations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."item_audio" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."item_competencies" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."item_sources" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."learner_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "learner_events_select" ON "public"."learner_events" FOR SELECT TO "authenticated" USING (((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "app_private"."is_active_user"(( SELECT "auth"."uid"() AS "uid"))) OR "app_private"."is_owner_admin"(( SELECT "auth"."uid"() AS "uid"))));



ALTER TABLE "public"."learning_routes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "learning_routes_select_own" ON "public"."learning_routes" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "app_private"."is_active_user"(( SELECT "auth"."uid"() AS "uid"))));



ALTER TABLE "public"."lesson_sessions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "lesson_sessions_select_own" ON "public"."lesson_sessions" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "app_private"."is_active_user"(( SELECT "auth"."uid"() AS "uid"))));



ALTER TABLE "public"."mastery_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "mastery_events_select_own" ON "public"."mastery_events" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "app_private"."is_active_user"(( SELECT "auth"."uid"() AS "uid"))));



ALTER TABLE "public"."media_rights" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."pegp_packets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."placement_axis_results" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "placement_axis_results_select_own" ON "public"."placement_axis_results" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "app_private"."is_active_user"(( SELECT "auth"."uid"() AS "uid"))));



ALTER TABLE "public"."placement_sessions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "placement_sessions_select_own" ON "public"."placement_sessions" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "app_private"."is_active_user"(( SELECT "auth"."uid"() AS "uid"))));



ALTER TABLE "public"."preferences" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "preferences_select_own" ON "public"."preferences" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "app_private"."is_active_user"(( SELECT "auth"."uid"() AS "uid"))));



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_select_own_or_owner" ON "public"."profiles" FOR SELECT TO "authenticated" USING (((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "active") OR "app_private"."is_owner_admin"(( SELECT "auth"."uid"() AS "uid"))));



ALTER TABLE "public"."provider_usage" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."publication_policies" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rg_expressions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."role_assignments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "role_assignments_select_own" ON "public"."role_assignments" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "app_private"."is_active_user"(( SELECT "auth"."uid"() AS "uid"))));



ALTER TABLE "public"."route_changes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rubrics" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."source_claims" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."spaced_reviews" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "spaced_reviews_select_own" ON "public"."spaced_reviews" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "app_private"."is_active_user"(( SELECT "auth"."uid"() AS "uid"))));



ALTER TABLE "public"."speaking_scenarios" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."speaking_sessions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "speaking_sessions_select_own" ON "public"."speaking_sessions" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "app_private"."is_active_user"(( SELECT "auth"."uid"() AS "uid"))));



ALTER TABLE "public"."speaking_turn_metrics" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "speaking_turn_metrics_select_own" ON "public"."speaking_turn_metrics" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "app_private"."is_active_user"(( SELECT "auth"."uid"() AS "uid"))));



ALTER TABLE "public"."speaking_turns" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "speaking_turns_select_own" ON "public"."speaking_turns" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "app_private"."is_active_user"(( SELECT "auth"."uid"() AS "uid"))));



ALTER TABLE "public"."units" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."voice_artifacts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "voice_artifacts_select_own" ON "public"."voice_artifacts" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "app_private"."is_active_user"(( SELECT "auth"."uid"() AS "uid"))));



ALTER TABLE "public"."voice_catalog" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."learner_events";



GRANT USAGE ON SCHEMA "app_private" TO "authenticated";
GRANT USAGE ON SCHEMA "app_private" TO "service_role";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



REVOKE ALL ON FUNCTION "app_private"."assert_owner_rows"("uid" "uuid", "rows" "jsonb", "label" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "app_private"."assert_owner_rows"("uid" "uuid", "rows" "jsonb", "label" "text") TO "service_role";



GRANT ALL ON FUNCTION "app_private"."is_active_user"("uid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "app_private"."is_active_user"("uid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "app_private"."is_owner_admin"("uid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "app_private"."is_owner_admin"("uid" "uuid") TO "service_role";






















































































































































REVOKE ALL ON FUNCTION "public"."admin_revoke_user_sessions"("target" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_revoke_user_sessions"("target" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."commit_learning_event"("p" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."commit_learning_event"("p" "jsonb") TO "service_role";












GRANT ALL ON TABLE "public"."content_releases" TO "service_role";



GRANT ALL ON TABLE "public"."items" TO "service_role";



GRANT SELECT ON TABLE "app_private"."current_item_release" TO "service_role";









GRANT ALL ON TABLE "public"."activity_days" TO "service_role";
GRANT SELECT ON TABLE "public"."activity_days" TO "authenticated";



GRANT ALL ON TABLE "public"."admin_audit_log" TO "service_role";



GRANT UPDATE ON SEQUENCE "public"."admin_audit_log_event_id_seq" TO "anon";
GRANT UPDATE ON SEQUENCE "public"."admin_audit_log_event_id_seq" TO "authenticated";
GRANT USAGE,UPDATE ON SEQUENCE "public"."admin_audit_log_event_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."appeals" TO "service_role";
GRANT SELECT ON TABLE "public"."appeals" TO "authenticated";



GRANT ALL ON TABLE "public"."assessments" TO "service_role";
GRANT SELECT ON TABLE "public"."assessments" TO "authenticated";



GRANT ALL ON TABLE "public"."attempts" TO "service_role";
GRANT SELECT ON TABLE "public"."attempts" TO "authenticated";



GRANT ALL ON TABLE "public"."audio_assets" TO "service_role";



GRANT ALL ON TABLE "public"."audio_job_casting" TO "service_role";



GRANT ALL ON TABLE "public"."audio_job_render_status" TO "service_role";



GRANT ALL ON TABLE "public"."audio_jobs" TO "service_role";



GRANT ALL ON TABLE "public"."cast_roles" TO "service_role";



GRANT ALL ON TABLE "public"."competencies" TO "service_role";



GRANT ALL ON TABLE "public"."competency_state" TO "service_role";
GRANT SELECT ON TABLE "public"."competency_state" TO "authenticated";



GRANT ALL ON TABLE "public"."consents" TO "service_role";
GRANT SELECT ON TABLE "public"."consents" TO "authenticated";



GRANT ALL ON TABLE "public"."content_examples" TO "service_role";



GRANT ALL ON TABLE "public"."content_objects" TO "service_role";



GRANT ALL ON TABLE "public"."content_revisions" TO "service_role";



GRANT UPDATE ON SEQUENCE "public"."content_revisions_id_seq" TO "anon";
GRANT UPDATE ON SEQUENCE "public"."content_revisions_id_seq" TO "authenticated";
GRANT USAGE,UPDATE ON SEQUENCE "public"."content_revisions_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."content_singletons" TO "service_role";



GRANT ALL ON TABLE "public"."context_transfer_attempts" TO "service_role";
GRANT SELECT ON TABLE "public"."context_transfer_attempts" TO "authenticated";



GRANT ALL ON TABLE "public"."digital_qa_runs" TO "service_role";



GRANT ALL ON TABLE "public"."enrollments" TO "service_role";
GRANT SELECT ON TABLE "public"."enrollments" TO "authenticated";



GRANT ALL ON TABLE "public"."error_evidence" TO "service_role";
GRANT SELECT ON TABLE "public"."error_evidence" TO "authenticated";



GRANT ALL ON TABLE "public"."exam_attempts" TO "service_role";
GRANT SELECT ON TABLE "public"."exam_attempts" TO "authenticated";



GRANT ALL ON TABLE "public"."exam_components" TO "service_role";



GRANT ALL ON TABLE "public"."exam_forms" TO "service_role";



GRANT ALL ON TABLE "public"."example_review_events" TO "service_role";



GRANT UPDATE ON SEQUENCE "public"."example_review_events_id_seq" TO "anon";
GRANT UPDATE ON SEQUENCE "public"."example_review_events_id_seq" TO "authenticated";
GRANT USAGE,UPDATE ON SEQUENCE "public"."example_review_events_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."example_variants" TO "service_role";



GRANT UPDATE ON SEQUENCE "public"."example_variants_id_seq" TO "anon";
GRANT UPDATE ON SEQUENCE "public"."example_variants_id_seq" TO "authenticated";
GRANT USAGE,UPDATE ON SEQUENCE "public"."example_variants_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."feedback_events" TO "service_role";
GRANT SELECT ON TABLE "public"."feedback_events" TO "authenticated";



GRANT ALL ON TABLE "public"."idempotency_keys" TO "service_role";



GRANT ALL ON TABLE "public"."import_quarantine" TO "service_role";



GRANT UPDATE ON SEQUENCE "public"."import_quarantine_id_seq" TO "anon";
GRANT UPDATE ON SEQUENCE "public"."import_quarantine_id_seq" TO "authenticated";
GRANT USAGE,UPDATE ON SEQUENCE "public"."import_quarantine_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."import_runs" TO "service_role";



GRANT ALL ON TABLE "public"."invitations" TO "service_role";



GRANT ALL ON TABLE "public"."item_audio" TO "service_role";



GRANT ALL ON TABLE "public"."item_competencies" TO "service_role";



GRANT ALL ON TABLE "public"."item_sources" TO "service_role";



GRANT ALL ON TABLE "public"."learner_events" TO "service_role";
GRANT SELECT ON TABLE "public"."learner_events" TO "authenticated";



GRANT UPDATE ON SEQUENCE "public"."learner_events_id_seq" TO "anon";
GRANT UPDATE ON SEQUENCE "public"."learner_events_id_seq" TO "authenticated";
GRANT USAGE,UPDATE ON SEQUENCE "public"."learner_events_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."learning_routes" TO "service_role";
GRANT SELECT ON TABLE "public"."learning_routes" TO "authenticated";



GRANT ALL ON TABLE "public"."lesson_sessions" TO "service_role";
GRANT SELECT ON TABLE "public"."lesson_sessions" TO "authenticated";



GRANT ALL ON TABLE "public"."mastery_events" TO "service_role";
GRANT SELECT ON TABLE "public"."mastery_events" TO "authenticated";



GRANT ALL ON TABLE "public"."media_rights" TO "service_role";



GRANT UPDATE ON SEQUENCE "public"."media_rights_id_seq" TO "anon";
GRANT UPDATE ON SEQUENCE "public"."media_rights_id_seq" TO "authenticated";
GRANT USAGE,UPDATE ON SEQUENCE "public"."media_rights_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."pegp_packets" TO "service_role";



GRANT ALL ON TABLE "public"."placement_axis_results" TO "service_role";
GRANT SELECT ON TABLE "public"."placement_axis_results" TO "authenticated";



GRANT ALL ON TABLE "public"."placement_sessions" TO "service_role";
GRANT SELECT ON TABLE "public"."placement_sessions" TO "authenticated";



GRANT ALL ON TABLE "public"."preferences" TO "service_role";
GRANT SELECT ON TABLE "public"."preferences" TO "authenticated";



GRANT ALL ON TABLE "public"."profiles" TO "service_role";
GRANT SELECT ON TABLE "public"."profiles" TO "authenticated";



GRANT ALL ON TABLE "public"."provider_usage" TO "service_role";



GRANT UPDATE ON SEQUENCE "public"."provider_usage_id_seq" TO "anon";
GRANT UPDATE ON SEQUENCE "public"."provider_usage_id_seq" TO "authenticated";
GRANT USAGE,UPDATE ON SEQUENCE "public"."provider_usage_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."publication_policies" TO "service_role";



GRANT ALL ON TABLE "public"."rg_expressions" TO "service_role";



GRANT ALL ON TABLE "public"."role_assignments" TO "service_role";
GRANT SELECT ON TABLE "public"."role_assignments" TO "authenticated";



GRANT ALL ON TABLE "public"."route_changes" TO "service_role";



GRANT UPDATE ON SEQUENCE "public"."route_changes_id_seq" TO "anon";
GRANT UPDATE ON SEQUENCE "public"."route_changes_id_seq" TO "authenticated";
GRANT USAGE,UPDATE ON SEQUENCE "public"."route_changes_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."rubrics" TO "service_role";



GRANT ALL ON TABLE "public"."source_claims" TO "service_role";



GRANT ALL ON TABLE "public"."spaced_reviews" TO "service_role";
GRANT SELECT ON TABLE "public"."spaced_reviews" TO "authenticated";



GRANT ALL ON TABLE "public"."speaking_scenarios" TO "service_role";



GRANT ALL ON TABLE "public"."speaking_sessions" TO "service_role";
GRANT SELECT ON TABLE "public"."speaking_sessions" TO "authenticated";



GRANT ALL ON TABLE "public"."speaking_turn_metrics" TO "service_role";
GRANT SELECT ON TABLE "public"."speaking_turn_metrics" TO "authenticated";



GRANT UPDATE ON SEQUENCE "public"."speaking_turn_metrics_id_seq" TO "anon";
GRANT UPDATE ON SEQUENCE "public"."speaking_turn_metrics_id_seq" TO "authenticated";
GRANT USAGE,UPDATE ON SEQUENCE "public"."speaking_turn_metrics_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."speaking_turns" TO "service_role";
GRANT SELECT ON TABLE "public"."speaking_turns" TO "authenticated";



GRANT ALL ON TABLE "public"."units" TO "service_role";



GRANT ALL ON TABLE "public"."voice_artifacts" TO "service_role";
GRANT SELECT ON TABLE "public"."voice_artifacts" TO "authenticated";



GRANT ALL ON TABLE "public"."voice_catalog" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT UPDATE ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT UPDATE ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT UPDATE ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "service_role";































