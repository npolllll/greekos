import Link from 'next/link';
import { ViewTransition } from 'react';
import { requireLearner } from '@/lib/page';
import { loadCourse, nextUnit, FOUNDATION_UNITS, type UnitSummary } from '@/lib/learning/course';
import { adminClient } from '@/lib/supabase/admin';
import { formatLocalDateRu, planEndDate } from '@/lib/learning/calendar';
import { Icon } from '@/components/Icon';
import { ProgressRing } from '@/components/ui/Motion';

export const metadata = { title: 'Мой маршрут' };
const LEVELS = ['A0', 'A1', 'A2', 'B1', 'B2'] as const;
const LEVEL_RU: Record<string, string> = { A0: 'Основы', A1: 'Начальный', A2: 'Повседневный', B1: 'Самостоятельный', B2: 'Уверенный' };

function levelOf(u: UnitSummary): (typeof LEVELS)[number] {
  return FOUNDATION_UNITS.includes(u.unit_id) ? 'A0' : (u.level as (typeof LEVELS)[number]);
}

export default async function CoursePage({ searchParams }: { searchParams: Promise<{ level?: string }> }) {
  const u = await requireLearner();
  const sp = await searchParams;
  const course = await loadCourse(u.userId, u);
  const next = nextUnit(course);
  const { data: enr } = await adminClient().from('enrollments').select('start_date, exam_date').eq('user_id', u.userId).maybeSingle();
  const byLevel = Object.fromEntries(LEVELS.map((l) => [l, course.units.filter((x) => levelOf(x) === l)])) as Record<string, UnitSummary[]>;
  // A from-zero route starts with the foundations (alphabet, sounds) even while they are still gated:
  // the learner sees where the path begins instead of a later released unit.
  const foundationsOpen = course.routeKind === 'foundations' && course.units.some((u) => FOUNDATION_UNITS.includes(u.unit_id) && !u.completed);
  const nextLevel = foundationsOpen ? 'A0' : next ? levelOf(next) : 'A1';
  const level = (LEVELS as readonly string[]).includes(sp.level ?? '') ? sp.level! : nextLevel;
  const list = byLevel[level] ?? [];
  const stats = (l: string) => { const xs = byLevel[l]; const done = xs.filter((x) => x.completed).length; return { done, total: xs.length, pct: xs.length ? Math.round((done / xs.length) * 100) : 0, open: xs.filter((x) => x.released).length }; };
  const anyPreview = course.units.some((x) => x.dev_preview);

  return (
    <section className="screen active">
      <div className="screen-head">
        <div><div className="eyebrow">GreekOS / Мой маршрут</div><h1 className="screen-title">Маршрут A0 → B2</h1>
          <p className="screen-sub">{course.units.length} уроков, от букв и звуков до уверенного B2. {enr?.start_date ? `Старт ${formatLocalDateRu(enr.start_date, { day: 'numeric', month: 'long' })}, ориентир — ${formatLocalDateRu(planEndDate(enr.start_date), { month: 'long', year: 'numeric' })} (9 месяцев, не гарантия).` : 'Маршрут начнётся после вводной настройки.'}</p></div>
        <span className="pill"><span className="dot" /> {course.routeKind === 'foundations' ? 'Старт с нуля: алфавит и звуки' : course.routeKind === 'verified' ? 'Маршрут подтверждён диагностикой' : course.routeKind === 'manual' ? 'Маршрут задан владельцем' : 'Предварительный маршрут'}</span>
      </div>
      {anyPreview ? <div className="banner preview"><Icon name="eye" /><span><strong>DEV-PREVIEW.</strong> Невыпущенные уроки открыты этому тестовому аккаунту в локальной среде и отмечены как «не выпущен».</span></div>
        : course.units.every((x) => !x.released) ? <div className="banner warn"><Icon name="lock" /><span><strong>Материалы проходят проверку.</strong> Уроки закрыты до цифровой проверки и решения о выпуске. Порядок маршрута уже рассчитан для вас.</span></div> : null}

      {/* Level journey */}
      <div className="card cardpad" style={{ marginBottom: 16 }}>
        <div className="route-journey" role="list" aria-label="Уровни маршрута">
          {LEVELS.map((l, i) => {
            const s = stats(l);
            const state = s.total && s.done === s.total ? 'done' : l === nextLevel ? 'current' : LEVELS.indexOf(l) < LEVELS.indexOf(nextLevel as (typeof LEVELS)[number]) ? 'done' : 'future';
            return (
              <Link key={l} role="listitem" href={`/course?level=${l}`} className={`journey-step ${state} ${l === level ? 'selected' : ''}`} aria-current={l === level ? 'true' : undefined}>
                <ProgressRing value={s.pct} size={64} stroke={6} label={<span style={{ fontSize: 15 }}>{l}</span>} tone={state === 'done' ? 'olive' : 'accent'} />
                <span><b>{LEVEL_RU[l]}</b><small>{s.done}/{s.total} уроков · {s.open} открыто</small></span>
                {i < LEVELS.length - 1 ? <i className="journey-line" aria-hidden="true" /> : null}
              </Link>
            );
          })}
        </div>
      </div>

      <div className="course-layout">
        <div className="route-level">
          <div className="route-level-head">
            <span className={`route-badge ${stats(level).done === stats(level).total && stats(level).total ? 'done' : level === nextLevel ? '' : 'future'}`}>{level}</span>
            <div><b style={{ fontSize: 17 }}>{level === 'A0' ? 'Основы: алфавит, звуки, ударение' : `${level} · ${LEVEL_RU[level]}`}</b><div className="tiny quiet">{stats(level).done} из {stats(level).total} уроков завершено</div></div>
          </div>
          <div className="unit-list stagger">
            {list.map((x, i) => {
              const status = !x.released ? { cls: 'gray', t: 'На проверке' } : x.completed ? { cls: 'green', t: 'Пройден' } : next?.unit_id === x.unit_id ? { cls: '', t: 'Следующий' } : x.skippable_by_placement ? { cls: 'blue', t: 'Можно пропустить' } : x.started ? { cls: '', t: 'Начат' } : { cls: 'gray', t: 'Открыт' };
              return (
                <Link key={x.unit_id} className="unit-row" href={`/lesson/${x.unit_id}`} transitionTypes={['nav-forward']} style={next?.unit_id === x.unit_id ? { borderColor: 'rgba(223,106,46,.45)', background: 'var(--glass-3)' } : undefined}>
                  <span className={`unit-num ${x.completed ? 'done' : !x.released ? 'locked' : ''}`}>{x.completed ? <Icon name="check" size={16} /> : FOUNDATION_UNITS.includes(x.unit_id) ? 'α' : i + 1}</span>
                  <div style={{ minWidth: 0 }}>
                    <ViewTransition name={`unit-title-${x.unit_id}`} share="morph" default="none"><h3>{x.title_ru}</h3></ViewTransition>
                    <p>{x.unit_id}{x.released ? ` · ${x.item_usable} из ${x.item_total} заданий доступны${x.item_audio_pending ? ` · ${x.item_audio_pending} ждут аудио` : ''}` : ''}{x.estimated_active_minutes ? ` · ≈ ${x.estimated_active_minutes} мин` : ''}</p>
                  </div>
                  {x.dev_preview ? <span className="mode-badge preview">не выпущен</span> : null}
                  <span className={`tag ${status.cls}`}>{status.t}</span>
                </Link>
              );
            })}
          </div>
        </div>
        <aside className="stack">
          <div className="card cardpad">
            <div className="card-title"><Icon name="spark" /> Как строится маршрут</div>
            <p className="small quiet">С нуля: сначала «Алфавит» (U-A1-007) и «Ударение и звуки» (U-A1-008), затем коммуникативные уроки A1. Номер урока ≠ порядок обучения.</p>
            <p className="small quiet">С опытом: точка входа по диагностике навыков; уроки до неё помечены «Можно пропустить», но остаются доступными для повторения.</p>
            <div className="row"><Link className="btn small outline" href="/diagnostic">Определение уровня</Link><Link className="btn small outline" href="/alphabet">Тренажёр алфавита</Link></div>
          </div>
          <div className="card cardpad">
            <div className="card-title"><Icon name="info" /> Статусы</div>
            <div className="locked-item"><span className="lock-dot ok" />Открыт — материал выпущен для учеников</div>
            <div className="locked-item"><span className="lock-dot preview" />Не выпущен — виден только в DEV-PREVIEW</div>
            <div className="locked-item"><span className="lock-dot" />На проверке — ждёт решения о выпуске</div>
            <div className="locked-item"><span className="lock-dot audio" />Ждёт аудио — без звука аудирование не проводится</div>
          </div>
        </aside>
      </div>
    </section>
  );
}
