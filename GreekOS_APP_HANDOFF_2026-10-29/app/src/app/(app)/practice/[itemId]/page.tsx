import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireLearner } from '@/lib/page';
import { loadItem, releaseMap } from '@/lib/content/repo';
import { deliverItems } from '@/lib/content/delivery';
import { ItemPlayer } from '@/components/ItemPlayer';
import { Icon } from '@/components/Icon';

export const metadata = { title: 'Задание' };

const CONTEXTS = new Set(['lesson', 'review', 'corrective', 'writing', 'pegp', 'real_greek', 'transfer']);
const CONTEXT_RU: Record<string, string> = { review: 'Отсроченное повторение', corrective: 'Работа над ошибками', writing: 'Самостоятельное применение', lesson: 'Практика урока', pegp: 'ΠΕΓΠ', real_greek: 'Живой греческий', transfer: 'Перенос' };

export default async function PracticeItemPage({ params, searchParams }: { params: Promise<{ itemId: string }>; searchParams: Promise<{ context?: string; preview?: string }> }) {
  const u = await requireLearner();
  const { itemId } = await params;
  const sp = await searchParams;
  const row = await loadItem(decodeURIComponent(itemId));
  if (!row) notFound();
  const [d] = await deliverItems([row], { ownerPreview: u.isOwner });
  const preview = u.isOwner && (sp.preview === '1' || !d?.access.learnerUsable);
  const context = CONTEXTS.has(sp.context ?? '') ? sp.context! : 'corrective';
  const release = (await releaseMap('item', [{ id: row.item_id, hash: row.current_hash }])).get(row.item_id);
  return (
    <section className="screen active">
      <div className="screen-head"><div><div className="eyebrow">GreekOS / {CONTEXT_RU[context]}</div><h1 className="screen-title">Задание</h1><p className="screen-sub">Ответ проверяется на сервере. Помощь и предпросмотр не засчитываются как самостоятельное освоение.</p></div><Link className="btn outline" href="/practice"><Icon name="layers" size={15} /> Все задания</Link></div>
      {!d ? (
        <div className="banner danger"><Icon name="alert" /><span>Этот тип задания не поддерживается интерфейсом — оценка не выставляется. Ошибка записана для редактора.</span></div>
      ) : !d.access.learnerUsable && !preview ? (
        <div className="banner warn"><Icon name="lock" /><span><strong>{d.access.reason === 'AUDIO_PENDING' ? 'Аудио пока недоступно.' : 'Материал проходит проверку.'}</strong> Задание откроется после выпуска.</span></div>
      ) : (
        <div className="lesson-layout">
          <ItemPlayer item={d.dto} context={context} preview={preview} />
          <aside className="stack">
            <div className="card cardpad"><div className="card-title"><Icon name="info" /> Как оценивается</div><p className="small quiet">Сначала ключ задания с его правилами нормализации (ударения сохраняются). Незнакомый правдоподобный ответ уходит на проверку без штрафа. Свободные ответы — по критериям, с возможностью воздержаться.</p></div>
            {release?.review_type === 'OWNER_DIGITAL_POLICY' ? <div className="card cardpad"><span className="tag">Цифровая проверка</span><p className="small quiet mt8">Задание выпущено по цифровой политике владельца — без независимой проверки преподавателем.</p></div> : null}
            {preview ? <div className="card cardpad"><span className="tag">Предпросмотр владельца</span><p className="small quiet mt8">Материал не выпущен для учеников. Ваши ответы здесь не влияют на прогресс.</p></div> : null}
          </aside>
        </div>
      )}
    </section>
  );
}
