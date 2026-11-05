import Link from 'next/link';
import { requireLearner } from '@/lib/page';
import { learnerSnapshot } from '@/lib/learning/snapshot';
import { formatLocalDateRu } from '@/lib/learning/calendar';
import { adminClient } from '@/lib/supabase/admin';
import { Icon } from '@/components/Icon';

const BLOCK_RU: Record<string, string> = { correction: 'работа над ошибками', weak_correction: 'слабые темы', strong_correction: 'поддержание', retention: 'отсроченное повторение', new_content: 'новый материал', independent_application: 'самостоятельное применение' };

export const metadata = { title: 'Практика' };

export default async function PracticeHub() {
  const u = await requireLearner();
  const s = await learnerSnapshot(u.userId, u.profile.timezone, u.profile, u);
  const { data: names } = await adminClient().from('competencies').select('competency_id, name').eq('scope', 'core');
  const nm = new Map((names ?? []).map((n) => [n.competency_id, n.name]));
  return (
    <section className="screen active">
      <div className="screen-head"><div><div className="eyebrow">GreekOS / Практика</div><h1 className="screen-title">Практика на сегодня</h1><p className="screen-sub">Задания подбираются детерминированно: слабые темы по подтверждённым ошибкам за 14 дней, затем отсроченные проверки, затем новое.</p></div></div>
      {s.plan.status === 'NO_ELIGIBLE_CONTENT' ? <div className="banner warn"><Icon name="lock" /><span><strong>Нет доступных проверенных заданий.</strong> Система не придумывает задачи — практика появится после выпуска материалов.</span></div> : null}
      <div className="grid-2">
        {s.plan.blocks.map((b) => (
          <div className="card cardpad" key={b.kind}>
            <div className="card-top"><div className="card-title">{b.title_ru}</div><span className="tag gray mono">{b.minutes} мин</span></div>
            <p className="small quiet">{b.detail_ru}</p>
            {b.available && b.href ? <Link className="btn" href={b.href}>Начать <Icon name="arrow" size={14} /></Link> : <span className="tag gray">Пока нет доступных заданий</span>}
          </div>
        ))}
      </div>
      <div className="card cardpad mt16">
        <div className="card-title"><Icon name="calendar" /> Ближайшие отсроченные проверки</div>
        {s.reviews.upcoming.length ? s.reviews.upcoming.map((r) => (
          <div className="review-row" key={`${r.competency_id}-${r.interval_days}`}><b>{nm.get(r.competency_id) ?? r.competency_id}</b><small>D{r.interval_days} · {formatLocalDateRu(r.due_local_date)}</small></div>
        )) : <div className="empty"><strong>Пока нет запланированных проверок</strong>Они появятся после первого самостоятельного верного ответа.</div>}
        {s.plan.log.length ? <p className="tiny muted mt8">Перераспределение времени: {s.plan.log.map((l) => `${l.minutes} мин: «${BLOCK_RU[l.from] ?? l.from}» → «${BLOCK_RU[l.to] ?? l.to}»`).join('; ')} — пустые блоки не заполняются выдуманными задачами.</p> : null}
      </div>
    </section>
  );
}
