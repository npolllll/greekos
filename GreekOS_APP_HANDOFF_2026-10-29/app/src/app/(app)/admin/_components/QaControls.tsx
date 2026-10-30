'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import { Icon } from '@/components/Icon';

async function post(url: string, body: unknown): Promise<{ ok: boolean; json: Record<string, unknown> }> {
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { ok: r.ok, json: await r.json().catch(() => ({})) };
  } catch {
    return { ok: false, json: { message: 'Нет связи с сервером' } };
  }
}

export function RunQaButton({ unitId, label = 'Запустить цифровую проверку' }: { unitId?: string; label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function run() {
    setBusy(true); setMsg(null);
    const { ok, json } = await post('/api/admin/qa/batches', unitId ? { unit_id: unitId } : {});
    setBusy(false);
    if (!ok) return setMsg(String(json.message ?? 'Проверка не выполнена'));
    const t = json.totals as Record<string, number> | undefined;
    setMsg(t ? `Готово: PASS ${t.PASS} · на проверку ${t.NEEDS_REVIEW} · FAIL ${t.FAIL}` : 'Готово');
    router.refresh();
  }
  return (
    <span className="row" style={{ gap: 8 }}>
      <button type="button" className="btn" onClick={run} disabled={busy}><Icon name="spark" size={15} /> {busy ? 'Проверяю корпус…' : label}</button>
      {msg ? <span className="small" role="status">{msg}</span> : null}
    </span>
  );
}

/** Per-issue owner decision with a mandatory note (rights need a documented basis). */
export function IssueActions({ issueId, status, checkId, acceptable }: { issueId: string; status: string; checkId: string; acceptable: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<null | 'false_positive' | 'accepted_risk'>(null);
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function send(action: 'false_positive' | 'accepted_risk' | 'reopen') {
    setBusy(true); setErr(null);
    const { ok, json } = await post('/api/admin/qa/issues', { issue_id: issueId, action, note });
    setBusy(false);
    if (!ok) return setErr(String(json.message ?? 'Не сохранено'));
    setMode(null); setNote('');
    router.refresh();
  }
  if (status !== 'open') {
    return <span className="row" style={{ gap: 6 }}><span className={`tag ${status === 'fixed' ? 'green' : status === 'false_positive' ? 'blue' : 'gold'}`}>{status === 'fixed' ? 'исправлено' : status === 'false_positive' ? 'ложное' : status === 'accepted_risk' ? 'риск принят' : status}</span>{status !== 'fixed' && status !== 'superseded' ? <button type="button" className="text-link" onClick={() => send('reopen')} disabled={busy}>вернуть</button> : null}</span>;
  }
  return (
    <div style={{ minWidth: 190 }}>
      {!mode ? (
        <div className="row" style={{ gap: 6 }}>
          <button type="button" className="chip" onClick={() => setMode('false_positive')}>Ложное</button>
          {acceptable ? <button type="button" className="chip" onClick={() => setMode('accepted_risk')}>Принять риск</button> : <span className="tiny quiet" title="Такую ошибку нельзя принять — исправьте материал">только исправление</span>}
        </div>
      ) : (
        <div className="inline-form">
          <textarea className="input" style={{ fontSize: 13, minHeight: 64 }} value={note} onChange={(e) => setNote(e.target.value)} placeholder={mode === 'accepted_risk' && checkId === 'rights.license' ? 'Происхождение и основание прав (≥ 20 символов)' : 'Обоснование'} aria-label="Обоснование решения" />
          <div className="row" style={{ gap: 6 }}><button type="button" className="btn small" disabled={busy} onClick={() => send(mode)}>Сохранить</button><button type="button" className="btn small outline" onClick={() => setMode(null)}>Отмена</button></div>
        </div>
      )}
      {err ? <p className="error-text" role="alert">{err}</p> : null}
    </div>
  );
}

/** Owner correction of an item: becomes a new immutable revision; old releases are revoked. */
export function PatchEditor(props: { itemId: string; baseHash: string; prompt: string; options: string[] | null; answer: string[]; alternatives: string[]; modelResponse: string | null; issueId?: string }) {
  const router = useRouter();
  const [prompt, setPrompt] = useState(props.prompt);
  const [options, setOptions] = useState((props.options ?? []).join('\n'));
  const [answer, setAnswer] = useState(props.answer.join('\n'));
  const [alts, setAlts] = useState(props.alternatives.join('\n'));
  const [model, setModel] = useState(props.modelResponse ?? '');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ ok: boolean; text: string } | null>(null);
  const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);
  async function save() {
    const changes: Record<string, unknown> = {};
    if (prompt !== props.prompt) changes.prompt = prompt;
    if (props.options && lines(options).join('\n') !== props.options.join('\n')) changes.options = lines(options);
    if (lines(answer).join('\n') !== props.answer.join('\n')) changes.answer = lines(answer);
    if (lines(alts).join('\n') !== props.alternatives.join('\n')) changes.accepted_alternatives = lines(alts);
    if ((model || null) !== props.modelResponse) changes.model_response = model || null;
    if (!Object.keys(changes).length) return setRes({ ok: false, text: 'Изменений нет.' });
    setBusy(true);
    const { ok, json } = await post('/api/admin/qa/patch', { item_id: props.itemId, base_hash: props.baseHash, reason, changes, ...(props.issueId ? { issue_id: props.issueId } : {}) });
    setBusy(false);
    if (!ok) return setRes({ ok: false, text: String(json.message ?? 'Не сохранено') });
    const qa = json.qa as { totals?: Record<string, number> } | undefined;
    setRes({ ok: true, text: `Новая ревизия ${String(json.new_hash).slice(0, 12)}. Отозвано допусков: ${json.revoked_releases}. Повторная проверка: ${qa?.totals?.PASS ? 'PASS' : qa?.totals?.FAIL ? 'FAIL' : 'нужно внимание'}.` });
    router.refresh();
  }
  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="field" style={{ margin: '4px 0' }}><label htmlFor="p-prompt">Формулировка</label><textarea id="p-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} lang="el" /></div>
      {props.options ? <div className="field" style={{ margin: '4px 0' }}><label htmlFor="p-opt">Варианты (по строке; число вариантов не меняется)</label><textarea id="p-opt" value={options} onChange={(e) => setOptions(e.target.value)} lang="el" /></div> : null}
      <div className="grid-2">
        <div className="field" style={{ margin: '4px 0' }}><label htmlFor="p-ans">Ключ (по строке)</label><textarea id="p-ans" value={answer} onChange={(e) => setAnswer(e.target.value)} lang="el" style={{ minHeight: 70 }} /></div>
        <div className="field" style={{ margin: '4px 0' }}><label htmlFor="p-alt">Допустимые варианты</label><textarea id="p-alt" value={alts} onChange={(e) => setAlts(e.target.value)} lang="el" style={{ minHeight: 70 }} /></div>
      </div>
      <div className="field" style={{ margin: '4px 0' }}><label htmlFor="p-model">Образец ответа</label><textarea id="p-model" value={model} onChange={(e) => setModel(e.target.value)} lang="el" style={{ minHeight: 70 }} /></div>
      <div className="field" style={{ margin: '4px 0' }}><label htmlFor="p-reason">Причина правки (в журнал)</label><input id="p-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Например: опечатка в ключе — конечная сигма" /></div>
      <div className="row"><button type="button" className="btn" disabled={busy || reason.trim().length < 3} onClick={save}>{busy ? 'Сохраняю ревизию…' : 'Сохранить как новую ревизию'}</button><span className="tiny quiet">Старые допуски этого задания будут отозваны автоматически.</span></div>
      {res ? <p className={res.ok ? 'msg-ok' : 'error-text'} role={res.ok ? 'status' : 'alert'}>{res.text}</p> : null}
    </div>
  );
}

export function SampleCard(props: { batchId: string; itemId: string; prompt: string; options: string[]; answer: string[]; alternatives: string[]; type: string; level: string | null; review: { decision: string; note: string | null } | null }) {
  const router = useRouter();
  const [note, setNote] = useState('');
  const [issue, setIssue] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function send(decision: 'OK' | 'ISSUE') {
    setBusy(true); setErr(null);
    const { ok, json } = await post('/api/admin/qa/sample', { batch_id: props.batchId, item_id: props.itemId, decision, ...(note ? { note } : {}) });
    setBusy(false);
    if (!ok) return setErr(String(json.message ?? 'Не сохранено'));
    router.refresh();
  }
  return (
    <motion.div layout className={`card cardpad ${props.review ? (props.review.decision === 'OK' ? 'sample-ok' : 'sample-issue') : ''}`}>
      <div className="row between"><span className="tag gray">{props.level ?? '—'} · {props.type}</span><a className="tiny" href={`/admin/qa/item/${encodeURIComponent(props.itemId)}`}>{props.itemId}</a></div>
      <p style={{ fontWeight: 600, margin: '10px 0 8px' }} lang="el">{props.prompt}</p>
      {props.options.length ? <ul className="criteria" style={{ marginTop: 0 }}>{props.options.map((o) => <li key={o} lang="el">{o}</li>)}</ul> : null}
      <p className="small" style={{ margin: '6px 0' }}>Ключ: <b lang="el">{props.answer.join(' / ') || '— (оценка по критериям)'}</b>{props.alternatives.length ? <span className="quiet"> · также: <span lang="el">{props.alternatives.slice(0, 4).join(' / ')}</span></span> : null}</p>
      <AnimatePresence mode="wait" initial={false}>
        {props.review ? (
          <motion.p key="done" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="small" style={{ margin: 0 }}>
            {props.review.decision === 'OK' ? <span className="tag green"><Icon name="check" size={13} /> проверено: корректно</span> : <span className="tag">проблема: {props.review.note}</span>}
          </motion.p>
        ) : (
          <motion.div key="todo" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="stack" style={{ gap: 6 }}>
            {issue ? <textarea className="input" style={{ fontSize: 13, minHeight: 60 }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Что не так?" aria-label="Описание проблемы" /> : null}
            <div className="row" style={{ gap: 6 }}>
              <button type="button" className="btn small" disabled={busy} onClick={() => send('OK')}><Icon name="check" size={14} /> Корректно</button>
              {!issue ? <button type="button" className="btn small outline" onClick={() => setIssue(true)}>Есть проблема</button> : <button type="button" className="btn small dark" disabled={busy || !note.trim()} onClick={() => send('ISSUE')}>Отметить проблему</button>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {err ? <p className="error-text" role="alert">{err}</p> : null}
    </motion.div>
  );
}

export function DecisionForm(props: { batchId: string; scope: Record<string, unknown>; policyActive: boolean; releasable: number; accepted: number; sampleDone: boolean; needsExpiry: boolean; scopeLabel: string }) {
  const router = useRouter();
  const [risk, setRisk] = useState<'PASS_ONLY' | 'PASS_AND_ACCEPTED_WARNINGS'>('PASS_ONLY');
  const [note, setNote] = useState('');
  const [exp, setExp] = useState('');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ ok: boolean; text: string } | null>(null);
  const blocked = !props.policyActive || !props.sampleDone || props.releasable === 0;
  async function decide() {
    setBusy(true); setRes(null);
    const { ok, json } = await post('/api/admin/qa/decision', { batch_id: props.batchId, scope: props.scope, risk_acceptance: risk, ...(note ? { note } : {}), ...(exp ? { expires_at: new Date(`${exp}T23:59:59Z`).toISOString() } : {}), confirm: true });
    setBusy(false);
    if (!ok) return setRes({ ok: false, text: String(json.message ?? 'Решение не записано') });
    setRes({ ok: true, text: `Решение записано: выпущено ${json.released}, уже было ${json.already_released}.` });
    router.refresh();
  }
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="entry-options">
        <label className="entry-option"><input type="radio" name="risk" checked={risk === 'PASS_ONLY'} onChange={() => setRisk('PASS_ONLY')} /><span><b>Только PASS</b><small>{props.releasable - props.accepted} объектов без замечаний</small></span></label>
        <label className="entry-option"><input type="radio" name="risk" checked={risk === 'PASS_AND_ACCEPTED_WARNINGS'} onChange={() => setRisk('PASS_AND_ACCEPTED_WARNINGS')} /><span><b>PASS и принятые мной риски</b><small>{props.releasable} объектов, включая {props.accepted} с решениями по замечаниям</small></span></label>
      </div>
      {props.needsExpiry ? <div className="field" style={{ margin: 0 }}><label htmlFor="d-exp">Окончание допуска ΠΕΓΠ (обязательно)</label><input id="d-exp" type="date" value={exp} onChange={(e) => setExp(e.target.value)} /></div> : null}
      <div className="field" style={{ margin: 0 }}><label htmlFor="d-note">Комментарий к решению</label><input id="d-note" value={note} onChange={(e) => setNote(e.target.value)} /></div>
      <div className="check-list"><label><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />Я выпускаю для учеников «{props.scopeLabel}» по цифровой политике: материалы прошли цифровой QA и мою выборочную проверку, но не проверялись независимым преподавателем. Изменение любого материала отзовёт допуск.</label></div>
      {!props.policyActive ? <p className="error-text">Сначала подпишите цифровую политику выпуска (раздел «Политика выпуска»).</p> : !props.sampleDone ? <p className="error-text">Завершите выборочную проверку выше.</p> : null}
      <button type="button" className="btn" disabled={blocked || !ack || busy || (props.needsExpiry && !exp)} onClick={decide}>{busy ? 'Записываю решение…' : 'Принять решение о выпуске'}</button>
      {res ? <p className={res.ok ? 'msg-ok' : 'error-text'} role={res.ok ? 'status' : 'alert'}>{res.text}</p> : null}
    </div>
  );
}

export function RevokeDecision({ decisionId }: { decisionId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function revoke() {
    const reason = window.prompt('Причина отзыва всех допусков этого решения');
    if (!reason || reason.trim().length < 3) return;
    setBusy(true);
    await post('/api/admin/qa/decision', { revoke: decisionId, reason: reason.trim() });
    setBusy(false);
    router.refresh();
  }
  return <button type="button" className="btn small outline" onClick={revoke} disabled={busy}>{busy ? 'Отзываю…' : 'Отозвать'}</button>;
}

/** Owner correction of a unit text (theory/outcome) → new unit revision, releases of the old hash revoked. */
export function UnitPatchEditor(props: { unitId: string; baseHash: string; field: 'theory_ru' | 'learning_outcome'; text: string; issueId?: string }) {
  const router = useRouter();
  const [text, setText] = useState(props.text);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ ok: boolean; text: string } | null>(null);
  async function save() {
    setBusy(true);
    const { ok, json } = await post('/api/admin/qa/patch', { unit_id: props.unitId, base_hash: props.baseHash, field: props.field, text, reason, ...(props.issueId ? { issue_id: props.issueId } : {}) });
    setBusy(false);
    if (!ok) return setRes({ ok: false, text: String(json.message ?? 'Не сохранено') });
    setRes({ ok: true, text: `Новая ревизия урока ${String(json.new_hash).slice(0, 12)}; отозвано допусков: ${json.revoked_releases}.` });
    router.refresh();
  }
  return (
    <div className="stack" style={{ gap: 6 }}>
      <textarea className="input" style={{ minHeight: 260, fontSize: 14, lineHeight: 1.7 }} value={text} onChange={(e) => setText(e.target.value)} aria-label="Текст урока" />
      <div className="field" style={{ margin: 0 }}><label htmlFor="u-reason">Причина правки</label><input id="u-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Например: латинская/кириллическая буква внутри слова" /></div>
      <button type="button" className="btn" disabled={busy || reason.trim().length < 3 || text === props.text} onClick={save}>{busy ? 'Сохраняю…' : 'Сохранить ревизию урока'}</button>
      {res ? <p className={res.ok ? 'msg-ok' : 'error-text'} role={res.ok ? 'status' : 'alert'}>{res.text}</p> : null}
    </div>
  );
}
