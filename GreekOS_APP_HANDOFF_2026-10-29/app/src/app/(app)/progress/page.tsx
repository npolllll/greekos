import { requireLearner } from '@/lib/page';
import { learnerSnapshot } from '@/lib/learning/snapshot';
import { adminClient } from '@/lib/supabase/admin';
import { MASTERY_LABEL_RU, type MasteryState } from '@/lib/learning/mastery';
import { formatLocalDateRu } from '@/lib/learning/calendar';
import { EventFeed } from '@/components/EventFeed';
import { WeekBars } from '@/components/WeekBars';
import { Icon } from '@/components/Icon';

export const metadata = { title: 'Прогресс' };

const AXIS_RU: Record<string, string> = { listening: 'Аудирование', reading: 'Чтение', spoken_interaction: 'Устное взаимодействие', spoken_production: 'Устная речь', writing: 'Письмо', pronunciation: 'Произношение', grammar: 'Грамматика', vocabulary: 'Лексика' };
const ORDER: MasteryState[] = ['transfer_confirmed', 'retained', 'retention_due', 'spontaneous', 'controlled', 'recognition', 'familiar', 'needs_review', 'insufficient_evidence'];

export default async function ProgressPage() {
  const u = await requireLearner();
  const s = await learnerSnapshot(u.userId, u.profile.timezone, u.profile, u);
  const db = adminClient();
  const [{ data: states }, { data: comps }, { data: placement }] = await Promise.all([
    db.from('competency_state').select('competency_id, state, summary').eq('user_id', u.userId),
    db.from('competencies').select('competency_id, name, level').eq('scope', 'core').order('competency_id'),
    db.from('placement_axis_results').select('axis, status, candidate_start, confidence, not_observed_reason, updated_at').eq('user_id', u.userId).order('updated_at', { ascending: false }),
  ]);
  const byComp = new Map((states ?? []).map((x) => [x.competency_id, x]));
  const latestAxis = new Map<string, NonNullable<typeof placement>[number]>();
  for (const p of placement ?? []) if (!latestAxis.has(p.axis)) latestAxis.set(p.axis, p);
  const total = (comps ?? []).length;
  const seen = (states ?? []).length;
  const elapsedPct = s.enrollment?.total_days ? Math.round((s.enrollment.elapsed_days / s.enrollment.total_days) * 100) : 0;

  return (
    <section className="screen active">
      <div className="screen-head"><div><div className="eyebrow">GreekOS / Прогресс</div><h1 className="screen-title">Прогресс</h1><p className="screen-sub">Только по подтверждённым событиям. Процент B2 не показывается: уровень не выводится из кликов или пройденных экранов.</p></div></div>
      <div className="prog-grid">
        <div className="card cardpad">
          <div className="card-title"><Icon name="calendar" /> Девятимесячный план</div>
          {s.enrollment?.start_date ? (
            <>
              <p className="metric mono">{s.enrollment.elapsed_days} <span className="small muted">из {s.enrollment.total_days} дней</span></p>
              <div className="progress-track"><div className="progress-fill" style={{ width: `${elapsedPct}%` }} /></div>
              <p className="small quiet mt8">Старт {formatLocalDateRu(s.enrollment.start_date, { day: 'numeric', month: 'long', year: 'numeric' })} → цель {formatLocalDateRu(s.enrollment.end_date!, { day: 'numeric', month: 'long', year: 'numeric' })}. Это прошедшее календарное время, а не уровень.{s.enrollment.exam_date ? ` Экзамен: ${formatLocalDateRu(s.enrollment.exam_date, { day: 'numeric', month: 'long', year: 'numeric' })} (не меняет план).` : ''}</p>
            </>
          ) : <p className="small quiet">План начнётся после вводной настройки.</p>}
          <div className="subtle-divider" />
          <div className="card-title"><Icon name="chart" /> Активность</div>
          <WeekBars week={s.week} />
          <div className="aside-kpis"><span className="small">Попыток всего: <b>{s.stats.attempts_total}</b></span><span className="small">Уроков: <b>{s.stats.lessons_completed}</b></span><span className="small">7 дней: <b>{s.stats.minutes_7d} мин</b></span></div>
        </div>
        <div className="card cardpad">
          <div className="card-title"><Icon name="layers" /> Навыки по компетенциям</div>
          <p className="small quiet">Затронуто {seen} из {total} основных компетенций. «Сохранено» — только после самостоятельных D7 и D28.</p>
          <div className="skillbars">
            {ORDER.filter((st) => s.competencies[st] > 0).map((st) => (
              <div className="skillbar" key={st}><label>{MASTERY_LABEL_RU[st]}</label><div className="progress-track"><div className="progress-fill" style={{ width: `${total ? Math.max(3, Math.round((s.competencies[st] / total) * 100)) : 0}%` }} /></div><b className="mono">{s.competencies[st]}</b></div>
            ))}
            {!seen ? <div className="empty"><strong>Нет данных</strong>Статусы появятся после первых проверенных ответов.</div> : null}
          </div>
          <div className="subtle-divider" />
          <div className="card-title"><Icon name="spark" /> Профиль по навыкам (диагностика)</div>
          {latestAxis.size ? (
            <div className="skill-grid mt8">{[...latestAxis.values()].map((p) => (
              <div className="skill-card" key={p.axis}><b>{AXIS_RU[p.axis]}</b><p>{p.status === 'OBSERVED' ? `Предварительный старт: ${p.candidate_start ?? '—'} · уверенность ${p.confidence === 'high' ? 'высокая' : p.confidence === 'medium' ? 'средняя' : 'низкая'}` : p.status === 'NOT_OBSERVED' ? `Не оценено: ${p.not_observed_reason ?? 'нет данных'}` : p.status === 'PENDING_REVIEW' ? 'Ждёт проверки' : p.status === 'NO_RELEASED_CONTENT' ? 'Задания диагностики на проверке' : 'В процессе'}</p></div>
            ))}</div>
          ) : <p className="small quiet">Диагностика не проводилась. Для старта с нуля она не обязательна.</p>}
        </div>
      </div>
      <div className="card cardpad mt16">
        <div className="card-title"><Icon name="book" /> Компетенции</div>
        <div className="table-wrap"><table className="data-table"><thead><tr><th>ID</th><th>Компетенция</th><th>Уровень</th><th>Статус</th><th>Доказательства</th></tr></thead><tbody>
          {(comps ?? []).filter((c) => byComp.has(c.competency_id)).map((c) => {
            const st = byComp.get(c.competency_id)!;
            const sum = st.summary as { recognition_items?: number; controlled_items?: number; spontaneous_items?: number; d7_passed?: boolean; d28_passed?: boolean };
            return <tr key={c.competency_id}><td className="mono">{c.competency_id}</td><td><strong>{c.name}</strong></td><td>{c.level}</td><td>{MASTERY_LABEL_RU[st.state as MasteryState]}</td><td className="tiny">узнавание {sum.recognition_items ?? 0} · по образцу {sum.controlled_items ?? 0} · сам. {sum.spontaneous_items ?? 0} · D7 {sum.d7_passed ? '✓' : '—'} · D28 {sum.d28_passed ? '✓' : '—'}</td></tr>;
          })}
        </tbody></table></div>
        {!seen ? <p className="small quiet">Таблица заполнится по мере ответов.</p> : null}
      </div>
      <div className="card cardpad mt16" id="events"><div className="card-title"><Icon name="rotate" /> События обучения</div><EventFeed events={s.events} /></div>
    </section>
  );
}
