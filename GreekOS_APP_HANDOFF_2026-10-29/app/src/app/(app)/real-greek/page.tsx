import Link from 'next/link';
import { requireLearner } from '@/lib/page';
import { rgExpressions } from '@/lib/modules/loaders';
import { registerLabel } from '@/lib/modules/display';
import { Icon } from '@/components/Icon';
import { RgDetail } from './RgDetail';
import './real-greek.css';

export const metadata = { title: 'Живой греческий' };

export default async function RealGreekPage({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  const u = await requireLearner();
  const sp = await searchParams;
  const all = await rgExpressions();
  const visible = all.filter((x) => x.released || u.isOwner);
  const selected = visible.find((x) => x.expression_id === sp.e) ?? visible[0] ?? null;
  return (
    <section className="screen active">
      <div className="screen-head">
        <div><div className="eyebrow">GreekOS / Живой греческий</div><h1 className="screen-title">Живой греческий</h1><p className="screen-sub">Разговорные выражения в контексте: регистр, уместность, нейтральная замена и честный статус источников.</p></div>
        <span className="pill"><span className="dot" /> {all.filter((x) => x.released).length} из {all.length} выпущено</span>
      </div>
      <div className="banner info"><Icon name="info" /><span><strong>Не входит в уровни CEFR и не повышает экзаменационную готовность.</strong> Словарь и форумы не доказывают частотность в 2026 году; интонацию без проверенного звука мы не оцениваем.</span></div>
      {!visible.length ? (
        <div className="card empty"><strong>Выражения проходят проверку</strong>Регистр, региональные оговорки и интонацию сначала проверяют, затем публикуют. Это не связано с вашими результатами.</div>
      ) : (
        <div className="real-layout">
          <div className="expression-list">
            {visible.map((x) => {
              const gloss = x.payload.meanings?.[0]?.gloss_ru ?? '';
              return (
                <Link key={x.expression_id} href={`/real-greek?e=${x.expression_id}`} scroll={false} className={`expression ${selected?.expression_id === x.expression_id ? 'selected' : ''} ${!x.released ? 'watermark' : ''}`} aria-current={selected?.expression_id === x.expression_id ? 'true' : undefined}>
                  <strong lang="el">{x.expression}</strong>
                  <p>{gloss.length > 90 ? `${gloss.slice(0, 90)}…` : gloss}</p>
                  <div className="tag-row"><span className="tag">{registerLabel(x.payload)}</span>{!x.released ? <span className="tag gray">предпросмотр</span> : null}</div>
                </Link>
              );
            })}
          </div>
          {selected ? (
            <aside className={`card cardpad real-detail ${!selected.released ? 'watermark' : ''}`} aria-label="Подробности выражения">
              <RgDetail p={selected.payload} />
              <Link className="btn mt16" href={`/real-greek/${selected.expression_id}`} style={{ width: '100%' }}>Контексты и практика <Icon name="arrow" size={14} /></Link>
            </aside>
          ) : null}
        </div>
      )}
    </section>
  );
}
