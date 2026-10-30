import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireLearner } from '@/lib/page';
import { pegpTopic } from '@/lib/modules/loaders';
import { PEGP_TOPICS, PEGP_DOMAIN_RU, pegpDomainOfItem, type PegpTopic } from '@/lib/modules/display';
import { ItemPlayer } from '@/components/ItemPlayer';
import { Icon } from '@/components/Icon';
import '../pegp.css';

export const metadata = { title: 'ΠΕΓΠ — тема' };

interface LearningCard { competency_id?: string; fact_el?: string; explanation_ru?: string; source_refs?: Array<{ url?: string; pdf_page?: number; bank_version?: string; checked_on?: string }> }

function fmtDate(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : null;
}

export default async function PegpTopicPage({ params }: { params: Promise<{ topic: string }> }) {
  const u = await requireLearner();
  const { topic } = await params;
  if (!PEGP_TOPICS.includes(topic as PegpTopic)) notFound();
  const v = await pegpTopic(topic as PegpTopic, u);
  const visibleItems = v.items.filter((i) => u.isOwner || i.delivered.access.learnerUsable);
  const locked = v.items.filter((i) => !u.isOwner && !i.delivered.access.learnerUsable);

  return (
    <section className="screen active">
      <div className="screen-head">
        <div><div className="eyebrow">GreekOS / ΠΕΓΠ / {topic}</div><h1 className="screen-title">ΠΕΓΠ · пакет {Number(topic.slice(1))}</h1><p className="screen-sub">{v.items.length} заданий сопоставлено; доступно {v.items.filter((i) => i.delivered.access.learnerUsable).length}.</p></div>
        <Link className="btn outline" href="/pegp"><Icon name="flag" size={15} /> Все темы</Link>
      </div>
      <div className="banner info"><Icon name="info" /><span>Факт и язык оцениваются раздельно; ошибка ударения ≠ неверный гражданский факт. Не ΚΕΓ B2 и не официальный экзамен.</span></div>

      {v.packets.map((p) => {
        const pl = p.payload;
        const show = p.released || u.isOwner;
        const cards = (Array.isArray(pl.learning_cards) ? pl.learning_cards : []) as LearningCard[];
        return (
          <div className={`card cardpad mt8 ${!p.released && u.isOwner ? 'watermark' : ''}`} key={p.packet_id}>
            <div className="row between"><div className="card-title">{p.kind === 'language_support' ? 'Языковая поддержка' : 'Тематический пакет'} · {p.packet_id}</div><span className={`tag ${p.released ? 'green' : 'gray'}`}>{p.released ? 'выпущен' : 'на проверке'}</span></div>
            {!show ? <p className="small quiet">Учебные карточки откроются после проверки и выпуска пакета.</p> : (
              <>
                {typeof pl.theory_ru === 'string' ? <p className="theory small">{pl.theory_ru}</p> : null}
                {typeof pl.teaching_ru === 'string' ? <p className="theory small">{pl.teaching_ru}</p> : null}
                {typeof pl.original_text_el === 'string' ? <div className="stimulus" lang="el">{pl.original_text_el}</div> : null}
                {cards.length ? (
                  <details className="box mt8"><summary>Учебные карточки ({cards.length})</summary>
                    {cards.map((c, i) => (
                      <div className="review-row" key={`${c.competency_id}-${i}`}>
                        <div>
                          {c.fact_el ? <div className="pegp-card-fact" lang="el">{c.fact_el}</div> : null}
                          {c.explanation_ru ? <div className="small quiet">{c.explanation_ru}</div> : null}
                          {c.source_refs?.length ? <ul className="pegp-sources">{c.source_refs.map((s, j) => <li key={j}>{s.url ? <a href={s.url} target="_blank" rel="noreferrer noopener">источник</a> : 'источник'}{s.pdf_page ? ` · стр. PDF ${s.pdf_page}` : ''}{s.bank_version ? ` · банк ${s.bank_version}` : ''}{s.checked_on ? ` · проверено ${s.checked_on}` : ''}</li>)}</ul> : null}
                        </div>
                      </div>
                    ))}
                  </details>
                ) : null}
              </>
            )}
          </div>
        );
      })}

      <div className="stack mt16">
        {visibleItems.length === 0 ? <div className="card empty"><strong>Задания этой темы проходят проверку</strong>Они откроются после выпуска с указанием срока действия допуска.</div> : null}
        {visibleItems.map((i) => {
          const preview = !i.delivered.access.learnerUsable;
          const w = i.window;
          return (
            <div key={i.delivered.dto.item_id}>
              <div className="row between" style={{ margin: '0 4px 6px' }}>
                <span className="tag gray">{PEGP_DOMAIN_RU[pegpDomainOfItem(i.delivered.dto.item_id)]}</span>
                <span className="tiny muted">{w ? (w.expired ? `Допуск истёк ${fmtDate(w.expires_at)}` : w.expires_at ? `Допуск действует до ${fmtDate(w.expires_at)}` : 'Допуск без срока — уточните сессию') : 'Не выпущено'}</span>
              </div>
              <ItemPlayer item={i.delivered.dto} context="pegp" preview={preview} />
              {i.sources.length ? (
                <ul className="pegp-sources" style={{ margin: '8px 6px 0' }}>
                  {i.sources.map((s, j) => (
                    <li key={j}>
                      {s.url ? <a href={s.url} target="_blank" rel="noreferrer noopener">{s.source_id ?? 'источник'}</a> : s.source_id ?? 'источник'}
                      {s.bank_version ? ` · банк ${s.bank_version}` : ''}{s.pdf_page ? ` · стр. PDF ${s.pdf_page}` : ''}{s.official_topic ? ` · тема ${s.official_topic}` : ''}{s.checked_on ? ` · проверено ${s.checked_on}` : ''}
                    </li>
                  ))}
                </ul>
              ) : <p className="tiny muted" style={{ margin: '8px 6px 0' }}>Ссылка на источник для этого задания не зарегистрирована.</p>}
            </div>
          );
        })}
        {locked.length ? (
          <div className="card cardpad">
            <div className="card-title"><Icon name="lock" /> Закрытые задания ({locked.length})</div>
            {locked.map((l) => <div className="locked-item" key={l.delivered.dto.item_id}><span className="lock-dot" />{l.delivered.dto.item_id}<span className="muted" style={{ marginLeft: 'auto' }}>{l.window?.expired ? 'допуск истёк' : l.delivered.access.reason === 'AUDIO_PENDING' ? 'нет аудио' : 'на проверке'}</span></div>)}
          </div>
        ) : null}
      </div>
    </section>
  );
}
