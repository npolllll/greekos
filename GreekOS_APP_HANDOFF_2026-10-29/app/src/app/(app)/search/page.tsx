import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';
import { releaseMap } from '@/lib/content/repo';

export const metadata = { title: 'Поиск' };

/** Accent-, case- and final-sigma-insensitive form used for matching (καφέ = ΚΑΦΕ = καφε). */
const fold = (x: string) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/ς/g, 'σ');
interface Teaching { examples_el?: string[]; vocabulary_items?: Array<{ lemma?: string; meaning_ru?: string; example?: string }> }

const SECTIONS = [
  ['Главная', '/'], ['Мой курс', '/course'], ['Практика', '/practice'], ['Живой греческий', '/real-greek'], ['Разговоры', '/speaking'],
  ['Аудирование', '/listening'], ['Письмо', '/writing'], ['Мои ошибки', '/errors'], ['Экзамены ΚΕΓ', '/exams'], ['ΠΕΓΠ', '/pegp'],
  ['Прогресс', '/progress'], ['Определение уровня', '/diagnostic'], ['Настройки', '/settings'],
];

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const u = await requireUser();
  const q = ((await searchParams).q ?? '').trim().slice(0, 80);
  const needle = fold(q);
  const db = adminClient();
  const [{ data: units }, { data: rg }] = await Promise.all([
    db.from('units').select('unit_id, title_ru, level, current_hash, sort_key, teaching').order('sort_key'),
    db.from('rg_expressions').select('expression_id, expression, current_hash'),
  ]);
  const [uRel, rRel] = await Promise.all([
    releaseMap('unit', (units ?? []).map((x) => ({ id: x.unit_id, hash: x.current_hash })), u),
    releaseMap('rg_expression', (rg ?? []).map((x) => ({ id: x.expression_id, hash: x.current_hash })), u),
  ]);
  const unitHits = needle ? (units ?? []).filter((x) => fold(x.title_ru).includes(needle) || fold(x.unit_id).includes(needle)) : [];
  // Words and examples come only from lessons this learner may open: unreleased text is never shown.
  const wordHits: Array<{ unit_id: string; title: string; el: string; ru: string | null }> = [];
  if (needle.length >= 2) for (const x of units ?? []) {
    if (!uRel.has(x.unit_id) && !u.isOwner) continue;
    const t = (x.teaching ?? {}) as Teaching;
    for (const v of t.vocabulary_items ?? []) if (v.lemma && (fold(v.lemma).includes(needle) || fold(v.meaning_ru ?? '').includes(needle))) wordHits.push({ unit_id: x.unit_id, title: x.title_ru, el: v.lemma, ru: v.meaning_ru ?? null });
    for (const e of t.examples_el ?? []) if (fold(e).includes(needle)) wordHits.push({ unit_id: x.unit_id, title: x.title_ru, el: e, ru: null });
  }
  const rgHits = needle ? (rg ?? []).filter((x) => (rRel.has(x.expression_id) || u.isOwner) && fold(x.expression).includes(needle)) : [];
  const secHits = needle ? SECTIONS.filter(([n]) => fold(n).includes(needle)) : [];
  return (
    <section className="screen active">
      <div className="screen-head"><div><div className="eyebrow">GreekOS / Поиск</div><h1 className="screen-title">Поиск</h1><p className="screen-sub">{q ? `Результаты по запросу «${q}»` : 'Введите запрос в строке поиска.'}</p></div></div>
      <div className="stack">
        {secHits.length ? <div className="card cardpad"><div className="card-title">Разделы</div>{secHits.map(([n, h]) => <div className="review-row" key={h}><Link href={h}>{n}</Link></div>)}</div> : null}
        <div className="card cardpad"><div className="card-title">Уроки</div>
          {unitHits.length ? unitHits.map((x) => <div className="review-row" key={x.unit_id}><Link href={`/lesson/${x.unit_id}`}>{x.title_ru}</Link><small>{x.level} · {uRel.has(x.unit_id) ? 'открыт' : 'на проверке'}</small></div>) : <p className="small quiet">Нет совпадений.</p>}
        </div>
        <div className="card cardpad"><div className="card-title">Слова и фразы из уроков</div>
          {wordHits.length ? wordHits.slice(0, 30).map((w, i) => <div className="review-row" key={`${w.unit_id}-${i}`}><span style={{ minWidth: 0 }}><Link href={`/lesson/${w.unit_id}`} lang="el" className="display" style={{ fontSize: 16 }}>{w.el}</Link>{w.ru ? <small className="quiet"> — {w.ru}</small> : null}</span><small>{w.title}</small></div>) : <p className="small quiet">{needle.length >= 2 ? 'Нет совпадений в открытых вам уроках.' : 'Введите хотя бы две буквы.'}</p>}
          {wordHits.length > 30 ? <p className="tiny quiet">Показаны первые 30 из {wordHits.length}.</p> : null}
        </div>
        <div className="card cardpad"><div className="card-title">Живой греческий</div>
          {rgHits.length ? rgHits.map((x) => <div className="review-row" key={x.expression_id}><Link href={`/real-greek/${x.expression_id}`} lang="el">{x.expression}</Link></div>) : <p className="small quiet">Нет совпадений среди выпущенных выражений.</p>}
        </div>
      </div>
    </section>
  );
}
