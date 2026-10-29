import Link from 'next/link';
import { requireOwnerPage } from '@/lib/auth';
import { loadCohort } from '@/lib/admin/data';
import { LIFECYCLE_LABEL, ENTRY_LABEL, minutesLabel, dateTimeRu } from '@/lib/admin/labels';
import { InviteDialog } from '../_components/InviteDialog';

export const metadata = { title: 'Ученики' };

export default async function LearnersPage() {
  await requireOwnerPage();
  const cohort = await loadCohort();
  return (
    <div className="card cardpad">
      <div className="card-top"><div className="card-title">Ученики ({cohort.length})</div><InviteDialog /></div>
      {cohort.length ? (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Ученик</th><th>Статус</th><th>Опыт</th><th>Начало</th><th>Уроков</th><th>Ответов</th><th>Время</th><th>На проверке</th><th>Активность</th></tr></thead>
            <tbody>
              {cohort.map((c) => (
                <tr key={c.user_id}>
                  <td><Link href={`/admin/learners/${c.user_id}`}><strong>{c.display_name}</strong></Link><div className="tiny muted">{c.email}</div></td>
                  <td>{c.active ? LIFECYCLE_LABEL[c.lifecycle_state] ?? c.lifecycle_state : <span className="status blocked">Отключён</span>}</td>
                  <td>{c.entry_path ? ENTRY_LABEL[c.entry_path] : '—'}</td>
                  <td>{c.start_date ?? '—'}</td>
                  <td className="mono">{c.lessons_completed}</td>
                  <td className="mono">{c.attempts}</td>
                  <td className="mono">{minutesLabel(c.active_seconds)}</td>
                  <td className="mono">{c.pending_reviews}</td>
                  <td>{c.last_activity ? dateTimeRu(c.last_activity) : 'Не начинал'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <div className="empty"><strong>Учеников пока нет</strong>Доступ только по приглашению.</div>}
    </div>
  );
}
