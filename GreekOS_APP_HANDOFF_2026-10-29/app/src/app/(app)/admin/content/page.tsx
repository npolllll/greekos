import Link from 'next/link';
import { requireOwnerPage } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';
import { releaseMap } from '@/lib/content/repo';
import { itemStatuses } from '@/lib/admin/data';
import { activePolicy } from '@/lib/admin/releases';
import { MODULE_LABEL, dateTimeRu } from '@/lib/admin/labels';
import { ReleaseDialog } from '../_components/ReleaseDialog';
import { ActionButton } from '../_components/ActionButton';

export const metadata = { title: 'Контент и QA' };

const TABS = [
  { id: 'units', label: 'Уроки A1–B2' },
  { id: 'diagnostics', label: 'Диагностика' },
  { id: 'scenarios', label: 'Сценарии разговора' },
  { id: 'real_greek', label: 'Живой греческий' },
  { id: 'pegp', label: 'ΠΕΓΠ' },
];

export default async function ContentPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requireOwnerPage();
  const sp = await searchParams;
  const tab = TABS.some((t) => t.id === sp.tab) ? sp.tab! : 'units';
  const db = adminClient();
  const [statuses, policy] = await Promise.all([itemStatuses(), activePolicy()]);
  const modules = ['core', 'keg_b2', 'pegp', 'real_greek', 'synthetic_fixture'];
  const byModule = modules.map((m) => {
    const s = statuses.filter((x) => x.item.module === m);
    return { m, total: s.length, usable: s.filter((x) => x.usable).length, audio: s.filter((x) => x.released && !x.audioReady).length, gated: s.filter((x) => !x.released).length };
  }).filter((r) => r.total > 0);
  const dialog = { policyActive: !!policy, policyStatement: policy?.statement_ru ?? null };

  return (
    <div className="admin-section">
      {!policy ? <div className="banner warn"><span><strong>Цифровая политика выпуска не подписана.</strong> Выпуск возможен только с внешним доказательством проверки, либо подпишите политику в разделе <Link className="text-link" href="/admin/policy">«Политика выпуска»</Link>.</span></div> : null}
      <div className="card cardpad">
        <div className="card-title">Задания по модулям</div>
        <div className="table-wrap"><table className="data-table">
          <thead><tr><th>Модуль</th><th>Всего</th><th>Доступно ученикам</th><th>Выпущено, ждёт аудио</th><th>Закрыто (CONTENT_GATED)</th></tr></thead>
          <tbody>{byModule.map((r) => <tr key={r.m}><td><strong>{MODULE_LABEL[r.m] ?? r.m}</strong></td><td className="mono">{r.total}</td><td className="mono">{r.usable}</td><td className="mono">{r.audio}</td><td className="mono">{r.gated}</td></tr>)}</tbody>
        </table></div>
        <p className="tiny muted">Импорт не публикует материалы: каждое задание выпускается отдельной записью допуска на конкретный хеш содержания.</p>
      </div>
      <nav className="chip-row" aria-label="Тип контента">{TABS.map((t) => <Link key={t.id} href={`/admin/content?tab=${t.id}`} className={`chip ${tab === t.id ? 'active' : ''}`} style={{ textDecoration: 'none' }}>{t.label}</Link>)}</nav>
      {tab === 'units' ? <UnitsTab statuses={statuses} dialog={dialog} /> : null}
      {tab === 'diagnostics' ? <DiagnosticsTab statuses={statuses} dialog={dialog} /> : null}
      {tab === 'scenarios' ? <SimpleTab kind="scenario" dialog={dialog} rows={(await db.from('speaking_scenarios').select('scenario_id, level, domain, objective_ru, current_hash').order('scenario_id')).data?.map((s) => ({ id: s.scenario_id, hash: s.current_hash, title: `${s.level ?? ''} · ${s.domain ?? ''}`, sub: s.objective_ru ?? '' })) ?? []} /> : null}
      {tab === 'real_greek' ? <SimpleTab kind="rg_expression" dialog={dialog} statuses={statuses} rows={(await db.from('rg_expressions').select('expression_id, expression, current_hash, payload').order('expression_id')).data?.map((r) => ({ id: r.expression_id, hash: r.current_hash, title: r.expression, sub: ((r.payload as { register?: string[] }).register ?? []).join(', '), items: ((r.payload as { learning_items?: Array<{ item_id: string }> }).learning_items ?? []).map((x) => x.item_id) })) ?? []} /> : null}
      {tab === 'pegp' ? <SimpleTab kind="pegp_packet" dialog={dialog} statuses={statuses} requiresExpiry rows={(await db.from('pegp_packets').select('packet_id, topic_code, packet_kind, current_hash, payload').order('packet_id')).data?.map((p) => {
        const pl = p.payload as { item_ids?: string[]; language_item_ids?: string[]; bank_version?: string; status?: string };
        return { id: p.packet_id, hash: p.current_hash, title: `${p.topic_code ?? ''} · ${p.packet_kind === 'thematic' ? 'тематический' : 'языковая поддержка'}`, sub: `${pl.status ?? ''}${pl.bank_version ? ` · банк ${pl.bank_version}` : ''}`, items: [...(pl.item_ids ?? []), ...(pl.language_item_ids ?? [])] };
      }) ?? []} /> : null}
    </div>
  );
}

type Dialog = { policyActive: boolean; policyStatement: string | null };
type Statuses = Awaited<ReturnType<typeof itemStatuses>>;

async function UnitsTab({ statuses, dialog }: { statuses: Statuses; dialog: Dialog }) {
  const db = adminClient();
  const { data: units } = await db.from('units').select('unit_id, level, title_ru, sort_key, current_hash').order('sort_key');
  const rel = await releaseMap('unit', (units ?? []).map((u) => ({ id: u.unit_id, hash: u.current_hash })));
  return (
    <div className="card cardpad">
      <div className="card-title">Уроки ({units?.length ?? 0})</div>
      <div className="table-wrap"><table className="data-table">
        <thead><tr><th>Урок</th><th>Статус</th><th>Задания: доступно / всего</th><th>Ждут аудио</th><th>Действия</th></tr></thead>
        <tbody>
          {(units ?? []).map((u) => {
            const its = statuses.filter((s) => s.item.unit_id === u.unit_id);
            const released = rel.has(u.unit_id);
            return (
              <tr key={u.unit_id}>
                <td><Link href={`/admin/content/units/${u.unit_id}`}><strong>{u.unit_id}</strong></Link><div className="tiny muted">{u.level} · {u.title_ru}</div></td>
                <td>{released ? <span className="status">Выпущен</span> : <span className="status wait">На проверке</span>}</td>
                <td className="mono">{its.filter((s) => s.usable).length} / {its.length}</td>
                <td className="mono">{its.filter((s) => s.item.requires_audio && !s.audioReady).length}</td>
                <td><div className="row">
                  <Link className="text-link" href={`/lesson/${u.unit_id}?preview=1`}>Предпросмотр</Link>
                  {released ? <ActionButton url="/api/admin/releases/revoke" body={{ expand: 'unit', id: u.unit_id }} label="Отозвать" promptReason="Причина отзыва урока и его заданий" variant="flat" /> : <ReleaseDialog expand="unit" id={u.unit_id} label="Выпустить урок" title={`Выпуск урока ${u.unit_id} и всех его заданий`} variant="flat" note="Выпускаются теория урока и все его задания. Задания с аудио останутся закрытыми, пока не выпущено проверенное аудио." {...dialog} />}
                </div></td>
              </tr>
            );
          })}
        </tbody>
      </table></div>
    </div>
  );
}

function DiagnosticsTab({ statuses, dialog }: { statuses: Statuses; dialog: Dialog }) {
  const diag = statuses.filter((s) => s.item.pool === 'diagnostic_holdout');
  return (
    <div className="card cardpad">
      <div className="card-top"><div className="card-title">Диагностические пробы ({diag.length})</div><ReleaseDialog expand="diagnostics" id="ENTRY-P01" label="Выпустить все пробы" title="Выпуск диагностических проб (holdout)" variant="flat" note="Пробы не используются как тренировка. Аудирование и произношение без проверенного звука получат NOT_OBSERVED." {...dialog} /></div>
      <div className="table-wrap"><table className="data-table"><thead><tr><th>Проба</th><th>Тип</th><th>Статус</th><th></th></tr></thead><tbody>
        {diag.map((s) => <tr key={s.item.item_id}><td><strong>{s.item.item_id}</strong></td><td>{s.item.item_type}</td><td>{s.usable ? 'Доступна' : s.released ? 'Ждёт аудио' : 'На проверке'}</td><td><Link className="text-link" href={`/practice/${s.item.item_id}?preview=1`}>Предпросмотр</Link></td></tr>)}
      </tbody></table></div>
    </div>
  );
}

async function SimpleTab({ kind, rows, dialog, statuses, requiresExpiry }: { kind: 'scenario' | 'rg_expression' | 'pegp_packet'; rows: Array<{ id: string; hash: string; title: string; sub: string; items?: string[] }>; dialog: Dialog; statuses?: Statuses; requiresExpiry?: boolean }) {
  const rel = await releaseMap(kind, rows.map((r) => ({ id: r.id, hash: r.hash })));
  const { data: relRows } = await adminClient().from('content_releases').select('content_id, expires_at').eq('content_kind', kind).is('revoked_at', null);
  return (
    <div className="card cardpad">
      {requiresExpiry ? <div className="banner info"><span>Правила ΠΕΓΠ меняются: допуск выдаётся только на конкретную сессию и имеет дату окончания. Устаревшие правила не копируются молча.</span></div> : null}
      <div className="table-wrap"><table className="data-table">
        <thead><tr><th>Материал</th><th>Статус</th>{statuses ? <th>Задания доступны</th> : null}<th>Действия</th></tr></thead>
        <tbody>{rows.map((r) => {
          const released = rel.has(r.id);
          const exp = (relRows ?? []).find((x) => x.content_id === r.id)?.expires_at;
          const its = statuses?.filter((s) => r.items?.includes(s.item.item_id)) ?? [];
          return (
            <tr key={r.id}>
              <td><strong>{r.id}</strong><div className="tiny muted">{r.title}{r.sub ? ` · ${r.sub}` : ''}</div></td>
              <td>{released ? <span className="status">Выпущен{exp ? ` до ${dateTimeRu(exp)}` : ''}</span> : <span className="status wait">На проверке</span>}</td>
              {statuses ? <td className="mono">{its.filter((s) => s.usable).length} / {its.length}</td> : null}
              <td>{released
                ? <ActionButton url="/api/admin/releases/revoke" body={{ expand: kind, id: r.id }} label="Отозвать" promptReason="Причина отзыва" variant="flat" />
                : <ReleaseDialog expand={kind} id={r.id} label="Выпустить" title={`Выпуск ${r.id}`} variant="flat" requiresExpiry={requiresExpiry} {...dialog} />}</td>
            </tr>
          );
        })}</tbody>
      </table></div>
    </div>
  );
}
