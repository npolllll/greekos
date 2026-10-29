import Link from 'next/link';
import { requireOwnerPage } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';
import { loadCohort, groupWeek, itemStatuses, verifiedAudioCount } from '@/lib/admin/data';
import { LIFECYCLE_LABEL, minutesLabel, dateTimeRu } from '@/lib/admin/labels';
import { WeekBars } from '@/components/WeekBars';
import { Icon } from '@/components/Icon';
import { InviteDialog } from './_components/InviteDialog';
import { isoDaysAgo } from '@/lib/admin/time';

export const metadata = { title: 'Админ-панель' };

export default async function AdminOverview() {
  const owner = await requireOwnerPage();
  const db = adminClient();
  const since = isoDaysAgo(14).slice(0, 10);
  const [cohort, week, statuses, audio, components, pending, appeals, humanReleases, recentAct] = await Promise.all([
    loadCohort(),
    groupWeek(owner.profile.timezone),
    itemStatuses(),
    verifiedAudioCount(),
    db.from('exam_components').select('component_id', { count: 'exact', head: true }),
    db.from('assessments').select('assessment_id', { count: 'exact', head: true }).in('verdict', ['PENDING_REVIEW', 'ABSTAIN']).eq('status', 'ACTIVE'),
    db.from('appeals').select('id', { count: 'exact', head: true }).eq('status', 'OPEN'),
    db.from('content_releases').select('id', { count: 'exact', head: true }).in('review_type', ['HUMAN_TEACHER_REVIEW', 'HUMAN_EXAMINER_REVIEW']).is('revoked_at', null),
    db.from('activity_days').select('user_id').gte('local_date', since),
  ]);
  const activeIds = new Set((recentAct.data ?? []).map((r) => r.user_id));
  const activeLearners = cohort.filter((c) => c.active && activeIds.has(c.user_id)).length;
  const totalSeconds = cohort.reduce((a, c) => a + c.active_seconds, 0);
  const gated = statuses.filter((s) => !s.released).length;
  const audioPending = statuses.filter((s) => s.released && !s.audioReady).length;

  return (
    <div className="admin-section">
      <div className="row between">
        <p className="small quiet" style={{ margin: 0 }}>Пилот рассчитан на 4–5 учеников — это план, а не техническое ограничение.</p>
        <InviteDialog />
      </div>
      <div className="admin-top">
        <div className="card admin-stat"><small className="quiet">Всего профилей учеников</small><div className="metric mono">{cohort.length}</div><span className="tag green">{activeLearners} занимались за 14 дней</span></div>
        <div className="card admin-stat"><small className="quiet">Время учёбы (активное)</small><div className="metric mono">{minutesLabel(totalSeconds)}</div><span className="tag gray">из журнала активности</span></div>
        <div className="card admin-stat"><small className="quiet">Компоненты B2</small><div className="metric mono">{components.count ?? 0}/15</div><span className="tag gray">Редакторский корпус</span></div>
        <div className="card admin-stat"><small className="quiet">Проверенное аудио (выпущено)</small><div className="metric mono">{audio.released}</div>{audio.released === 0 ? <span className="tag">Не готово к публикации</span> : <span className="tag green">{audio.jobsWithPlayable} из {audio.jobs} заданий</span>}</div>
      </div>
      <div className="admin-grid">
        <div className="card cardpad">
          <div className="card-top"><div className="card-title"><Icon name="users" /> Ученики и прогресс</div><Link className="text-link" href="/admin/learners">Все ученики <Icon name="arrow" size={12} /></Link></div>
          {cohort.length ? (
            <div className="table-wrap">
              <table className="cohort-table">
                <thead><tr><th>Ученик</th><th>Статус</th><th>Старт маршрута</th><th>Уроков</th><th>Слабый навык</th><th>Активность</th></tr></thead>
                <tbody>
                  {cohort.map((c) => (
                    <tr key={c.user_id}>
                      <td><Link href={`/admin/learners/${c.user_id}`} style={{ textDecoration: 'none' }}><strong>{c.display_name}</strong></Link></td>
                      <td>{c.active ? LIFECYCLE_LABEL[c.lifecycle_state] ?? c.lifecycle_state : 'Отключён'}</td>
                      <td>{c.route_start ?? '—'}</td>
                      <td className="mono">{c.lessons_completed}</td>
                      <td>{c.weakest ?? '—'}</td>
                      <td>{c.last_activity ? dateTimeRu(c.last_activity) : 'Не начинал'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <div className="empty"><strong>Учеников пока нет</strong>Пригласите первого ученика — у каждого будет свой маршрут, прогресс и приватные данные.</div>}
          <p className="quiet tiny">Освоение B2 не выводится из числа занятий: навыки оцениваются отдельно по доказательствам и отсроченным проверкам.</p>
        </div>
        <div className="stack">
          <div className="card cardpad">
            <div className="card-title"><Icon name="chart" /> Работа группы</div>
            <WeekBars week={week} />
            <p className="quiet tiny">Активные минуты всех учеников за 7 дней (по вашему часовому поясу).</p>
          </div>
          <div className="card cardpad">
            <div className="card-title"><Icon name="info" /> Требует внимания</div>
            <div className="attention-row"><b>Аудирование</b><span className={audio.jobsWithPlayable === audio.jobs && audio.jobs > 0 ? 'ok' : ''}>{audio.jobs - audio.jobsWithPlayable} из {audio.jobs} аудио без выпущенной записи</span></div>
            <div className="attention-row"><b>Проверка контента</b><span className={humanReleases.count ? 'ok' : ''}>{humanReleases.count ? `${humanReleases.count} допусков с внешней проверкой` : 'Нет независимой проверки'}</span></div>
            <div className="attention-row"><b>Готовность экзаменов</b><span>Нет калибровки экзаменатором</span></div>
            <div className="attention-row"><b>Закрытые задания</b><span className={gated === 0 ? 'ok' : ''}>{gated} из {statuses.length} не выпущены{audioPending ? ` · ${audioPending} ждут аудио` : ''}</span></div>
            <div className="attention-row"><b>Ответы на проверке</b><span className={pending.count ? '' : 'ok'}><Link href="/admin/reviews" className="text-link">{pending.count ?? 0}</Link></span></div>
            <div className="attention-row"><b>Оспаривания</b><span className={appeals.count ? '' : 'ok'}><Link href="/admin/reviews" className="text-link">{appeals.count ?? 0} открыто</Link></span></div>
          </div>
        </div>
      </div>
    </div>
  );
}
