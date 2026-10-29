import Link from 'next/link';
import { requireLearner, greeting } from '@/lib/page';
import { learnerSnapshot } from '@/lib/learning/snapshot';
import { formatLocalDateRu } from '@/lib/learning/calendar';
import { adminClient } from '@/lib/supabase/admin';
import { releaseMap } from '@/lib/content/repo';
import { Icon } from '@/components/Icon';
import { EventFeed } from '@/components/EventFeed';
import { WeekBars } from '@/components/WeekBars';

export const metadata = { title: 'Главная' };

export default async function TodayPage() {
  const u = await requireLearner();
  const s = await learnerSnapshot(u.userId, u.profile.timezone, u.profile);
  const db = adminClient();
  const { data: rg } = await db.from('rg_expressions').select('expression_id, expression, current_hash, payload').order('expression_id');
  const rgRel = await releaseMap('rg_expression', (rg ?? []).map((r) => ({ id: r.expression_id, hash: r.current_hash })));
  const rgReleased = (rg ?? []).filter((r) => rgRel.has(r.expression_id)).slice(0, 3);
  const doneCount = s.plan.blocks.filter((b) => b.available).length;
  const first = u.profile.display_name.split(' ')[0];
  const isNew = s.stats.attempts_total === 0;

  return (
    <section className="screen active">
      <div className="home-heading">
        <div>
          <h1>{isNew ? 'Добро пожаловать' : greeting(u.profile.timezone)}, {first} <span aria-hidden="true">✳</span></h1>
          <p>Понемногу каждый день — и греческий становится своим.</p>
        </div>
        <div className="home-info">
          <span className="pill"><Icon name="calendar" size={14} /> {formatLocalDateRu(s.today, { weekday: 'long', day: 'numeric', month: 'long' })} · учебный план</span>
        </div>
      </div>

      {u.isOwner && !u.onboarded ? (
        <div className="banner info"><Icon name="info" /><span>Вы вошли как владелец. Собственный учебный маршрут не начат — <Link className="text-link" href="/welcome">начать обучение</Link> или перейти в <Link className="text-link" href="/admin">админ-панель</Link>.</span></div>
      ) : null}
      {s.content.units_released === 0 ? (
        <div className="banner warn"><Icon name="lock" /><span><strong>Материалы проходят проверку.</strong> Учебный корпус импортирован в закрытом режиме: уроки открываются после отдельного решения владельца о выпуске. Это не отражает ваши способности — прогресс начнёт считаться с первого доступного задания.</span></div>
      ) : null}

      <div className="stat-row">
        <div className="card stat"><div><strong className="mono">{s.stats.active_days_streak}</strong><small>Дней подряд с занятиями</small></div><span className="stat-icon"><Icon name="calendar" /></span></div>
        <div className="card stat"><div><strong className="mono">{s.stats.lessons_completed}</strong><small>Завершено уроков</small></div><span className="stat-icon green"><Icon name="book" /></span></div>
        <div className="card stat"><div><strong className="mono">{s.mastered_competencies}</strong><small>Навыков сохранено (D7 + D28)</small></div><span className="stat-icon blue"><Icon name="chart" /></span></div>
      </div>

      <div className="home-grid">
        <div className="card hero-card span2">
          <div className="herotext">
            <span className="tag">{s.next_unit ? 'Ваш следующий урок' : 'Следующий шаг'}</span>
            <h2>{s.next_unit ? s.next_unit.title_ru : s.content.units_released ? 'Все открытые уроки пройдены' : 'Курс скоро откроется'}</h2>
            <p>
              {s.next_unit
                ? `${s.next_unit.level} · ${s.next_unit.item_usable} из ${s.next_unit.item_total} заданий доступны${s.next_unit.estimated_active_minutes ? ` · около ${s.next_unit.estimated_active_minutes} мин (оценка автора, не калибровано)` : ''}`
                : s.content.units_released ? 'Новые уроки появятся после проверки материалов. Пока можно повторять и говорить.' : 'Пока материалы на проверке, можно пройти вводную настройку и посмотреть план на девять месяцев.'}
            </p>
            {s.next_unit ? <Link className="btn" href={`/lesson/${s.next_unit.unit_id}`}>Продолжить урок <Icon name="arrow" size={16} /></Link> : <Link className="btn outline" href="/course">Открыть маршрут <Icon name="arrow" size={16} /></Link>}
          </div>
          <div className="hero-art" aria-hidden="true"><div className="sun" /><div className="sea" /><div className="island" /><div className="house" /><div className="step" /></div>
        </div>

        <div className="card cardpad home-plan">
          <div className="card-top"><div className="card-title"><Icon name="calendar" /> План на сегодня</div><span className="tag gray">{doneCount} из 4 доступны</span></div>
          {s.plan.status === 'NOT_STARTED' ? (
            <p className="quiet small">План появится после вводной настройки.</p>
          ) : (
            s.plan.blocks.map((b) => (
              <div className="plan-row" key={b.kind}>
                <span className={`lock-dot ${b.available ? 'ok' : ''}`} aria-hidden="true" />
                <span className="plan-text">
                  {b.available && b.href ? <Link href={b.href} style={{ textDecoration: 'none' }}>{b.title_ru}</Link> : b.title_ru}
                  <small className="event-text">{b.detail_ru}</small>
                </span>
                <span className="plan-time mono">{b.minutes} мин</span>
              </div>
            ))
          )}
          <div className="progress-track" style={{ marginTop: 10 }}><div className="progress-fill" style={{ width: `${s.enrollment && s.enrollment.total_days ? Math.round((s.enrollment.elapsed_days / s.enrollment.total_days) * 100) : 0}%` }} /></div>
          <p className="quiet tiny" style={{ marginTop: 8 }}>
            {s.plan.status === 'NO_ELIGIBLE_CONTENT' ? 'Сейчас нет доступных проверенных заданий — план не выдумывает задачи. ' : '30% коррекция (80/20 внутри), 20% повторение, 30% новое, 20% применение. '}
            {s.enrollment?.end_date ? `Цель 9 месяцев: до ${formatLocalDateRu(s.enrollment.end_date, { day: 'numeric', month: 'long', year: 'numeric' })} — ориентир, не обещание.` : ''}
          </p>
        </div>

        <div className="card cardpad">
          <div className="card-top"><div className="card-title"><Icon name="chart" /> Ритм обучения</div><Link className="text-link" href="/progress">Подробнее <Icon name="arrow" size={12} /></Link></div>
          <WeekBars week={s.week} />
          <p className="quiet tiny" style={{ marginTop: 10 }}>Активные минуты за последние 7 дней: {s.stats.minutes_7d}. Простой экрана не засчитывается.</p>
        </div>

        <div className="card cardpad">
          <div className="card-top"><div className="card-title"><Icon name="mic" /> Разговорная практика</div><span className="tag green">A0–B2</span></div>
          <div className="wave" aria-hidden="true">{Array.from({ length: 34 }, (_, i) => <span key={i} style={{ height: `${18 + Math.round(Math.abs(Math.sin(i * 1.7)) * 52)}px`, ['--i' as string]: i }} />)}</div>
          <p className="quiet small">Сценарии из жизни: кафе, банк, аптека, учёба. Голос синтезирован; подсказки и разбор — по запросу.</p>
          <Link className="btn outline" href="/speaking" style={{ width: '100%' }}>Открыть разговоры <Icon name="arrow" size={14} /></Link>
        </div>

        <div className="card cardpad">
          <div className="card-top"><div className="card-title"><Icon name="heart" /> Живой греческий</div><Link className="text-link" href="/real-greek">Все выражения <Icon name="arrow" size={12} /></Link></div>
          {rgReleased.length ? (
            <div className="real-lines">
              {rgReleased.map((r) => (
                <div className="real-line" key={r.expression_id}>
                  <span className="sound" aria-hidden="true"><Icon name="volume" size={15} /></span>
                  <div><strong className="greek-serif" style={{ fontSize: 15 }}>{r.expression}</strong><small>{String((r.payload as { meanings?: Array<{ gloss_ru?: string }> }).meanings?.[0]?.gloss_ru ?? '').slice(0, 60)}</small></div>
                </div>
              ))}
            </div>
          ) : <div className="empty"><strong>Выражения на проверке</strong>Регистр, контекст и интонацию сначала проверяют, потом публикуют.</div>}
        </div>

        <div className="card cardpad">
          <div className="card-top"><div className="card-title"><Icon name="school" /> Подготовка к B2</div><span className="tag gray">ΚΕΓ</span></div>
          <p className="quiet small">Три авторские тренировочные формы F01–F03 (15 компонентов). Не официальные экзамены и не калиброванный балл.</p>
          <Link className="btn outline" href="/exams" style={{ width: '100%' }}>Посмотреть раздел <Icon name="arrow" size={14} /></Link>
        </div>

        <div className="card cardpad">
          <div className="card-top"><div className="card-title"><Icon name="rotate" /> Повторить ошибки</div>{s.errors.open ? <span className="tag">{s.errors.open} открыто</span> : null}</div>
          {s.errors.recent.length ? (
            <>
              {s.errors.recent.map((e) => (
                <div className="review-row" key={e.id}><b>{e.competency_name ?? 'Задание'}</b><small>{e.error_kind === 'accent_orthography' ? 'ударение' : 'подтверждено'}</small></div>
              ))}
              <Link className="text-link" href="/errors">Перейти к практике <Icon name="arrow" size={12} /></Link>
            </>
          ) : <div className="empty"><strong>Подтверждённых ошибок нет</strong>Список появится только после реальных ответов. Неуверенное распознавание речи сюда не попадает.</div>}
          {s.reviews.due_today ? <p className="small" style={{ marginTop: 10 }}>Отсроченных проверок на сегодня: <b>{s.reviews.due_today}</b></p> : null}
        </div>

        <div className="card cardpad live-panel">
          <div className="card-top"><div className="card-title"><Icon name="rotate" /> События обучения <span className="live-dot" aria-hidden="true" /></div><span className="tag green">с сервера</span></div>
          <EventFeed events={s.events} />
          <p className="quiet tiny">Обновляется автоматически после подтверждённой записи на сервере — без ручного обновления страницы.</p>
        </div>
      </div>
    </section>
  );
}
