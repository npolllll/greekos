import Link from 'next/link';
import { ViewTransition } from 'react';
import { requireLearner, greeting } from '@/lib/page';
import { learnerSnapshot } from '@/lib/learning/snapshot';
import { formatLocalDateRu } from '@/lib/learning/calendar';
import { adminClient } from '@/lib/supabase/admin';
import { releaseMap } from '@/lib/content/repo';
import { Icon } from '@/components/Icon';
import { EventFeed } from '@/components/EventFeed';
import { AnimatedNumber, ProgressRing } from '@/components/ui/Motion';

export const metadata = { title: 'Главная' };

const STATE_RU: Record<string, string> = { recognition: 'узнаю', controlled: 'применяю с опорой', spontaneous: 'применяю сам', retention_due: 'ждёт повторения', retained: 'сохранено D7+D28', transfer_confirmed: 'перенос подтверждён', needs_review: 'нужно повторить' };

export default async function TodayPage() {
  const u = await requireLearner();
  const s = await learnerSnapshot(u.userId, u.profile.timezone, u.profile, u);
  const db = adminClient();
  const { data: rg } = await db.from('rg_expressions').select('expression_id, expression, current_hash, payload').order('expression_id');
  const rgRel = await releaseMap('rg_expression', (rg ?? []).map((r) => ({ id: r.expression_id, hash: r.current_hash })), u);
  const rgOpen = (rg ?? []).filter((r) => rgRel.has(r.expression_id));
  const first = u.profile.display_name.split(' ')[0];
  const isNew = s.stats.attempts_total === 0;
  const nu = s.next_unit;
  const today = s.week[s.week.length - 1]?.date;
  const seen = Object.entries(s.competencies).filter(([k]) => k !== 'unseen').reduce((a, [, v]) => a + v, 0);
  const trackerRows = (['spontaneous', 'controlled', 'recognition', 'retained', 'needs_review'] as const).map((k) => ({ k, n: s.competencies[k] ?? 0 })).filter((r) => r.n > 0);

  return (
    <section className="screen active">
      <div className="home-heading">
        <div>
          <h1>{isNew ? 'Добро пожаловать' : greeting(u.profile.timezone)}, {first}</h1>
          <p>Понемногу каждый день — и греческий становится своим.</p>
        </div>
        <div className="home-info">
          <span className="pill"><Icon name="calendar" size={14} /> {formatLocalDateRu(s.today, { weekday: 'long', day: 'numeric', month: 'long' })}</span>
        </div>
      </div>

      {u.isOwner && !u.onboarded ? (
        <div className="banner info"><Icon name="info" /><span>Вы вошли как владелец. Собственный маршрут не начат — <Link className="text-link" href="/welcome">начать обучение</Link> или открыть <Link className="text-link" href="/admin">админ-панель</Link>.</span></div>
      ) : null}
      {u.devPreview ? (
        <div className="banner preview"><Icon name="eye" /><span><strong>DEV-PREVIEW.</strong> Владелец открыл этому тестовому аккаунту невыпущенный корпус в локальной среде. Результаты сохраняются по-настоящему, с отметкой «не выпущено»; обычные ученики эти материалы не видят.</span></div>
      ) : s.content.units_released === 0 ? (
        <div className="banner warn"><Icon name="lock" /><span><strong>Материалы проходят проверку.</strong> Уроки открываются после цифровой проверки и решения владельца о выпуске. Это не связано с вашими результатами.</span></div>
      ) : null}

      <div className="dash">
        {/* Hero: continue the path */}
        <div className="hero c-8">
          <div className="hero-photo" aria-hidden="true" />
          <div className="hero-body">
            <span className="tag">{nu ? (nu.dev_preview ? 'Следующий урок · DEV-PREVIEW' : 'Следующий урок') : 'Следующий шаг'}</span>
            <h2>{isNew ? `Начнём путь, ${first}!` : `Продолжайте путь, ${first}!`}</h2>
            {nu ? (
              <ViewTransition name={`unit-title-${nu.unit_id}`} share="morph" default="none">
                <p style={{ fontSize: 16, fontWeight: 650, color: 'var(--ink)' }}>{nu.title_ru}</p>
              </ViewTransition>
            ) : null}
            <p>
              {nu
                ? `${s.level.code === 'A0' ? 'Основы чтения' : nu.level} · ${nu.item_usable} из ${nu.item_total} заданий доступны${nu.estimated_active_minutes ? ` · ≈ ${nu.estimated_active_minutes} мин` : ''}`
                : s.content.units_released ? 'Новые уроки появятся после проверки. Пока можно повторять и говорить.' : 'Пока материалы на проверке, можно пройти вводную настройку и посмотреть план на девять месяцев.'}
            </p>
            <div className="hero-actions">
              {nu ? <Link className="btn" href={`/lesson/${nu.unit_id}`} transitionTypes={['nav-forward']}><Icon name="play" size={15} /> Продолжить урок <Icon name="arrow" size={15} /></Link> : <Link className="btn" href="/course">Открыть маршрут <Icon name="arrow" size={15} /></Link>}
              <Link className="btn outline" href="/course">Смотреть план</Link>
            </div>
          </div>
          {s.enrollment?.end_date ? <div className="hero-chip no-mobile"><Icon name="target" size={16} /> Ориентир B2: <b>{formatLocalDateRu(s.enrollment.end_date, { month: 'long', year: 'numeric' })}</b></div> : null}
        </div>

        {/* Current level */}
        <div className="card stat-card c-4">
          <div className="card-top" style={{ marginBottom: 0 }}><div className="card-title"><Icon name="chart" /> Текущий уровень</div><Link className="text-link" href="/progress">Детали <Icon name="arrow" size={12} /></Link></div>
          <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
            <div>
              <div className="big-num">{s.level.code}</div>
              <p className="small quiet" style={{ margin: '6px 0 0' }}>{s.level.label_ru}</p>
              <p className="tiny quiet" style={{ margin: '4px 0 0' }}>{s.level.completed} из {s.level.total} уроков уровня завершено</p>
            </div>
            <ProgressRing value={s.level.pct} size={108} stroke={10} sub="уровня" />
          </div>
          <div className="progress-track"><div className="progress-fill" style={{ width: `${s.enrollment && s.enrollment.total_days ? Math.round((s.enrollment.elapsed_days / s.enrollment.total_days) * 100) : 0}%` }} /></div>
          <p className="tiny quiet" style={{ margin: 0 }}>{s.enrollment?.start_date ? `День ${s.enrollment.elapsed_days} из ${s.enrollment.total_days} индивидуального плана (ориентир, не гарантия).` : 'План на 9 месяцев начнётся после вводной настройки.'}</p>
        </div>

        {/* Next lesson */}
        <div className="card cardpad c-4">
          <div className="card-top"><div className="card-title"><Icon name="book" /> Следующий урок</div><Link className="text-link" href="/course" aria-label="Весь маршрут"><Icon name="arrow" size={14} /></Link></div>
          {nu ? (
            <div className="next-lesson">
              <div className="thumb" style={{ ['--tx' as string]: '20%', ['--ty' as string]: '80%', ['--ts' as string]: '300%' }} aria-hidden="true" />
              <div style={{ minWidth: 0 }}>
                <span className="tiny quiet">{nu.unit_id}</span>
                <p style={{ margin: '2px 0 10px', fontWeight: 700, fontSize: 14.5, lineHeight: 1.35 }}>{nu.title_ru}</p>
                <div className="row"><Link className="btn small" href={`/lesson/${nu.unit_id}`}>Продолжить</Link>{nu.estimated_active_minutes ? <span className="tiny quiet"><Icon name="clock" size={13} /> {nu.estimated_active_minutes} мин</span> : null}</div>
              </div>
            </div>
          ) : <div className="empty"><strong>Нет открытых уроков</strong>Уроки откроются после выпуска.</div>}
        </div>

        {/* Today in focus = the adaptive plan */}
        <div className="card cardpad c-4">
          <div className="card-top"><div className="card-title"><Icon name="target" /> Сегодня в фокусе</div><span className="tag gray">{s.plan.budget.correction + s.plan.budget.retention + s.plan.budget.new_content + s.plan.budget.independent_application} мин</span></div>
          {s.plan.status === 'NOT_STARTED' ? <p className="small quiet">План появится после вводной настройки.</p> : (
            <div className="focus-list">
              {s.plan.blocks.map((b) => {
                const body = (<><span className={`check-dot ${b.available ? 'open' : ''}`} aria-hidden="true" /><span style={{ flex: 1, minWidth: 0 }}>{b.title_ru}<small className="event-text">{b.detail_ru}</small></span><span className="plan-time mono">{b.minutes}′</span></>);
                return b.available && b.href ? <Link key={b.kind} className="focus-row" href={b.href}>{body}</Link> : <div key={b.kind} className="focus-row" aria-disabled="true">{body}</div>;
              })}
            </div>
          )}
          {s.plan.status === 'OK' ? <p className="tiny quiet" style={{ marginBottom: 0 }}>30% коррекция (внутри 80/20), 20% повторение, 30% новое, 20% применение.</p> : s.plan.status === 'NO_ELIGIBLE_CONTENT' ? <p className="tiny quiet" style={{ marginBottom: 0 }}>Нет доступных проверенных заданий — план не выдумывает задачи.</p> : null}
        </div>

        {/* Streak */}
        <div className="card cardpad c-4">
          <div className="card-top"><div className="card-title"><Icon name="flame" /> Серия дней</div><Link className="text-link" href="/progress">Ритм <Icon name="arrow" size={12} /></Link></div>
          <div className="row" style={{ alignItems: 'flex-end', gap: 12 }}>
            <span className="big-num" style={{ color: s.stats.active_days_streak ? 'var(--accent-strong)' : 'var(--ink)' }}><AnimatedNumber value={s.stats.active_days_streak} /></span>
            <span className="small quiet" style={{ paddingBottom: 4 }}>{s.stats.active_days_streak ? 'дней подряд с занятиями' : 'серия начнётся с первого ответа'}</span>
          </div>
          <div className="week" aria-label="Активность за 7 дней">
            {s.week.map((w) => (
              <div className="week-day" key={w.date} title={`${w.label}: ${w.minutes} мин`}>
                <span className={`week-dot ${w.minutes > 0 ? 'on' : ''} ${w.date === today ? 'today' : ''}`} />{w.label}
              </div>
            ))}
          </div>
          <p className="tiny quiet" style={{ margin: '10px 0 0' }}>Активные минуты за неделю: <b className="mono">{s.stats.minutes_7d}</b>. Простой экрана не засчитывается.</p>
        </div>

        {/* Bottom row */}
        <Link className="card mini-card c-3" href="/errors">
          <div className="row between"><span className="mini-ico"><Icon name="rotate" /></span><Icon name="arrow" size={15} /></div>
          <h3>Мои ошибки</h3>
          <div className="row" style={{ alignItems: 'flex-end' }}><span className="big-num" style={{ fontSize: 34 }}><AnimatedNumber value={s.errors.open} /></span><span className="tiny quiet">{s.errors.open ? 'к повторению' : 'подтверждённых нет'}</span></div>
          {s.reviews.due_today ? <p>Отсроченных проверок сегодня: <b>{s.reviews.due_today}</b></p> : null}
        </Link>
        <Link className="card mini-card c-3" href="/speaking">
          <div className="row between"><span className="mini-ico sea"><Icon name="mic" /></span><Icon name="arrow" size={15} /></div>
          <h3>AI-разговор</h3>
          <p>Кафе, дорога, аренда, работа: голосом, с подсказками по запросу и разбором 2–3 ошибок.</p>
        </Link>
        <Link className="card mini-card c-3" href="/real-greek">
          <div className="row between"><span className="mini-ico olive"><Icon name="heart" /></span><Icon name="arrow" size={15} /></div>
          <h3>Живой греческий</h3>
          {rgOpen.length ? <p lang="el" className="display" style={{ fontSize: 17, color: 'var(--ink)' }}>{rgOpen[0].expression}</p> : null}
          <p>{rgOpen.length ? `${rgOpen.length} выражений с регистром и контекстом` : 'Выражения проходят проверку регистра и контекста.'}</p>
        </Link>
        <Link className="card mini-card c-3" href="/exams">
          <div className="row between"><span className="mini-ico gold"><Icon name="school" /></span><Icon name="arrow" size={15} /></div>
          <h3>Подготовка к экзаменам</h3>
          <p>ΚΕΓ B2: три тренировочные формы · ΠΕΓΠ. Не официальный экзамен и не официальный балл.</p>
        </Link>

        {/* Competency tracker */}
        <div className="card cardpad c-6">
          <div className="card-top"><div className="card-title"><Icon name="layers" /> Компетенции курса</div><span className="tag gray"><AnimatedNumber value={seen} /> из {s.competencies_total}</span></div>
          {trackerRows.length ? (
            <div className="skillbars">
              {trackerRows.map((r) => (
                <div className="skillbar" key={r.k}><label>{STATE_RU[r.k]}</label><div className="progress-track"><div className="progress-fill" style={{ width: `${Math.round((r.n / Math.max(1, s.competencies_total)) * 100)}%` }} /></div><b className="mono">{r.n}</b></div>
              ))}
            </div>
          ) : <div className="empty"><strong>Трекер заполнится по вашим ответам</strong>{s.competencies_total} компетенций A1–B2: статус меняется только по самостоятельным ответам и отсроченным D7/D28.</div>}
          {s.reviews.upcoming.length ? (
            <>
              <div className="subtle-divider" />
              <div className="card-title" style={{ fontSize: 13 }}><Icon name="calendar" size={15} /> Ближайшие повторения</div>
              {s.reviews.upcoming.slice(0, 4).map((r) => <div className="review-row" key={`${r.competency_id}-${r.interval_days}`}><span>{r.competency_id}</span><small>D{r.interval_days} · {formatLocalDateRu(r.due_local_date, { day: 'numeric', month: 'short' })}</small></div>)}
            </>
          ) : null}
        </div>

        {/* Live events */}
        <div className="card cardpad c-6">
          <div className="card-top"><div className="card-title"><Icon name="bell" /> События обучения <span className="live-dot" aria-hidden="true" /></div><span className="tag green">с сервера</span></div>
          <EventFeed events={s.events.slice(0, 6)} />
          <p className="tiny quiet" style={{ marginBottom: 0 }}>Обновляется сам после подтверждённой записи на сервере — в том числе с другого устройства.</p>
        </div>
      </div>
    </section>
  );
}
