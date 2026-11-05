import Link from 'next/link';
import { requireLearner } from '@/lib/page';
import { adminClient } from '@/lib/supabase/admin';
import { releaseMap, isDevPreviewRelease } from '@/lib/content/repo';
import { ALPHABET_UNIT, STRESS_UNIT, parseAlphabet } from '@/lib/alphabet/reference';
import { Icon } from '@/components/Icon';
import { AlphabetBoard } from './AlphabetBoard';

export const metadata = { title: 'Алфавит и звуки' };

export default async function AlphabetPage() {
  const u = await requireLearner();
  const db = adminClient();
  const { data: units } = await db.from('units').select('unit_id, title_ru, current_hash, teaching').in('unit_id', [ALPHABET_UNIT, STRESS_UNIT]);
  const unit = (units ?? []).find((x) => x.unit_id === ALPHABET_UNIT);
  const stress = (units ?? []).find((x) => x.unit_id === STRESS_UNIT);
  const rel = await releaseMap('unit', (units ?? []).map((x) => ({ id: x.unit_id, hash: x.current_hash })), u);
  const open = !!unit && (rel.has(ALPHABET_UNIT) || u.isOwner);
  const t = (unit?.teaching ?? {}) as { theory_ru?: string; examples_el?: string[] };
  const ref = open && t.theory_ru ? parseAlphabet(t.theory_ru, t.examples_el ?? []) : null;
  const preview = open && isDevPreviewRelease(rel.get(ALPHABET_UNIT));

  return (
    <section className="screen active">
      <div className="screen-head">
        <div>
          <div className="eyebrow">GreekOS / Основы чтения</div>
          <h1 className="screen-title">Алфавит и звуки</h1>
          <p className="screen-sub">24 буквы, их названия и сочетания, которые читаются как один звук. Справочник собран из урока «{unit?.title_ru ?? 'Алфавит'}»; нажмите на букву, чтобы послушать название и слова из урока.</p>
        </div>
        <div className="row">
          {open ? <Link className="btn" href={`/lesson/${ALPHABET_UNIT}`}>Урок «Алфавит» <Icon name="arrow" size={15} /></Link> : null}
          {stress && rel.has(STRESS_UNIT) ? <Link className="btn outline" href={`/lesson/${STRESS_UNIT}`}>Ударение и звуки</Link> : null}
        </div>
      </div>
      {preview ? <div className="banner warn"><Icon name="eye" /><span><strong>DEV-PREVIEW.</strong> Урок ещё не выпущен ученикам; озвучка — синтез с автоматической проверкой распознаванием, не запись носителя.</span></div> : null}
      {!ref ? (
        <div className="card cardpad"><div className="empty"><strong>Урок «Алфавит» на проверке</strong>Справочник откроется вместе с уроком после выпуска. До этого можно начать с диагностики или вводного маршрута.</div><div className="row" style={{ justifyContent: 'center' }}><Link className="btn outline" href="/course">Мой маршрут</Link></div></div>
      ) : ref.letters.length !== 24 ? (
        <div className="banner warn"><Icon name="alert" /><span>Справочник урока не распознан полностью ({ref.letters.length} из 24 букв) — показываем урок без справочника.</span></div>
      ) : (
        <AlphabetBoard unitId={ALPHABET_UNIT} letters={ref.letters} digraphs={ref.digraphs} />
      )}
    </section>
  );
}
