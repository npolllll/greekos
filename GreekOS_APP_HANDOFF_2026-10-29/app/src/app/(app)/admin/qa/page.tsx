import Link from 'next/link';
import { requireOwnerPage } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';
import { CHECKS } from '@/lib/qa/checks';
import { dateTimeRu } from '@/lib/admin/labels';
import { Icon } from '@/components/Icon';
import { ProgressRing } from '@/components/ui/Motion';
import { RunQaButton, IssueActions } from '../_components/QaControls';

export const metadata = { title: 'Цифровой QA' };
const PAGE = 40;
const MUST_FIX = new Set(['ortho.final_sigma', 'ortho.mixed_script', 'hash.envelope', 'hash.revision', 'schema.adapter', 'keys.present', 'keys.choice_resolves', 'keys.options_duplicate', 'refs.unit', 'refs.competencies', 'refs.audio_jobs', 'refs.rubric', 'refs.text_object']);

export default async function QaPage({ searchParams }: { searchParams: Promise<{ sev?: string; check?: string; status?: string; page?: string; q?: string }> }) {
  await requireOwnerPage();
  const sp = await searchParams;
  const db = adminClient();
  const { data: batches } = await db.from('qa_batches').select('id, label, status, counts, report_sha256, report_path, started_at, finished_at, scope').order('started_at', { ascending: false }).limit(8);
  const latest = (batches ?? []).find((b) => b.status === 'COMPLETED' && (b.scope as { kind?: string }).kind === 'all');
  const t = (latest?.counts ?? {}) as Record<string, number>;
  const sev = ['blocking', 'warning'].includes(sp.sev ?? '') ? sp.sev! : null;
  const status = ['open', 'false_positive', 'accepted_risk', 'fixed'].includes(sp.status ?? '') ? sp.status! : 'open';
  const page = Math.max(1, Number(sp.page ?? '1') || 1);
  let q = db.from('qa_issues').select('id, content_kind, content_id, check_id, severity, field, message_ru, suggestion, status, resolution_note', { count: 'exact' }).in('severity', sev ? [sev] : ['blocking', 'warning']).eq('status', status);
  if (latest) q = status === 'open' ? q.eq('batch_id', latest.id) : q;
  if (sp.check) q = q.eq('check_id', sp.check);
  if (sp.q) q = q.ilike('content_id', `%${sp.q.replace(/[%_]/g, '')}%`);
  const { data: issues, count } = await q.order('severity').order('content_id').range((page - 1) * PAGE, page * PAGE - 1);
  const { data: openByCheck } = latest ? await db.from('qa_issues').select('check_id, severity').eq('batch_id', latest.id).eq('status', 'open').in('severity', ['blocking', 'warning']) : { data: [] };
  const counts = new Map<string, { blocking: number; warning: number }>();
  for (const r of openByCheck ?? []) { const c = counts.get(r.check_id) ?? { blocking: 0, warning: 0 }; c[r.severity as 'blocking' | 'warning'] += 1; counts.set(r.check_id, c); }
  const title = new Map(CHECKS.map((c) => [c.id, c.title_ru]));
  const link = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(Object.entries({ sev, check: sp.check ?? null, status, q: sp.q ?? null, ...patch }).filter(([, v]) => v) as Array<[string, string]>);
    return `/admin/qa?${p.toString()}`;
  };
  const total = (t.PASS ?? 0) + (t.NEEDS_REVIEW ?? 0) + (t.FAIL ?? 0);

  return (
    <div className="admin-section">
      <div className="banner info"><Icon name="shield" /><span><strong>Цифровой QA — автоматическая проверка, не экспертиза.</strong> Хеши и ревизии, схема и ссылки, ключи, орфография греческого (словарь hunspell el_GR), уровень, модальность, аудио, источники и права. Подпись политики не заменяет эту проверку: выпуск возможен только по её результатам.</span></div>
      <div className="dash">
        <div className="card cardpad c-8">
          <div className="card-top"><div className="card-title"><Icon name="layers" /> Последний полный прогон</div><RunQaButton /></div>
          {latest ? (
            <div className="row" style={{ gap: 26, alignItems: 'center' }}>
              <ProgressRing value={total ? (t.PASS / total) * 100 : 0} size={116} stroke={11} tone="olive" sub="PASS" />
              <div className="stack" style={{ gap: 6, flex: 1, minWidth: 220 }}>
                <div className="row"><span className="tag green">PASS {t.PASS}</span><span className="tag gold">на проверку {t.NEEDS_REVIEW}</span><span className="tag">FAIL {t.FAIL}</span></div>
                <p className="small quiet" style={{ margin: 0 }}>{t.objects} объектов: {t.items} заданий, {t.units} уроков, {t.scenarios} сценариев · {dateTimeRu(latest.finished_at ?? latest.started_at)}</p>
                <p className="tiny quiet" style={{ margin: 0 }}>Отчёт <span className="code">{latest.report_path}</span> · SHA-256 <span className="code">{latest.report_sha256?.slice(0, 16)}…</span></p>
                <div className="row"><Link className="btn small" href="/admin/qa/release">Перейти к выпуску <Icon name="arrow" size={14} /></Link></div>
              </div>
            </div>
          ) : <div className="empty"><strong>Проверок ещё не было</strong>Запустите первую — она занимает несколько секунд.</div>}
        </div>
        <div className="card cardpad c-4">
          <div className="card-title"><Icon name="clock" /> История пакетов</div>
          {(batches ?? []).map((b) => {
            const c = (b.counts ?? {}) as Record<string, number>;
            return <div className="review-row" key={b.id}><span style={{ minWidth: 0 }}><b style={{ display: 'block', fontSize: 12.5 }}>{b.label}</b><small className="quiet" style={{ color: 'var(--muted)' }}>{dateTimeRu(b.started_at)} · {b.status}</small></span><small className="mono" style={{ color: 'var(--ink-2)' }}>{c.PASS ?? '—'}/{c.objects ?? '—'}</small></div>;
          })}
        </div>
      </div>

      <div className="card cardpad">
        <div className="card-top"><div className="card-title"><Icon name="filter" /> Очередь замечаний</div><span className="tag gray">{count ?? 0}</span></div>
        <div className="chip-row" style={{ marginBottom: 10 }}>
          {[['open', 'Открытые'], ['false_positive', 'Ложные'], ['accepted_risk', 'Принятый риск'], ['fixed', 'Исправленные']].map(([k, l]) => <Link key={k} className={`chip ${status === k ? 'active' : ''}`} href={link({ status: k, page: null })}>{l}</Link>)}
          <span style={{ width: 12 }} />
          {[[null, 'Все'], ['blocking', 'Блокирующие'], ['warning', 'Предупреждения']].map(([k, l]) => <Link key={l} className={`chip ${sev === k ? 'active' : ''}`} href={link({ sev: k, page: null })}>{l}</Link>)}
        </div>
        <div className="chip-row" style={{ marginBottom: 14 }}>
          {sp.check ? <Link className="chip active" href={link({ check: null, page: null })}>{title.get(sp.check) ?? sp.check} ×</Link> : [...counts.entries()].sort((a, b) => b[1].blocking - a[1].blocking || b[1].warning - a[1].warning).map(([id, c]) => <Link key={id} className="chip" href={link({ check: id, page: null })}>{title.get(id) ?? id} <b>{c.blocking + c.warning}</b></Link>)}
        </div>
        <form className="row" action="/admin/qa" style={{ marginBottom: 12 }}>
          <input type="hidden" name="status" value={status} />
          {sev ? <input type="hidden" name="sev" value={sev} /> : null}
          {sp.check ? <input type="hidden" name="check" value={sp.check} /> : null}
          <input className="input" name="q" defaultValue={sp.q ?? ''} placeholder="Фильтр по ID (например, U-A1-007)" style={{ maxWidth: 320, padding: '9px 13px', fontSize: 13 }} aria-label="Фильтр по ID" />
          <button className="btn small outline" type="submit">Найти</button>
        </form>
        {(issues ?? []).length ? (
          <div className="table-wrap"><table className="data-table">
            <thead><tr><th>Объект</th><th>Замечание</th><th>Поле</th><th>Строгость</th><th>Решение</th></tr></thead>
            <tbody>
              {(issues ?? []).map((i) => (
                <tr key={i.id}>
                  <td><Link href={`/admin/qa/item/${encodeURIComponent(i.content_id)}?kind=${i.content_kind}`}><strong>{i.content_id}</strong></Link><div className="tiny quiet">{i.content_kind}</div></td>
                  <td style={{ maxWidth: 440 }}><div>{i.message_ru}</div><div className="tiny quiet">{title.get(i.check_id) ?? i.check_id}</div>{i.suggestion ? <div className="tiny">Предложение: <span lang="el">{String(i.suggestion).slice(0, 120)}</span></div> : null}{i.resolution_note ? <div className="tiny quiet">Решение: {i.resolution_note}</div> : null}</td>
                  <td className="tiny">{i.field ?? '—'}</td>
                  <td><span className={`status ${i.severity === 'blocking' ? 'blocked' : 'wait'}`}>{i.severity === 'blocking' ? 'блокирует' : 'предупреждение'}</span></td>
                  <td><IssueActions issueId={i.id} status={i.status} checkId={i.check_id} acceptable={!MUST_FIX.has(i.check_id)} /></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        ) : <div className="empty"><strong>Нет замечаний</strong>{status === 'open' ? 'В последнем прогоне по выбранному фильтру открытых замечаний нет.' : 'В этой категории пока ничего нет.'}</div>}
        <div className="row between mt16"><span className="tiny quiet">Стр. {page} из {Math.max(1, Math.ceil((count ?? 0) / PAGE))}</span><span className="row">{page > 1 ? <Link className="btn small outline" href={link({ page: String(page - 1) })}>Назад</Link> : null}{(count ?? 0) > page * PAGE ? <Link className="btn small outline" href={link({ page: String(page + 1) })}>Дальше</Link> : null}</span></div>
      </div>
    </div>
  );
}
