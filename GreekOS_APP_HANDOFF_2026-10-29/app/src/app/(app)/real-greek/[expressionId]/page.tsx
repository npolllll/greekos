import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireLearner } from '@/lib/page';
import { rgExpressions, rgItems } from '@/lib/modules/loaders';
import { ItemPlayer } from '@/components/ItemPlayer';
import { Icon } from '@/components/Icon';
import { RgDetail } from '../RgDetail';
import '../real-greek.css';

export const metadata = { title: 'Живой греческий — выражение' };

export default async function RgExpressionPage({ params }: { params: Promise<{ expressionId: string }> }) {
  const u = await requireLearner();
  const { expressionId } = await params;
  const x = (await rgExpressions(u)).find((e) => e.expression_id === expressionId);
  if (!x || (!x.released && !u.isOwner)) notFound();
  const items = await rgItems(x.expression_id, u);
  const usable = items.filter((d) => d.access.learnerUsable || u.isOwner);
  const locked = items.filter((d) => !d.access.learnerUsable && !u.isOwner);
  return (
    <section className="screen active">
      <div className="screen-head">
        <div><div className="eyebrow">GreekOS / Живой греческий / {x.expression_id}</div><h1 className="screen-title" lang="el">{x.expression}</h1><p className="screen-sub">Смысл зависит от ситуации, отношений и подачи. Практика — отдельно от курса и экзаменов.</p></div>
        <Link className="btn outline" href={`/real-greek?e=${x.expression_id}`}><Icon name="heart" size={15} /> Все выражения</Link>
      </div>
      <div className="banner info"><Icon name="info" /><span>Не входит в уровни CEFR и не повышает экзаменационную готовность.</span></div>
      <div className="lesson-layout">
        <div className="stack">
          {usable.length === 0 ? <div className="card empty"><strong>Задания проходят проверку</strong>Они появятся после выпуска.</div> : null}
          {usable.map((d) => <ItemPlayer key={d.dto.item_id} item={d.dto} context="real_greek" preview={!d.access.learnerUsable} />)}
          {locked.length ? (
            <div className="card cardpad">
              <div className="card-title"><Icon name="lock" /> Закрытые задания</div>
              {locked.map((l) => <div className="locked-item" key={l.dto.item_id}><span className="lock-dot" />{l.dto.item_id}<span className="muted" style={{ marginLeft: 'auto' }}>на проверке</span></div>)}
            </div>
          ) : null}
        </div>
        <aside className={`card cardpad ${!x.released ? 'watermark' : ''}`} style={{ alignSelf: 'start' }}>
          <RgDetail p={x.payload} full />
        </aside>
      </div>
    </section>
  );
}
