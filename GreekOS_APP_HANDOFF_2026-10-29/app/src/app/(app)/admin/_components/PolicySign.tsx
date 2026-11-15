'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** Owner signs the digital-only publication policy: every risk must be ticked and the phrase typed. */
export function PolicySign({ risks, delegation }: { risks: Array<{ id: string; text: string }>; delegation: string }) {
  const router = useRouter();
  const [ack, setAck] = useState<Set<string>>(new Set());
  const [phrase, setPhrase] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [delegate, setDelegate] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const all = risks.every((r) => ack.has(r.id));
  async function sign() {
    setBusy(true); setErr(null);
    const r = await fetch('/api/admin/policy', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ acknowledged: [...ack], confirm_text: phrase, delegate_editorial: delegate }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setErr(j.message ?? 'Не подписано');
    const c = j.editorial?.content as { status?: string; released?: number; reason?: string } | undefined;
    if (c) setResult(c.status === 'released' ? `AI-редактор выпустил материалов: ${c.released ?? 0}.` : `Выпуск AI-редактором пока не выполнен: ${c.reason ?? '—'}.`);
    router.refresh();
  }
  return (
    <div>
      <div className="check-list">
        {risks.map((r) => (
          <label key={r.id}><input type="checkbox" checked={ack.has(r.id)} onChange={(e) => { const n = new Set(ack); if (e.target.checked) n.add(r.id); else n.delete(r.id); setAck(n); }} />{r.text}</label>
        ))}
      </div>
      <label className="box mt8" style={{ display: 'flex', gap: 8 }}><input type="checkbox" checked={delegate} onChange={(e) => setDelegate(e.target.checked)} /><span className="small">{delegation}</span></label>
      <div className="field"><label htmlFor="pol-phrase">Введите «ПРИНИМАЮ РИСК»</label><input id="pol-phrase" value={phrase} onChange={(e) => setPhrase(e.target.value)} autoComplete="off" /></div>
      <button type="button" className="btn" disabled={!all || phrase !== 'ПРИНИМАЮ РИСК' || busy} onClick={sign}>{busy ? 'Подписываю…' : 'Подписать политику'}</button>
      {err ? <p className="error-text" role="alert">{err}</p> : null}
      {result ? <p className="small" role="status">{result}</p> : null}
      <p className="tiny muted mt8">Без поручения подпись ничего не выпускает: каждое решение принимается отдельно на конкретный хеш. С поручением AI-редактор сразу выпускает только материалы с вердиктом PASS и проверенной выборкой; запись — от имени AI-редактора, отменить можно здесь же.</p>
    </div>
  );
}
