import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireOwnerPage } from '@/lib/auth';
import { adminClient, selectAll } from '@/lib/supabase/admin';
import { releaseMap, type ItemRow } from '@/lib/content/repo';
import { itemStatuses } from '@/lib/admin/data';
import { activePolicy } from '@/lib/admin/releases';
import { dateTimeRu } from '@/lib/admin/labels';
import { ReleaseDialog } from '../../../_components/ReleaseDialog';
import { ActionButton } from '../../../_components/ActionButton';
import { QaButton } from '../../../_components/QaButton';

export const metadata = { title: 'Урок · QA' };

export default async function UnitQaPage({ params }: { params: Promise<{ unitId: string }> }) {
  await requireOwnerPage();
  const { unitId } = await params;
  const db = adminClient();
  const { data: unit } = await db.from('units').select('unit_id, level, title_ru, current_hash, teaching').eq('unit_id', unitId).maybeSingle();
  if (!unit) notFound();
  const rows = await selectAll<ItemRow>((f, t) => db.from('items').select('item_id, module, unit_id, item_type, level, pool, section, requires_audio, scoring_strategy, competency_ids, prerequisite_ids, audio_job_ids, error_tags, current_hash').eq('unit_id', unitId).order('item_id').range(f, t));
  const [statuses, policy, unitRel, qa] = await Promise.all([
    itemStatuses(rows),
    activePolicy(),
    releaseMap('unit', [{ id: unit.unit_id, hash: unit.current_hash }]),
    db.from('digital_qa_runs').select('content_id, content_hash, verdict, created_at, tool_id').eq('content_kind', 'item').in('content_id', rows.map((r) => r.item_id)).order('created_at', { ascending: false }),
  ]);
  const qaFor = (id: string, hash: string) => (qa.data ?? []).find((q) => q.content_id === id && q.content_hash === hash);
  const tqa = (unit.teaching as { qa?: Record<string, string> }).qa ?? {};
  const dialog = { policyActive: !!policy, policyStatement: policy?.statement_ru ?? null };
  return (
    <div className="admin-section">
      <div className="card cardpad">
        <div className="card-top">
          <div><div className="card-title" style={{ fontSize: 16 }}>{unit.unit_id} · {unit.title_ru}</div><span className="tiny muted">{unit.level} · хеш {unit.current_hash.slice(0, 12)}…</span></div>
          <div className="row">
            <Link className="btn outline" href={`/lesson/${unit.unit_id}?preview=1`}>Предпросмотр урока</Link>
            {unitRel.has(unit.unit_id)
              ? <ActionButton url="/api/admin/releases/revoke" body={{ expand: 'unit', id: unit.unit_id }} label="Отозвать урок" promptReason="Причина отзыва" />
              : <ReleaseDialog expand="unit" id={unit.unit_id} label="Выпустить урок" title={`Выпуск урока ${unit.unit_id}`} {...dialog} />}
          </div>
        </div>
        <div className="pill-row">{Object.entries(tqa).map(([k, v]) => <span key={k} className="tag gray">{k}: {String(v)}</span>)}</div>
      </div>
      <div className="card cardpad">
        <div className="card-title">Задания ({rows.length})</div>
        <div className="table-wrap"><table className="data-table">
          <thead><tr><th>Задание</th><th>Раздел</th><th>Статус</th><th>Цифровая проверка (текущий хеш)</th><th>Действия</th></tr></thead>
          <tbody>{statuses.map((s) => {
            const q = qaFor(s.item.item_id, s.item.current_hash);
            return (
              <tr key={s.item.item_id}>
                <td><strong>{s.item.item_id}</strong><div className="tiny muted">{s.item.item_type} · {s.item.scoring_strategy}</div></td>
                <td>{s.item.section ?? '—'}</td>
                <td>{s.usable ? <span className="status">Доступно</span> : s.released ? <span className="status wait">Ждёт аудио</span> : <span className="status wait">На проверке</span>}</td>
                <td>{q ? <span className={`status ${q.verdict === 'PASS' ? '' : 'wait'}`}>{q.verdict} · {dateTimeRu(q.created_at)}</span> : <span className="tiny muted">не проводилась</span>}</td>
                <td><div className="row">
                  <Link className="text-link" href={`/practice/${s.item.item_id}?preview=1`}>Предпросмотр</Link>
                  <QaButton itemId={s.item.item_id} />
                  {s.released
                    ? <ActionButton url="/api/admin/releases/revoke" body={{ expand: 'item', id: s.item.item_id }} label="Отозвать" promptReason="Причина отзыва" variant="flat" />
                    : <ReleaseDialog expand="item" id={s.item.item_id} label="Выпустить" title={`Выпуск ${s.item.item_id}`} variant="flat" {...dialog} />}
                </div></td>
              </tr>
            );
          })}</tbody>
        </table></div>
        <p className="tiny muted">Цифровая лингвистическая проверка — автоматическая (AI), привязана к хешу и не является проверкой преподавателем.</p>
      </div>
    </div>
  );
}
