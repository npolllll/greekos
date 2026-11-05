'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** Owner signs the digital-only publication policy: every risk must be ticked and the phrase typed. */
export function PolicySign({ risks }: { risks: Array<{ id: string; text: string }> }) {
  const router = useRouter();
  const [ack, setAck] = useState<Set<string>>(new Set());
  const [phrase, setPhrase] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const all = risks.every((r) => ack.has(r.id));
  async function sign() {
    setBusy(true); setErr(null);
    const r = await fetch('/api/admin/policy', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ acknowledged: [...ack], confirm_text: phrase }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setErr(j.message ?? 'Не подписано');
    router.refresh();
  }
  return (
    <div>
      <div className="check-list">
        {risks.map((r) => (
          <label key={r.id}><input type="checkbox" checked={ack.has(r.id)} onChange={(e) => { const n = new Set(ack); if (e.target.checked) n.add(r.id); else n.delete(r.id); setAck(n); }} />{r.text}</label>
        ))}
      </div>
      <div className="field"><label htmlFor="pol-phrase">Введите «ПРИНИМАЮ РИСК»</label><input id="pol-phrase" value={phrase} onChange={(e) => setPhrase(e.target.value)} autoComplete="off" /></div>
      <button type="button" className="btn" disabled={!all || phrase !== 'ПРИНИМАЮ РИСК' || busy} onClick={sign}>{busy ? 'Подписываю…' : 'Подписать политику'}</button>
      {err ? <p className="error-text" role="alert">{err}</p> : null}
      <p className="tiny muted mt8">Подпись не выпускает материалы автоматически: каждый урок, задание или аудио выпускается отдельным решением на конкретный хеш.</p>
    </div>
  );
}
