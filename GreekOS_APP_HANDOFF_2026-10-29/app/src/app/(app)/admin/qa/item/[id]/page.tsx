import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireOwnerPage } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';
import { CHECKS } from '@/lib/qa/checks';
import { choiceOptions, type ItemEnvelope } from '@/lib/content/types';
import { dateTimeRu } from '@/lib/admin/labels';
import { Icon } from '@/components/Icon';
import { IssueActions, PatchEditor, UnitPatchEditor } from '../../../_components/QaControls';

export const metadata = { title: 'QA объекта' };
const MUST_FIX = new Set(['ortho.final_sigma', 'ortho.mixed_script', 'hash.envelope', 'hash.revision', 'schema.adapter', 'keys.present', 'keys.choice_resolves', 'keys.options_duplicate', 'refs.unit', 'refs.competencies', 'refs.audio_jobs', 'refs.rubric', 'refs.text_object']);

export default async function QaItemPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ kind?: string }> }) {
  await requireOwnerPage();
  const id = decodeURIComponent((await params).id);
  const kind = (await searchParams).kind === 'unit' ? 'unit' : (await searchParams).kind === 'scenario' ? 'scenario' : 'item';
  const db = adminClient();
  const title = new Map(CHECKS.map((c) => [c.id, c.title_ru]));
  const [{ data: results }, { data: issues }, { data: patches }, { data: releases }] = await Promise.all([
    db.from('qa_item_results').select('batch_id, content_hash, verdict, blocking_count, warning_count, qa_batches(label, started_at)').eq('content_id', id).order('batch_id').limit(20),
    db.from('qa_issues').select('id, check_id, severity, field, message_ru, suggestion, status, resolution_note, batch_id, content_hash').eq('content_id', id).neq('status', 'superseded').in('severity', ['blocking', 'warning']).order('severity'),
    db.from('content_patches').select('base_hash, new_hash, reason, changes, created_at').eq('content_id', id).order('created_at', { ascending: false }),
    db.from('content_releases').select('id, content_hash, review_type, reviewed_at, revoked_at, revoked_reason, decision_id').eq('content_id', id).order('reviewed_at', { ascending: false }).limit(10),
  ]);
  let header: React.ReactNode = null;
  let editor: React.ReactNode = null;
  let hash = '';
  if (kind === 'item') {
    const { data: it } = await db.from('items').select('item_id, module, unit_id, item_type, level, envelope, current_hash, scoring_strategy').eq('item_id', id).maybeSingle();
    if (!it) notFound();
    hash = it.current_hash;
    const e = it.envelope as ItemEnvelope;
    const opts = choiceOptions(e.options).map((o) => o.label);
    const strs = (a: unknown[]) => (a ?? []).filter((x): x is string => typeof x === 'string');
    const openFix = (issues ?? []).find((i) => i.status === 'open' && i.content_hash === it.current_hash);
    header = (
      <div className="card cardpad">
        <div className="row between"><span className="tag gray">{it.module} · {it.level ?? '—'} · {it.item_type} · {it.scoring_strategy}</span>{it.unit_id ? <Link className="text-link" href={`/lesson/${it.unit_id}?preview=1`}>Урок {it.unit_id}</Link> : null}</div>
        <p className="player-prompt" lang="el">{e.prompt}</p>
        {opts.length ? <ul className="criteria">{opts.map((o) => <li key={o} lang="el">{o}</li>)}</ul> : null}
        <dl className="kv mt8"><dt>Ключ</dt><dd lang="el">{strs(e.answer).join(' / ') || '—'}</dd><dt>Допустимые</dt><dd lang="el">{strs(e.accepted_alternatives).join(' / ') || '—'}</dd><dt>Образец</dt><dd lang="el">{typeof e.model_response === 'string' ? e.model_response : '—'}</dd><dt>Пояснение автора</dt><dd>{typeof e.original_payload?.rationale === 'string' ? e.original_payload.rationale : '—'}</dd><dt>Хеш</dt><dd className="code">{it.current_hash}</dd></dl>
      </div>
    );
    editor = <PatchEditor itemId={it.item_id} baseHash={it.current_hash} prompt={e.prompt} options={Array.isArray(e.options) && e.options.every((o) => typeof o === 'string') && e.options.length ? (e.options as string[]) : null} answer={strs(e.answer)} alternatives={strs(e.accepted_alternatives)} modelResponse={typeof e.model_response === 'string' ? e.model_response : null} issueId={openFix?.id} />;
  } else if (kind === 'unit') {
    const { data: u } = await db.from('units').select('unit_id, level, title_ru, teaching, current_hash').eq('unit_id', id).maybeSingle();
    if (!u) notFound();
    hash = u.current_hash;
    const t = u.teaching as { theory_ru?: string };
    const openFix = (issues ?? []).find((i) => i.status === 'open' && i.content_hash === u.current_hash && (i.field ?? '').startsWith('theory'));
    header = <div className="card cardpad"><span className="tag gray">урок · {u.level}</span><h3 style={{ margin: '10px 0 4px' }}>{u.title_ru}</h3><p className="tiny quiet">Хеш <span className="code">{u.current_hash}</span></p></div>;
    editor = <UnitPatchEditor unitId={u.unit_id} baseHash={u.current_hash} field="theory_ru" text={t.theory_ru ?? ''} issueId={openFix?.id} />;
  } else {
    const { data: sc } = await db.from('speaking_scenarios').select('scenario_id, level, domain, objective_ru, current_hash').eq('scenario_id', id).maybeSingle();
    if (!sc) notFound();
    hash = sc.current_hash;
    header = <div className="card cardpad"><span className="tag gray">сценарий · {sc.level}</span><h3 style={{ margin: '10px 0 4px' }}>{sc.domain}</h3><p className="small quiet">{sc.objective_ru}</p></div>;
  }
  const current = (issues ?? []).filter((i) => i.content_hash === hash);
  return (
    <div className="admin-section">
      <div className="row"><Link className="text-link" href="/admin/qa"><Icon name="arrow" size={12} /> К очереди</Link><b>{id}</b></div>
      <div className="admin-split">
        <div className="stack">
          {header}
          <div className="card cardpad">
            <div className="card-title"><Icon name="alert" /> Замечания текущей ревизии</div>
            {current.length ? current.map((i) => (
              <div className="review-row" key={i.id} style={{ alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0 }}><b>{i.message_ru}</b><span className="event-text">{title.get(i.check_id) ?? i.check_id} · поле {i.field ?? '—'}{i.suggestion ? ` · предложение: ${String(i.suggestion).slice(0, 80)}` : ''}</span>{i.resolution_note ? <span className="event-text">Решение: {i.resolution_note}</span> : null}</div>
                <IssueActions issueId={i.id} status={i.status} checkId={i.check_id} acceptable={!MUST_FIX.has(i.check_id)} />
              </div>
            )) : <div className="empty"><strong>Замечаний нет</strong>Текущая ревизия прошла все автоматические проверки или ещё не проверялась.</div>}
          </div>
          {editor ? <div className="card cardpad"><div className="card-title"><Icon name="edit" /> Исправить (новая ревизия)</div>{editor}</div> : null}
        </div>
        <div className="stack">
          <div className="card cardpad"><div className="card-title"><Icon name="layers" /> История проверок</div>
            {(results ?? []).map((r) => <div className="review-row" key={r.batch_id}><span><b style={{ fontSize: 12.5 }}>{(r.qa_batches as unknown as { label: string } | null)?.label ?? r.batch_id.slice(0, 8)}</b><span className="event-text">хеш {r.content_hash.slice(0, 10)} · блок. {r.blocking_count} · предупр. {r.warning_count}</span></span><span className={`status ${r.verdict === 'PASS' ? '' : r.verdict === 'FAIL' ? 'blocked' : 'wait'}`}>{r.verdict}</span></div>)}
          </div>
          <div className="card cardpad"><div className="card-title"><Icon name="edit" /> Правки</div>
            {(patches ?? []).length ? (patches ?? []).map((p) => <div className="review-row" key={p.new_hash}><span><b style={{ fontSize: 12.5 }}>{p.reason}</b><span className="event-text">{p.base_hash.slice(0, 8)} → {p.new_hash.slice(0, 8)} · {dateTimeRu(p.created_at)}</span></span></div>) : <p className="small quiet">Правок не было — текст совпадает с каноническим корпусом.</p>}
          </div>
          <div className="card cardpad"><div className="card-title"><Icon name="shield" /> Допуски</div>
            {(releases ?? []).length ? (releases ?? []).map((r) => <div className="review-row" key={r.id}><span><b style={{ fontSize: 12.5 }}>{r.review_type}</b><span className="event-text">хеш {r.content_hash.slice(0, 10)} · {dateTimeRu(r.reviewed_at)}{r.revoked_at ? ` · отозван: ${r.revoked_reason}` : ''}</span></span><span className={`status ${r.revoked_at ? 'blocked' : ''}`}>{r.revoked_at ? 'отозван' : 'активен'}</span></div>) : <p className="small quiet">Не выпускался.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
