import { requireOwnerPage } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';
import { activePolicy } from '@/lib/admin/releases';
import { POLICY_RISKS, POLICY_STATEMENT, REVIEW_TYPE_LABEL, dateTimeRu } from '@/lib/admin/labels';
import { PolicySign } from '../_components/PolicySign';
import { ActionButton } from '../_components/ActionButton';

export const metadata = { title: 'Политика выпуска' };

interface Gate { id: string; classification: string; disposition: string; evidence: string; decision: string; owner: string }

export default async function PolicyPage() {
  await requireOwnerPage();
  const db = adminClient();
  const [{ data: gatesRow }, policy, { data: history }, { data: rel }] = await Promise.all([
    db.from('content_singletons').select('payload').eq('singleton_id', 'publication_gates').maybeSingle(),
    activePolicy(),
    db.from('publication_policies').select('id, version, signed_at, revoked_at').order('signed_at', { ascending: false }).limit(20),
    db.from('content_releases').select('review_type').is('revoked_at', null),
  ]);
  const gp = (gatesRow?.payload as { payload?: { status?: string; gates?: Gate[]; content_gated_item_count?: number } } | null)?.payload;
  const counts = new Map<string, number>();
  for (const r of rel ?? []) counts.set(r.review_type, (counts.get(r.review_type) ?? 0) + 1);
  return (
    <div className="admin-section">
      <div className="card cardpad">
        <div className="card-top"><div className="card-title">Академические ворота публикации</div><span className="tag">{gp?.status ?? '—'}</span></div>
        <p className="small quiet">Из ACADEMIC_PUBLICATION_GATES.json. Ни одни ворота не закрыты техническим импортом; внешние проверки не выполнялись. Заданий под воротами: {gp?.content_gated_item_count ?? '—'}.</p>
        <div className="table-wrap"><table className="data-table">
          <thead><tr><th>Ворота</th><th>Класс</th><th>Решение</th><th>Доказательство</th><th>Ответственный</th></tr></thead>
          <tbody>{(gp?.gates ?? []).map((g) => <tr key={g.id}><td><strong>{g.id}</strong></td><td>{g.classification}</td><td className="tiny">{g.decision}</td><td className="code tiny">{g.evidence}</td><td className="tiny">{g.owner}</td></tr>)}</tbody>
        </table></div>
      </div>
      <div className="card cardpad">
        <div className="card-title">Цифровая политика выпуска (DIGITAL_ONLY_RISK_ACCEPTED)</div>
        {policy ? (
          <>
            <div className="banner ok"><span>Политика действует с {dateTimeRu(policy.signed_at)}. Выпуски по ней помечаются ученикам как «Цифровая проверка, без независимой экспертизы».</span></div>
            <p className="small">{policy.statement_ru}</p>
            <ActionButton url="/api/admin/policy/revoke" body={{ policy_id: policy.id }} label="Отозвать политику и все выпуски по ней" promptReason="Причина отзыва политики (все выпуски по ней будут отозваны)" />
          </>
        ) : (
          <>
            <p className="small">{POLICY_STATEMENT}</p>
            <PolicySign risks={POLICY_RISKS} />
          </>
        )}
      </div>
      <div className="card cardpad">
        <div className="card-title">Действующие допуски по основаниям</div>
        {counts.size ? [...counts.entries()].map(([k, v]) => <div key={k} className="review-row"><b>{REVIEW_TYPE_LABEL[k] ?? k}</b><small className="mono">{v}</small></div>) : <p className="small quiet">Действующих допусков нет — весь корпус закрыт (CONTENT_GATED).</p>}
        {(history ?? []).length ? <details className="box mt8"><summary>История политик</summary>{(history ?? []).map((h) => <div key={h.id} className="review-row"><b>v{h.version} · {dateTimeRu(h.signed_at)}</b><small>{h.revoked_at ? `отозвана ${dateTimeRu(h.revoked_at)}` : 'действует'}</small></div>)}</details> : null}
      </div>
    </div>
  );
}
