import Link from 'next/link';
import { requireOwnerPage } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';
import { scopeStatus } from '@/lib/qa/release';
import { activePolicy } from '@/lib/admin/releases';
import { choiceOptions, type ItemEnvelope } from '@/lib/content/types';
import { dateTimeRu } from '@/lib/admin/labels';
import { Icon } from '@/components/Icon';
import { SampleCard, DecisionForm, RevokeDecision, RunQaButton } from '../../_components/QaControls';

export const metadata = { title: 'Выпуск материалов' };
const STATE_RU: Record<string, { t: string; cls: string }> = {
  PASS: { t: 'готово (PASS)', cls: '' }, ACCEPTED: { t: 'готово (решения по замечаниям)', cls: '' }, NEEDS_DECISION: { t: 'ждёт решения по замечаниям', cls: 'wait' },
  BLOCKED: { t: 'блокирующая ошибка', cls: 'blocked' }, STALE: { t: 'изменено после проверки — перепроверить', cls: 'wait' }, NOT_CHECKED: { t: 'не проверялось', cls: 'wait' },
};

export default async function ReleasePage({ searchParams }: { searchParams: Promise<{ unit?: string; level?: string; module?: string }> }) {
  await requireOwnerPage();
  const sp = await searchParams;
  const db = adminClient();
  const [{ data: batch }, { data: units }, policy, { data: decisions }] = await Promise.all([
    db.from('qa_batches').select('id, label, finished_at, report_sha256, scope').eq('status', 'COMPLETED').order('started_at', { ascending: false }).limit(20),
    db.from('units').select('unit_id, level, title_ru, sort_key').order('sort_key'),
    activePolicy(),
    db.from('release_decisions').select('id, scope, risk_acceptance, sample_size, counts, note, decided_at, revoked_at, revoked_reason, batch_id').order('decided_at', { ascending: false }).limit(20),
  ]);
  const full = (batch ?? []).find((b) => (b.scope as { kind?: string }).kind === 'all');
  const scope = sp.unit ? { kind: 'unit' as const, ids: [sp.unit] } : sp.level ? { kind: 'level' as const, level: sp.level as 'A1' } : sp.module ? { kind: 'module' as const, module: sp.module as 'core' } : null;
  const scopeLabel = sp.unit ? `урок ${sp.unit}` : sp.level ? `все уроки и задания уровня ${sp.level}` : sp.module ? `модуль ${sp.module}` : '';
  const st = full && scope ? await scopeStatus(full.id, scope) : null;
  const sampleIds = st?.sample.map((s) => s.content_id) ?? [];
  const { data: sampleItems } = sampleIds.length ? await db.from('items').select('item_id, item_type, level, envelope').in('item_id', sampleIds) : { data: [] };
  const byState = st ? st.objects.reduce<Record<string, number>>((a, o) => ({ ...a, [o.state]: (a[o.state] ?? 0) + 1 }), {}) : {};
  const strs = (a: unknown[]) => (a ?? []).filter((x): x is string => typeof x === 'string');

  return (
    <div className="admin-section">
      <div className="banner info"><Icon name="info" /><span><strong>Порядок выпуска:</strong> цифровой QA → разбор замечаний (исправление ревизией, ложное срабатывание или принятый риск с обоснованием) → выборочная проверка владельцем → решение по подписанной цифровой политике. Каждый допуск ссылается на пакет QA и решение; изменение материала его отзывает.</span></div>
      {!policy ? <div className="banner warn"><Icon name="lock" /><span>Цифровая политика выпуска не подписана — решение будет недоступно. <Link className="text-link" href="/admin/policy">Политика выпуска</Link></span></div> : null}
      {!full ? <div className="card cardpad"><div className="empty"><strong>Нет полного прогона QA</strong>Запустите проверку корпуса.</div><RunQaButton /></div> : (
        <>
          <div className="card cardpad">
            <div className="card-top"><div className="card-title"><Icon name="target" /> Что выпускаем</div><span className="tiny quiet">Пакет QA {full.id.slice(0, 8)} · {dateTimeRu(full.finished_at ?? '')}</span></div>
            <form className="row" action="/admin/qa/release">
              <select name="unit" className="input" defaultValue={sp.unit ?? ''} style={{ maxWidth: 420, padding: '10px 12px', fontSize: 13.5 }} aria-label="Урок">
                <option value="">— урок —</option>
                {(units ?? []).map((u) => <option key={u.unit_id} value={u.unit_id}>{u.unit_id} · {u.title_ru}</option>)}
              </select>
              <button className="btn small" type="submit">Показать урок</button>
              <span className="tiny quiet">или уровень:</span>
              {['A1', 'A2', 'B1', 'B2'].map((l) => <Link key={l} className={`chip ${sp.level === l ? 'active' : ''}`} href={`/admin/qa/release?level=${l}`}>{l}</Link>)}
              <span className="tiny quiet">или модуль:</span>
              {[['keg_b2', 'ΚΕΓ B2'], ['pegp', 'ΠΕΓΠ'], ['real_greek', 'Real Greek']].map(([m, l]) => <Link key={m} className={`chip ${sp.module === m ? 'active' : ''}`} href={`/admin/qa/release?module=${m}`}>{l}</Link>)}
            </form>
          </div>

          {st && scope ? (
            <>
              <div className="admin-top">
                {['PASS', 'ACCEPTED', 'NEEDS_DECISION', 'BLOCKED'].map((k) => <div className="card admin-stat" key={k}><small className="quiet">{STATE_RU[k].t}</small><div className="metric mono">{byState[k] ?? 0}</div></div>)}
              </div>
              <div className="admin-split">
                <div className="card cardpad">
                  <div className="card-top"><div className="card-title"><Icon name="layers" /> Объекты ({st.objects.length})</div><span className="tag green">к выпуску: {st.releasable}</span></div>
                  <div className="table-wrap" style={{ maxHeight: 460, overflow: 'auto' }}><table className="data-table">
                    <thead><tr><th>Объект</th><th>Статус</th><th>Открыто</th></tr></thead>
                    <tbody>{st.objects.map((o) => (
                      <tr key={`${o.content_kind}-${o.content_id}`}>
                        <td><Link href={`/admin/qa/item/${encodeURIComponent(o.content_id)}?kind=${o.content_kind}`}><strong>{o.content_id}</strong></Link><div className="tiny quiet">{o.content_kind}</div></td>
                        <td><span className={`status ${STATE_RU[o.state].cls}`}>{STATE_RU[o.state].t}</span></td>
                        <td className="tiny">{o.open_blocking ? `${o.open_blocking} блок.` : ''}{o.open_warnings ? ` ${o.open_warnings} пред.` : ''}{!o.open_blocking && !o.open_warnings ? '—' : ''}</td>
                      </tr>
                    ))}</tbody>
                  </table></div>
                </div>
                <div className="card cardpad">
                  <div className="card-title"><Icon name="shield" /> Решение</div>
                  <DecisionForm batchId={full.id} scope={scope} policyActive={!!policy} releasable={st.releasable} accepted={st.objects.filter((o) => o.state === 'ACCEPTED').length} sampleDone={st.sample.every((s) => s.review?.decision === 'OK')} needsExpiry={st.objects.some((o) => o.module === 'pegp')} scopeLabel={scopeLabel} />
                </div>
              </div>
              <div className="card cardpad">
                <div className="card-top"><div className="card-title"><Icon name="eye" /> Выборочная проверка владельцем</div><span className="tag gray">{st.sample.filter((s) => s.review).length} / {st.sample.length}</span></div>
                <p className="small quiet">Детерминированная выборка (10%, не меньше 5) из готовых к выпуску заданий. Отметка «Есть проблема» создаёт блокирующее замечание.</p>
                <div className="grid-2 stagger">
                  {st.sample.map((s) => {
                    const it = (sampleItems ?? []).find((x) => x.item_id === s.content_id);
                    const e = it?.envelope as ItemEnvelope | undefined;
                    return e ? <SampleCard key={s.content_id} batchId={full.id} itemId={s.content_id} prompt={e.prompt} options={choiceOptions(e.options).map((o) => o.label)} answer={strs(e.answer)} alternatives={strs(e.accepted_alternatives)} type={it!.item_type} level={it!.level} review={s.review ? { decision: s.review.decision, note: s.review.note } : null} /> : null;
                  })}
                </div>
              </div>
            </>
          ) : <div className="empty card"><strong>Выберите область выпуска</strong>Урок, уровень или модуль.</div>}
        </>
      )}
      <div className="card cardpad">
        <div className="card-title"><Icon name="clock" /> Журнал решений</div>
        {(decisions ?? []).length ? (
          <div className="table-wrap"><table className="data-table">
            <thead><tr><th>Когда</th><th>Область</th><th>Основание</th><th>Итог</th><th></th></tr></thead>
            <tbody>{(decisions ?? []).map((d) => {
              const c = d.counts as { released?: number; excluded?: Record<string, number> };
              return (
                <tr key={d.id}>
                  <td>{dateTimeRu(d.decided_at)}</td>
                  <td className="tiny">{JSON.stringify(d.scope)}</td>
                  <td className="tiny">{d.risk_acceptance === 'PASS_ONLY' ? 'только PASS' : 'PASS + принятые риски'} · выборка {d.sample_size} · QA {d.batch_id.slice(0, 8)}{d.note ? ` · ${d.note}` : ''}</td>
                  <td className="tiny">выпущено {c.released ?? 0}{c.excluded ? ` · исключено ${Object.values(c.excluded).reduce((a, b) => a + b, 0)}` : ''}{d.revoked_at ? ` · ОТОЗВАНО: ${d.revoked_reason}` : ''}</td>
                  <td>{d.revoked_at ? null : <RevokeDecision decisionId={d.id} />}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        ) : <div className="empty"><strong>Решений ещё не было</strong>Корпус закрыт: ни один материал не выпущен ученикам.</div>}
      </div>
    </div>
  );
}
