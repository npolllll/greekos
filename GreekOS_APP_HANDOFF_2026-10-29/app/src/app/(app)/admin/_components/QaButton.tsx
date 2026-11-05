'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface QaResult { verdict: string; report: { summary_ru?: string; reason?: string; issues?: Array<{ field: string; quote: string; problem_ru: string; suggestion: string | null; severity: string }>; key_ambiguity?: boolean; missing_plausible_alternatives?: string[] } }

/** Runs DIGITAL_LINGUISTIC_QA for one item and shows the report (automated, not a human review). */
export function QaButton({ itemId }: { itemId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<QaResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function run() {
    setBusy(true); setErr(null);
    const r = await fetch('/api/admin/qa', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ item_id: itemId }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setErr(j.message ?? 'Проверка не выполнена');
    setRes(j);
    router.refresh();
  }
  return (
    <span>
      <button type="button" className="text-link" onClick={run} disabled={busy}>{busy ? 'Проверяю…' : 'Цифровая проверка'}</button>
      {err ? <span className="error-text" role="alert"> {err}</span> : null}
      {res ? (
        <div className="small" style={{ maxWidth: 420 }}>
          <span className="ai-label">AI-проверка · {res.verdict}</span>
          {res.report.summary_ru ? <p className="small">{res.report.summary_ru}</p> : res.report.reason ? <p className="small">Причина: {res.report.reason}</p> : null}
          {res.report.key_ambiguity ? <p className="small">Ключ может быть неоднозначным.</p> : null}
          {res.report.issues?.length ? <ul className="criteria">{res.report.issues.map((i, n) => <li key={n}><b>{i.field}</b> «{i.quote}» — {i.problem_ru}{i.suggestion ? ` → ${i.suggestion}` : ''} ({i.severity})</li>)}</ul> : null}
          {res.report.missing_plausible_alternatives?.length ? <p className="small">Возможные альтернативы: {res.report.missing_plausible_alternatives.join(' / ')}</p> : null}
        </div>
      ) : null}
    </span>
  );
}
