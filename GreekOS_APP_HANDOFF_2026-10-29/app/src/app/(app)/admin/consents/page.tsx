import Link from 'next/link';
import { requireOwnerPage } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';
import { dateTimeRu } from '@/lib/admin/labels';
import { nowMs } from '@/lib/admin/time';

export const metadata = { title: 'Согласия и аудит' };

const PURPOSE_RU: Record<string, string> = {
  voice_review_retention: 'Хранение голоса для проверки (до 30 дней)',
  owner_transcript_access: 'Доступ владельца к транскрипту',
  admin_learning_analytics_notice: 'Уведомление об учебной аналитике',
};

function safeMeta(meta: Record<string, unknown>): string {
  const text = JSON.stringify(meta);
  return text.length > 260 ? `${text.slice(0, 260)}…` : text;
}

export default async function ConsentsPage({ searchParams }: { searchParams: Promise<{ action?: string }> }) {
  await requireOwnerPage();
  const sp = await searchParams;
  const prefix = (sp.action ?? '').replace(/[^a-z_.]/g, '').slice(0, 40);
  const db = adminClient();
  let q = db.from('admin_audit_log').select('event_id, actor_id, action, target_id, target_user_id, meta, occurred_at').order('occurred_at', { ascending: false }).limit(200);
  if (prefix) q = q.like('action', `${prefix}%`);
  const [{ data: consents }, { data: log }, { data: profiles }] = await Promise.all([
    db.from('consents').select('consent_id, user_id, purpose, artifact_id, granted_at, expires_at, revoked_at').order('granted_at', { ascending: false }).limit(200),
    q,
    db.from('profiles').select('user_id, display_name'),
  ]);
  const name = (id: string | null) => (id ? (profiles ?? []).find((p) => p.user_id === id)?.display_name ?? id.slice(0, 8) : 'система');
  const now = nowMs();
  const prefixes = ['learner.', 'content.', 'policy.', 'review.', 'appeal.', 'audio.', 'transcript.', 'providers.', 'exam.', 'qa.'];
  return (
    <div className="admin-section">
      <div className="card cardpad">
        <div className="card-title">Согласия учеников ({consents?.length ?? 0})</div>
        {(consents ?? []).length ? (
          <div className="table-wrap"><table className="data-table">
            <thead><tr><th>Ученик</th><th>Цель</th><th>Артефакт</th><th>Выдано</th><th>Истекает</th><th>Статус</th></tr></thead>
            <tbody>{(consents ?? []).map((c) => {
              const active = !c.revoked_at && (!c.expires_at || new Date(c.expires_at).getTime() > now);
              return <tr key={c.consent_id}><td>{name(c.user_id)}</td><td>{PURPOSE_RU[c.purpose] ?? c.purpose}</td><td className="code">{c.artifact_id ?? '—'}</td><td>{dateTimeRu(c.granted_at)}</td><td>{dateTimeRu(c.expires_at)}</td><td>{c.revoked_at ? <span className="status blocked">Отозвано</span> : active ? <span className="status">Действует</span> : <span className="status wait">Истекло</span>}</td></tr>;
            })}</tbody>
          </table></div>
        ) : <p className="small quiet">Согласий пока нет. По умолчанию сырой голос не хранится, транскрипты владельцу закрыты.</p>}
      </div>
      <div className="card cardpad">
        <div className="card-top"><div className="card-title">Журнал аудита (последние 200)</div></div>
        <nav className="chip-row" aria-label="Фильтр действий">
          <Link href="/admin/consents" className={`chip ${!prefix ? 'active' : ''}`} style={{ textDecoration: 'none' }}>Все</Link>
          {prefixes.map((p) => <Link key={p} href={`/admin/consents?action=${p}`} className={`chip ${prefix === p ? 'active' : ''}`} style={{ textDecoration: 'none' }}>{p.replace('.', '')}</Link>)}
        </nav>
        <div className="table-wrap mt8"><table className="data-table">
          <thead><tr><th>Время</th><th>Кто</th><th>Действие</th><th>Объект</th><th>Детали (без секретов и транскриптов)</th></tr></thead>
          <tbody>{(log ?? []).map((e) => <tr key={e.event_id}><td>{dateTimeRu(e.occurred_at)}</td><td>{name(e.actor_id)}</td><td className="code">{e.action}</td><td>{e.target_user_id ? name(e.target_user_id) : e.target_id ?? '—'}</td><td className="tiny">{safeMeta(e.meta as Record<string, unknown>)}</td></tr>)}</tbody>
        </table></div>
        <p className="tiny muted">Журнал только дополняется: изменение и удаление записей запрещены на уровне базы данных.</p>
      </div>
    </div>
  );
}
