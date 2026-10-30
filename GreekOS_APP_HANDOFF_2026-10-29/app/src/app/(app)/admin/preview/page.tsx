import { requireOwnerPage } from '@/lib/auth';
import { devPreviewOverview } from '@/lib/admin/dev-preview';
import { dateTimeRu } from '@/lib/admin/labels';
import { Icon } from '@/components/Icon';
import { CreateTester, GrantRevoke } from '../_components/DevPreviewControls';

export const metadata = { title: 'DEV-PREVIEW' };

export default async function DevPreviewPage() {
  const owner = await requireOwnerPage();
  const o = await devPreviewOverview();
  const grantOf = (id: string) => o.grants.find((g) => g.user_id === id);
  const activeGrant = (id: string) => { const g = grantOf(id); return !!g && !g.revoked_at && new Date(g.expires_at) > new Date(); };
  return (
    <div className="admin-section">
      <div className={`banner ${o.env_allowed ? 'preview' : 'danger'}`}><Icon name="eye" /><span><strong>DEV-PREVIEW — локальный режим владельца.</strong> Позволяет вам или специально помеченному тестовому ученику пройти невыпущенный корпус целиком: уроки, упражнения, ошибки, повторения, разговор, экзамены. Ничего не выпускается; обычные ученики материалы не видят; в production этот режим отключён в коде. {o.env_allowed ? 'Сейчас: локальная среда — режим доступен.' : 'Сейчас: не локальная среда — режим недоступен.'}</span></div>
      <div className="admin-split">
        <div className="card cardpad">
          <div className="card-title"><Icon name="users" /> Тестовые ученики</div>
          {o.testers.length ? (
            <div className="table-wrap"><table className="data-table">
              <thead><tr><th>Аккаунт</th><th>DEV-PREVIEW</th><th></th></tr></thead>
              <tbody>{o.testers.map((t) => {
                const g = grantOf(t.user_id);
                return <tr key={t.user_id}><td><strong>{t.display_name}</strong><div className="tiny quiet">{t.email} · {t.lifecycle_state}</div></td><td className="tiny">{g ? (activeGrant(t.user_id) ? `до ${dateTimeRu(g.expires_at)}` : g.revoked_at ? `отозван ${dateTimeRu(g.revoked_at)}` : 'истёк') : 'нет'}</td><td><GrantRevoke userId={t.user_id} active={activeGrant(t.user_id)} /></td></tr>;
              })}</tbody>
            </table></div>
          ) : <div className="empty"><strong>Тестовых учеников нет</strong>Создайте аккаунт для сквозной проверки маршрута ученика.</div>}
        </div>
        <div className="stack">
          <div className="card cardpad"><div className="card-title"><Icon name="user" /> Новый тестовый ученик</div><CreateTester /></div>
          <div className="card cardpad"><div className="card-title"><Icon name="shield" /> Ваш аккаунт владельца</div><p className="small quiet">Можно пройти маршрут и самому (прогресс владельца — тоже тестовый).</p><GrantRevoke userId={owner.userId} active={activeGrant(owner.userId)} /></div>
        </div>
      </div>
    </div>
  );
}
