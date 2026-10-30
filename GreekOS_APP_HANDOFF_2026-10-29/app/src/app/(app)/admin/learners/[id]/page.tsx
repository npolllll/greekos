import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireOwnerPage } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';
import { planEndDate } from '@/lib/learning/calendar';
import { MASTERY_LABEL_RU, type MasteryState } from '@/lib/learning/mastery';
import { LIFECYCLE_LABEL, ENTRY_LABEL, AXIS_LABEL, ERROR_KIND_LABEL, ERROR_STATUS_LABEL, ROUTE_KIND_LABEL, SESSION_STATUS_LABEL, minutesLabel, dateTimeRu } from '@/lib/admin/labels';
import { MODE_LABEL_RU } from '@/lib/speaking/state-machine';
import { LearnerActions } from '../../_components/LearnerActions';
import { RouteForm } from '../../_components/RouteForm';
import { nowMs } from '@/lib/admin/time';

export const metadata = { title: 'Карточка ученика' };

export default async function LearnerCard({ params }: { params: Promise<{ id: string }> }) {
  const owner = await requireOwnerPage();
  const { id } = await params;
  const db = adminClient();
  const { data: p } = await db.from('profiles').select('*').eq('user_id', id).maybeSingle();
  if (!p) notFound();
  const [roles, enr, route, routeHist, axes, states, act, attempts, lessons, errors, speaking, consents, units, pendingCount] = await Promise.all([
    db.from('role_assignments').select('role').eq('user_id', id),
    db.from('enrollments').select('*').eq('user_id', id).maybeSingle(),
    db.from('learning_routes').select('*').eq('user_id', id).maybeSingle(),
    db.from('route_changes').select('id, reason, changed_at, next').eq('user_id', id).order('changed_at', { ascending: false }).limit(10),
    db.from('placement_axis_results').select('axis, status, candidate_start, confidence, not_observed_reason, updated_at').eq('user_id', id).order('updated_at', { ascending: false }),
    db.from('competency_state').select('competency_id, state, updated_at').eq('user_id', id),
    db.from('activity_days').select('local_date, active_seconds, attempts').eq('user_id', id).order('local_date', { ascending: false }).limit(60),
    db.from('attempts').select('attempt_id', { count: 'exact', head: true }).eq('user_id', id).eq('preview', false),
    db.from('lesson_sessions').select('unit_id, status, completed_at').eq('user_id', id).eq('preview', false).order('started_at', { ascending: false }).limit(20),
    db.from('error_evidence').select('id, competency_id, error_kind, status, created_at').eq('user_id', id).order('created_at', { ascending: false }).limit(20),
    db.from('speaking_sessions').select('session_id, scenario_id, mode, input_mode, status, started_at, ended_at, summary_private').eq('user_id', id).order('started_at', { ascending: false }).limit(20),
    db.from('consents').select('consent_id, purpose, artifact_id, granted_at, expires_at, revoked_at').eq('user_id', id),
    db.from('units').select('unit_id, title_ru, level, sort_key').order('sort_key'),
    db.from('assessments').select('assessment_id', { count: 'exact', head: true }).eq('user_id', id).in('verdict', ['PENDING_REVIEW', 'ABSTAIN']).eq('status', 'ACTIVE'),
  ]);
  const isOwnerTarget = (roles.data ?? []).some((r) => r.role === 'owner_admin');
  const stateCounts = new Map<string, number>();
  for (const s of states.data ?? []) stateCounts.set(s.state, (stateCounts.get(s.state) ?? 0) + 1);
  const needsReview = (states.data ?? []).filter((s) => s.state === 'needs_review').map((s) => s.competency_id);
  const totalSeconds = (act.data ?? []).reduce((a, d) => a + d.active_seconds, 0);
  const now = nowMs();
  const transcriptConsent = new Set((consents.data ?? []).filter((c) => c.purpose === 'owner_transcript_access' && !c.revoked_at && (!c.expires_at || new Date(c.expires_at).getTime() > now)).map((c) => c.artifact_id));

  return (
    <div className="admin-section">
      <div className="card cardpad">
        <div className="card-top">
          <div><div className="card-title" style={{ fontSize: 17 }}>{p.display_name}</div><span className="tiny muted">{p.email}</span></div>
          <span className={`status ${p.active ? '' : 'blocked'}`}>{p.active ? LIFECYCLE_LABEL[p.lifecycle_state] ?? p.lifecycle_state : 'Отключён'}</span>
        </div>
        <dl className="kv">
          <dt>Опыт (самоотчёт)</dt><dd>{p.entry_path ? ENTRY_LABEL[p.entry_path] : '—'}</dd>
          <dt>Приглашён / активирован</dt><dd>{dateTimeRu(p.invited_at)} / {dateTimeRu(p.activated_at)}</dd>
          <dt>Часовой пояс</dt><dd>{p.timezone}</dd>
          <dt>Начало и 9 месяцев</dt><dd>{enr.data?.start_date ? `${enr.data.start_date} → ${planEndDate(enr.data.start_date)} (цель, не обещание)` : 'Не начато'}</dd>
          <dt>Дата экзамена</dt><dd>{enr.data?.exam_date ?? 'не задана (не меняет план)'}</dd>
          <dt>Минут в день</dt><dd>{enr.data?.daily_minutes ?? '—'}</dd>
          <dt>Активное время</dt><dd>{minutesLabel(totalSeconds)} за 60 дней · ответов всего: {attempts.count ?? 0} · на проверке: {pendingCount.count ?? 0}</dd>
        </dl>
        {isOwnerTarget || id === owner.userId ? <p className="small quiet mt16">Это аккаунт владельца: деактивация и удаление недоступны.</p> : <LearnerActions userId={id} active={p.active} name={p.display_name} />}
      </div>

      <div className="admin-split">
        <div className="stack">
          <div className="card cardpad">
            <div className="card-title">Маршрут</div>
            <p className="small">Тип: <b>{ROUTE_KIND_LABEL[route.data?.route_kind ?? ''] ?? route.data?.route_kind ?? '—'}</b> · старт: <b>{route.data?.start_unit_id ?? 'не назначен'}</b></p>
            <p className="small quiet">{route.data?.reason ?? ''}</p>
            <RouteForm userId={id} current={route.data?.start_unit_id ?? null} units={(units.data ?? []).map((u) => ({ id: u.unit_id, label: `${u.unit_id} · ${u.title_ru}` }))} />
            {(routeHist.data ?? []).length ? (
              <details className="box mt16"><summary>История изменений маршрута</summary>
                {(routeHist.data ?? []).map((r) => <div key={r.id} className="review-row"><div><b>{(r.next as { start_unit_id?: string })?.start_unit_id ?? '—'}</b><span className="event-text">{r.reason}</span></div><small>{dateTimeRu(r.changed_at)}</small></div>)}
              </details>
            ) : null}
          </div>
          <div className="card cardpad">
            <div className="card-title">Диагностика по навыкам</div>
            {(axes.data ?? []).length ? (
              <div className="table-wrap"><table className="data-table"><thead><tr><th>Навык</th><th>Статус</th><th>Старт</th><th>Уверенность</th><th>Не оценено</th></tr></thead><tbody>
                {(axes.data ?? []).map((a, i) => <tr key={`${a.axis}-${i}`}><td>{AXIS_LABEL[a.axis] ?? a.axis}</td><td>{a.status}</td><td>{a.candidate_start ?? '—'}</td><td>{a.confidence ?? '—'}</td><td>{a.not_observed_reason ?? ''}</td></tr>)}
              </tbody></table></div>
            ) : <p className="small quiet">Диагностика не проводилась.</p>}
          </div>
          <div className="card cardpad">
            <div className="card-title">Навыки (по доказательствам)</div>
            <div className="status-grid mt8">{[...stateCounts.entries()].map(([s, n]) => <div key={s} className="skill-card"><b>{n}</b><p>{MASTERY_LABEL_RU[s as MasteryState] ?? s}</p></div>)}</div>
            {!stateCounts.size ? <p className="small quiet">Пока нет доказательств освоения.</p> : null}
            {needsReview.length ? <p className="small mt8">Нужно повторить: {needsReview.join(', ')}</p> : null}
          </div>
        </div>
        <div className="stack">
          <div className="card cardpad">
            <div className="card-title">Уроки</div>
            {(lessons.data ?? []).length ? (lessons.data ?? []).map((l, i) => <div key={`${l.unit_id}-${i}`} className="review-row"><b>{l.unit_id}</b><small>{l.status === 'COMPLETED' ? `завершён ${dateTimeRu(l.completed_at)}` : 'в процессе'}</small></div>) : <p className="small quiet">Уроков ещё не было.</p>}
          </div>
          <div className="card cardpad">
            <div className="card-title">Ошибки с доказательствами</div>
            {(errors.data ?? []).length ? (errors.data ?? []).map((e) => <div key={e.id} className="review-row"><div><b>{e.competency_id ?? '—'}</b><span className="event-text">{ERROR_KIND_LABEL[e.error_kind ?? ''] ?? e.error_kind ?? ''}</span></div><small>{ERROR_STATUS_LABEL[e.status] ?? e.status}</small></div>) : <p className="small quiet">Подтверждённых ошибок нет.</p>}
          </div>
          <div className="card cardpad">
            <div className="card-title">Разговорная практика</div>
            <p className="tiny muted">Сводки без сырого голоса. Полный транскрипт доступен только при действующем согласии ученика на конкретную сессию; просмотр записывается в журнал.</p>
            {(speaking.data ?? []).length ? (speaking.data ?? []).map((s) => {
              const goal = (s.summary_private as { communicative_goal?: string } | null)?.communicative_goal;
              return (
                <div key={s.session_id} className="review-row">
                  <div><b>{s.scenario_id} · {MODE_LABEL_RU[s.mode as keyof typeof MODE_LABEL_RU] ?? s.mode}</b><span className="event-text">{s.input_mode === 'voice' ? 'голос' : 'текст (не речь)'} · {SESSION_STATUS_LABEL[s.status] ?? s.status}{goal ? ` · цель: ${goal}` : ''}</span></div>
                  {transcriptConsent.has(s.session_id) ? <Link className="text-link" href={`/admin/learners/${id}/sessions/${s.session_id}`}>Транскрипт</Link> : <small>нет согласия</small>}
                </div>
              );
            }) : <p className="small quiet">Сессий не было.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
