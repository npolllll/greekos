import Link from 'next/link';
import { requireOwnerPage } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';
import { itemStatuses, loadItemsLite } from '@/lib/admin/data';
import { activePolicy } from '@/lib/admin/releases';
import { ReleaseDialog } from '../_components/ReleaseDialog';
import { ActionButton } from '../_components/ActionButton';

export const metadata = { title: 'Экзамены · QA' };

const KIND_RU: Record<string, string> = { reading: 'Чтение', use_of_language: 'Использование языка', listening: 'Аудирование', writing: 'Письмо', speaking: 'Говорение' };

export default async function ExamsQaPage() {
  await requireOwnerPage();
  const db = adminClient();
  const [{ data: forms }, { data: comps }, items, policy] = await Promise.all([
    db.from('exam_forms').select('form_id, payload').order('form_id'),
    db.from('exam_components').select('component_id, form_id, logical_id, component_kind, duration_minutes, item_ids').order('component_id'),
    loadItemsLite(),
    activePolicy(),
  ]);
  const statuses = await itemStatuses(items.filter((i) => i.module === 'keg_b2'));
  return (
    <div className="admin-section">
      <div className="banner info"><span>Формы F01–F03 — авторские тренировочные, не официальные экзамены и не доказанно эквивалентные. Калибровки экзаменатором нет; баллы учеников — учебные и предварительные. Полное аудирование недоступно, пока не выпущено проверенное аудио.</span></div>
      {(forms ?? []).map((f) => {
        const a = (f.payload as { assembly?: { status?: string; human_verified?: boolean; examiner_calibrated?: boolean } }).assembly ?? {};
        return (
          <div key={f.form_id} className="card cardpad">
            <div className="card-top"><div className="card-title">{f.form_id}</div><div className="row"><span className="tag gray">{a.status ?? '—'}</span><Link className="text-link" href={`/admin/exams/${f.form_id}`}>Редакторский комплект</Link></div></div>
            <div className="table-wrap"><table className="data-table">
              <thead><tr><th>Компонент</th><th>Тип</th><th>Время</th><th>Заданий</th><th>Выпущено</th><th>Доступно</th><th>Аудио</th><th></th></tr></thead>
              <tbody>{(comps ?? []).filter((c) => c.form_id === f.form_id).map((c) => {
                const st = statuses.filter((s) => (c.item_ids as string[]).includes(s.item.item_id));
                const needAudio = st.filter((s) => s.item.requires_audio);
                const released = st.filter((s) => s.released).length;
                return (
                  <tr key={c.component_id}>
                    <td><strong>{c.component_id}</strong>{c.logical_id && c.logical_id !== c.component_id ? <div className="tiny muted">логический {c.logical_id}</div> : null}</td>
                    <td>{KIND_RU[c.component_kind] ?? c.component_kind}</td>
                    <td>{c.duration_minutes ? `${c.duration_minutes} мин` : '—'}</td>
                    <td className="mono">{st.length}</td>
                    <td className="mono">{released}</td>
                    <td className="mono">{st.filter((s) => s.usable).length}</td>
                    <td>{needAudio.length ? `${needAudio.filter((s) => s.audioReady).length}/${needAudio.length} готово` : '—'}</td>
                    <td>{released === st.length && st.length
                      ? <ActionButton url="/api/admin/releases/revoke" body={{ expand: 'exam_component', id: c.component_id }} label="Отозвать" promptReason="Причина отзыва компонента" variant="flat" />
                      : <ReleaseDialog expand="exam_component" id={c.component_id} label="Выпустить" title={`Выпуск компонента ${c.component_id}`} variant="flat" policyActive={!!policy} policyStatement={policy?.statement_ru ?? null} note="Выпускаются все задания компонента для экзаменационной тренировки. Ключи и редакторские тексты кандидату не передаются." />}</td>
                  </tr>
                );
              })}</tbody>
            </table></div>
            <p className="tiny muted">Проверка человеком: {a.human_verified ? 'да' : 'нет'} · калибровка экзаменатором: {a.examiner_calibrated ? 'да' : 'нет'}</p>
          </div>
        );
      })}
    </div>
  );
}
