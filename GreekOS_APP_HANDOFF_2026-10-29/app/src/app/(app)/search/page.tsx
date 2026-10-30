import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';
import { releaseMap } from '@/lib/content/repo';

export const metadata = { title: 'Поиск' };

const SECTIONS = [
  ['Главная', '/'], ['Мой курс', '/course'], ['Практика', '/practice'], ['Живой греческий', '/real-greek'], ['Разговоры', '/speaking'],
  ['Аудирование', '/listening'], ['Письмо', '/writing'], ['Мои ошибки', '/errors'], ['Экзамены ΚΕΓ', '/exams'], ['ΠΕΓΠ', '/pegp'],
  ['Прогресс', '/progress'], ['Определение уровня', '/diagnostic'], ['Настройки', '/settings'],
];

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const u = await requireUser();
  const q = ((await searchParams).q ?? '').trim().slice(0, 80);
  const needle = q.toLocaleLowerCase('ru');
  const db = adminClient();
  const [{ data: units }, { data: rg }] = await Promise.all([
    db.from('units').select('unit_id, title_ru, level, current_hash'),
    db.from('rg_expressions').select('expression_id, expression, current_hash'),
  ]);
  const [uRel, rRel] = await Promise.all([
    releaseMap('unit', (units ?? []).map((x) => ({ id: x.unit_id, hash: x.current_hash })), u),
    releaseMap('rg_expression', (rg ?? []).map((x) => ({ id: x.expression_id, hash: x.current_hash })), u),
  ]);
  const unitHits = needle ? (units ?? []).filter((x) => x.title_ru.toLocaleLowerCase('ru').includes(needle) || x.unit_id.toLowerCase().includes(needle)) : [];
  const rgHits = needle ? (rg ?? []).filter((x) => (rRel.has(x.expression_id) || u.isOwner) && x.expression.toLocaleLowerCase('el').includes(needle)) : [];
  const secHits = needle ? SECTIONS.filter(([n]) => n.toLocaleLowerCase('ru').includes(needle)) : [];
  return (
    <section className="screen active">
      <div className="screen-head"><div><div className="eyebrow">GreekOS / Поиск</div><h1 className="screen-title">Поиск</h1><p className="screen-sub">{q ? `Результаты по запросу «${q}»` : 'Введите запрос в строке поиска.'}</p></div></div>
      <div className="stack">
        {secHits.length ? <div className="card cardpad"><div className="card-title">Разделы</div>{secHits.map(([n, h]) => <div className="review-row" key={h}><Link href={h}>{n}</Link></div>)}</div> : null}
        <div className="card cardpad"><div className="card-title">Уроки</div>
          {unitHits.length ? unitHits.map((x) => <div className="review-row" key={x.unit_id}><Link href={`/lesson/${x.unit_id}`}>{x.title_ru}</Link><small>{x.level} · {uRel.has(x.unit_id) ? 'открыт' : 'на проверке'}</small></div>) : <p className="small quiet">Нет совпадений.</p>}
        </div>
        <div className="card cardpad"><div className="card-title">Живой греческий</div>
          {rgHits.length ? rgHits.map((x) => <div className="review-row" key={x.expression_id}><Link href={`/real-greek/${x.expression_id}`} lang="el">{x.expression}</Link></div>) : <p className="small quiet">Нет совпадений среди выпущенных выражений.</p>}
        </div>
      </div>
    </section>
  );
}
