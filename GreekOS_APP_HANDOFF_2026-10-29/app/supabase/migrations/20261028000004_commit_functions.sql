-- GreekOS: atomic, idempotent learning commits.
-- The server computes the evaluation in TypeScript and sends one JSON bundle; this function
-- writes it in a single transaction, serialised per learner, deduplicated by idempotency key.
-- Every row must carry the same user_id as the bundle (defence against mixed ownership).

create or replace function app_private.assert_owner_rows(uid uuid, rows jsonb, label text)
returns void language plpgsql as $$
declare r jsonb;
begin
  if rows is null or jsonb_typeof(rows) <> 'array' then
    return;
  end if;
  for r in select value from jsonb_array_elements(rows) loop
    if r is null or jsonb_typeof(r) = 'null' then
      continue;
    end if;
    if (r->>'user_id')::uuid is distinct from uid then
      raise exception 'ownership mismatch in %', label using errcode = '42501';
    end if;
  end loop;
end;
$$;

create or replace function public.commit_learning_event(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
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

revoke all on function public.commit_learning_event(jsonb) from public, anon, authenticated;
grant execute on function public.commit_learning_event(jsonb) to service_role;
revoke all on function app_private.assert_owner_rows(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function app_private.assert_owner_rows(uuid, jsonb, text) to service_role;

-- Release eligibility in SQL for admin statistics; the server applies the same rule in TS.
create or replace view app_private.current_item_release as
select
  i.item_id,
  i.module,
  i.current_hash,
  i.requires_audio,
  exists (
    select 1 from public.content_releases r
    where r.content_kind = 'item' and r.content_id = i.item_id and r.content_hash = i.current_hash
      and r.decision = 'APPROVED' and r.revoked_at is null
      and (r.expires_at is null or r.expires_at > now())
  ) as text_released
from public.items i;

revoke all on app_private.current_item_release from public, anon, authenticated;
grant select on app_private.current_item_release to service_role;
