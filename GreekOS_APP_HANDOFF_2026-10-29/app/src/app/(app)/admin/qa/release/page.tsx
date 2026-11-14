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

const KIND_RU: Record<string, string> = { unit: 'Уроки', item: 'Задания', scenario: 'Сценарии AI Speaking', rg_expression: 'Карточки Real Greek', pegp_packet: 'Пакеты ΠΕΓΠ' };

export default async function ReleasePage({ searchParams }: { searchParams: Promise<{ unit?: string; level?: string; module?: string; scope?: string }> }) {
  await requireOwnerPage();
  const sp = await searchParams;
  const db = adminClient();
  const [{ data: latestFull }, { data: units }, policy, { data: decisions }] = await Promise.all([
    db.from('qa_batches').select('id, label, finished_at, report_sha256, scope').eq('status', 'COMPLETED').eq('scope->>kind', 'all').order('started_at', { ascending: false }).limit(1).maybeSingle(),
    db.from('units').select('unit_id, level, title_ru, sort_key').order('sort_key'),
    activePolicy(),
    db.from('release_decisions').select('id, scope, risk_acceptance, sample_size, counts, note, decided_at, revoked_at, revoked_reason, batch_id').order('decided_at', { ascending: false }).limit(20),
  ]);
  const full = latestFull ?? undefined;
  // Default: the whole admissible package — one procedure for the owner; narrower scopes stay available.
  const scope = sp.unit ? { kind: 'unit' as const, ids: [sp.unit] } : sp.level ? { kind: 'level' as const, level: sp.level as 'A1' } : sp.module ? { kind: 'module' as const, module: sp.module as 'core' } : { kind: 'all' as const };
  const isAll = scope.kind === 'all';
  const scopeLabel = sp.unit ? `урок ${sp.unit}` : sp.level ? `все уроки и задания уровня ${sp.level}` : sp.module ? `модуль ${sp.module}` : 'весь допустимый пакет: уроки, задания, диагностика, экзаменационные тренажёры, сценарии AI Speaking, Real Greek и ΠΕΓΠ';
  const st = full ? await scopeStatus(full.id, scope) : null;
  // Why closed objects stay closed: open blocking issues of the batch, grouped by message.
  const closed = st ? st.objects.filter((o) => o.state !== 'PASS' && o.state !== 'ACCEPTED') : [];
  const reasons = new Map<string, number>();
  if (full && closed.length) {
    for (let i = 0; i < closed.length; i += 300) {
      const { data } = await db.from('qa_issues').select('content_id, check_id, message_ru').eq('batch_id', full.id).eq('severity', 'blocking').in('status', ['open', 'superseded']).in('content_id', closed.slice(i, i + 300).map((o) => o.content_id));
      for (const r of data ?? []) { const k = r.check_id.startsWith('rights.') ? 'Права источника не урегулированы' : r.check_id === 'content.status' ? 'Автор пометил материал как незавершённый' : r.message_ru.replace(/\s*\(.*\)\.?$/, ''); reasons.set(k, (reasons.get(k) ?? 0) + 1); }
    }
    const noIssue = closed.filter((o) => o.state === 'STALE' || o.state === 'NOT_CHECKED').length;
    if (noIssue) reasons.set('Изменено или не проверялось — перезапустите цифровой QA', noIssue);
  }
  // Releasable tasks whose sound is not yet released open without audio (the player says so).
  const releasableItems = st ? st.objects.filter((o) => o.content_kind === 'item' && (o.state === 'PASS' || o.state === 'ACCEPTED')).map((o) => o.content_id) : [];
  let withoutAudio = 0;
  if (releasableItems.length) {
    const { data: needAudio } = await db.from('items').select('item_id, audio_job_ids').eq('requires_audio', true);
    const ready = new Set(((await db.from('audio_assets').select('audio_id').is('invalidated_at', null).eq('digital_status', 'AUDIO_VERIFIED_DIGITAL').eq('rights_status', 'PROVIDER_TERMS_RECORDED')).data ?? []).map((a) => a.audio_id));
    const set = new Set(releasableItems);
    withoutAudio = (needAudio ?? []).filter((x) => set.has(x.item_id) && !(x.audio_job_ids as string[]).every((a) => ready.has(a))).length;
  }
  const byKind = st ? Object.entries(st.objects.reduce<Record<string, { total: number; open: number }>>((a, o) => { const k = (a[o.content_kind] ??= { total: 0, open: 0 }); k.total += 1; if (o.state === 'PASS' || o.state === 'ACCEPTED') k.open += 1; return a; }, {})) : [];
  const shown = st ? (isAll ? closed : st.objects) : [];
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
            <div className="row" style={{ marginBottom: 10 }}>
              <Link className={`chip ${isAll ? 'active' : ''}`} href="/admin/qa/release">Весь допустимый пакет (рекомендуется)</Link>
              <span className="tiny quiet">Одно решение открывает всё, что прошло проверку; остальное остаётся закрытым с причиной. Отдельные области — ниже.</span>
            </div>
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

          {st ? (
            <>
              {isAll ? (
                <div className="card cardpad">
                  <div className="card-top"><div className="card-title"><Icon name="layers" /> Что откроется ученикам</div><span className="tag green">к выпуску: {st.releasable} из {st.objects.length}</span></div>
                  <div className="table-wrap"><table className="data-table">
                    <thead><tr><th>Материалы</th><th>Откроется</th><th>Останется закрыто</th></tr></thead>
                    <tbody>{byKind.map(([k, v]) => <tr key={k}><td>{KIND_RU[k] ?? k}</td><td className="mono">{v.open}</td><td className="mono">{v.total - v.open}</td></tr>)}</tbody>
                  </table></div>
                  {reasons.size ? <><div className="card-title mt16"><Icon name="lock" /> Почему закрыто</div><ul className="small">{[...reasons.entries()].sort((a, b) => b[1] - a[1]).map(([r, n]) => <li key={r}>{r} — {n}</li>)}</ul></> : null}
                  {withoutAudio ? <p className="small quiet">{withoutAudio} заданий на слух откроются с пометкой «аудио ещё не выпущено»: звук появится после выпуска аудио (Админ → Аудио).</p> : null}
                </div>
              ) : null}
              <div className="admin-top">
                {['PASS', 'ACCEPTED', 'NEEDS_DECISION', 'BLOCKED'].map((k) => <div className="card admin-stat" key={k}><small className="quiet">{STATE_RU[k].t}</small><div className="metric mono">{byState[k] ?? 0}</div></div>)}
              </div>
              <div className="admin-split">
                <div className="card cardpad">
                  <div className="card-top"><div className="card-title"><Icon name="layers" /> {isAll ? `Закрытые объекты (${shown.length})` : `Объекты (${st.objects.length})`}</div><span className="tag green">к выпуску: {st.releasable}</span></div>
                  <div className="table-wrap" style={{ maxHeight: 460, overflow: 'auto' }}><table className="data-table">
                    <thead><tr><th>Объект</th><th>Статус</th><th>Открыто</th></tr></thead>
                    <tbody>{shown.map((o) => (
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
                  <DecisionForm batchId={full.id} scope={scope} policyActive={!!policy} releasable={st.releasable} accepted={st.objects.filter((o) => o.state === 'ACCEPTED').length} sampleDone={st.sample.every((s) => s.review?.decision === 'OK')} needsExpiry={st.objects.some((o) => o.module === 'pegp' && (o.state === 'PASS' || o.state === 'ACCEPTED'))} scopeLabel={scopeLabel} />
                </div>
              </div>
              <div className="card cardpad">
                <div className="card-top"><div className="card-title"><Icon name="eye" /> Выборочная проверка владельцем</div><span className="tag gray">{st.sample.filter((s) => s.review).length} / {st.sample.length}</span></div>
                <p className="small quiet">Детерминированная выборка из готовых к выпуску заданий: 10%, не меньше 5 и не больше 30, сначала по одному заданию каждого типа. Отметка «Есть проблема» создаёт блокирующее замечание.</p>
                <div className="grid-2 stagger">
                  {st.sample.map((s) => {
                    const it = (sampleItems ?? []).find((x) => x.item_id === s.content_id);
                    const e = it?.envelope as ItemEnvelope | undefined;
                    return e ? <SampleCard key={s.content_id} batchId={full.id} itemId={s.content_id} prompt={e.prompt} options={choiceOptions(e.options).map((o) => o.label)} answer={strs(e.answer)} alternatives={strs(e.accepted_alternatives)} type={it!.item_type} level={it!.level} review={s.review ? { decision: s.review.decision, note: s.review.note } : null} /> : null;
                  })}
                </div>
              </div>
            </>
          ) : null}
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
