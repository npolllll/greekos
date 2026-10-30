import Link from 'next/link';
import { requireLearner } from '@/lib/page';
import { loadCourse, nextUnit, FOUNDATION_UNITS } from '@/lib/learning/course';
import { adminClient } from '@/lib/supabase/admin';
import { formatLocalDateRu, planEndDate } from '@/lib/learning/calendar';
import { Icon } from '@/components/Icon';

export const metadata = { title: 'Мой курс' };
const LEVELS = ['A1', 'A2', 'B1', 'B2'] as const;

export default async function CoursePage({ searchParams }: { searchParams: Promise<{ level?: string }> }) {
  const u = await requireLearner();
  const sp = await searchParams;
  const course = await loadCourse(u.userId, u);
  const next = nextUnit(course);
  const { data: enr } = await adminClient().from('enrollments').select('start_date, exam_date').eq('user_id', u.userId).maybeSingle();
  const level = (LEVELS as readonly string[]).includes(sp.level ?? '') ? sp.level! : next?.level ?? 'A1';
  const list = course.units.filter((x) => x.level === level);
  const byLevel = Object.fromEntries(LEVELS.map((l) => [l, course.units.filter((x) => x.level === l)]));

  return (
    <section className="screen active">
      <div className="screen-head">
        <div><div className="eyebrow">GreekOS / Мой курс</div><h1 className="screen-title">Маршрут A1–B2</h1>
          <p className="screen-sub">{course.units.length} уроков. {enr?.start_date ? `Старт ${formatLocalDateRu(enr.start_date, { day: 'numeric', month: 'long', year: 'numeric' })}, цель — ${formatLocalDateRu(planEndDate(enr.start_date), { day: 'numeric', month: 'long', year: 'numeric' })} (9 месяцев, ориентир).` : 'Маршрут начнётся после вводной настройки.'}</p></div>
        <span className="pill"><span className="dot" /> {course.routeKind === 'foundations' ? 'Старт с нуля: алфавит и звуки' : course.routeKind === 'verified' ? 'Маршрут подтверждён' : course.routeKind === 'manual' ? 'Маршрут задан владельцем' : 'Предварительный маршрут'}</span>
      </div>
      {course.units.every((x) => !x.released) ? <div className="banner warn"><Icon name="lock" /><span><strong>Материалы проходят проверку.</strong> Все 87 уроков импортированы и закрыты до решения о выпуске. Порядок маршрута уже рассчитан для вас.</span></div> : null}
      <div className="course-layout">
        <div>
          <div className="level-tabs" role="tablist" aria-label="Уровни">
            {LEVELS.map((l) => (
              <Link key={l} role="tab" aria-selected={l === level} className={`level-tab ${l === level ? 'active' : ''}`} href={`/course?level=${l}`}>
                {l} <span className="tiny" style={{ opacity: 0.7 }}>{byLevel[l].filter((x) => x.released).length}/{byLevel[l].length}</span>
              </Link>
            ))}
          </div>
          <div className="unit-list mt16">
            {list.map((x, i) => {
              const status = !x.released ? { cls: 'gray', t: 'На проверке' } : x.completed ? { cls: 'green', t: 'Пройден' } : next?.unit_id === x.unit_id ? { cls: '', t: 'Следующий' } : x.skippable_by_placement ? { cls: 'blue', t: 'Можно пропустить' } : x.started ? { cls: '', t: 'Начат' } : { cls: 'gray', t: 'Открыт' };
              return (
                <Link key={x.unit_id} className="unit-row" href={`/lesson/${x.unit_id}`}>
                  <span className="unit-num">{FOUNDATION_UNITS.includes(x.unit_id) ? 'α' : i + 1}</span>
                  <div style={{ minWidth: 0 }}>
                    <h3>{x.title_ru}</h3>
                    <p>{x.unit_id}{x.released ? ` · ${x.item_usable} из ${x.item_total} заданий доступны${x.item_audio_pending ? ` · ${x.item_audio_pending} ждут аудио` : ''}` : ''}</p>
                  </div>
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
            <p className="small quiet">С опытом: точка входа по диагностике навыков; уроки до неё помечены «Можно пропустить», но остаются доступными.</p>
            <Link className="text-link" href="/diagnostic">Определение уровня <Icon name="arrow" size={12} /></Link>
          </div>
          <div className="card cardpad">
            <div className="card-title"><Icon name="info" /> Статусы</div>
            <div className="locked-item"><span className="lock-dot ok" />Открыт — материал выпущен для учеников</div>
            <div className="locked-item"><span className="lock-dot" />На проверке — ждёт решения о выпуске</div>
            <div className="locked-item"><span className="lock-dot audio" />Ждёт аудио — без звука аудирование не проводится</div>
          </div>
        </aside>
      </div>
    </section>
  );
}
