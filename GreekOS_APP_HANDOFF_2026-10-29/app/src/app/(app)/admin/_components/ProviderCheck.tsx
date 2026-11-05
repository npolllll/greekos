'use client';
import { Fragment, useState } from 'react';
import { useRouter } from 'next/navigation';

const LABEL: Record<string, string> = { llm: 'LLM', tts: 'TTS', asr: 'ASR' };

/** Triggers minimal real calls to configured providers (costs a few cents at most). */
export function ProviderCheck() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Record<string, Record<string, unknown>> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function run() {
    setBusy(true); setErr(null);
    const r = await fetch('/api/admin/providers/check', { method: 'POST' });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setErr(j.message ?? 'Проверка не выполнена');
    setRes(j.results);
    router.refresh();
  }
  return (
    <div className="mt16">
      <button type="button" className="btn outline" onClick={run} disabled={busy}>{busy ? 'Проверяю…' : 'Проверить подключение'}</button>
      {err ? <p className="error-text" role="alert">{err}</p> : null}
      {res ? (
        <dl className="kv mt8">
          {Object.entries(res).map(([k, v]) => <Fragment key={k}><dt>{LABEL[k] ?? k}</dt><dd><b>{String(v.status)}</b> <span className="tiny muted">{JSON.stringify(Object.fromEntries(Object.entries(v).filter(([kk]) => kk !== 'status')))}</span></dd></Fragment>)}
        </dl>
      ) : null}
    </div>
  );
}
