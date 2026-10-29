'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function AudioRender({ audioId, planHash, configured, defaultCap }: { audioId: string; planHash: string; configured: boolean; defaultCap: number }) {
  const router = useRouter();
  const [cap, setCap] = useState(defaultCap);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!configured) return <p className="small quiet mt8">Генерация недоступна: для ролей этого задания нет утверждённого кастинга или подходящего голоса (см. «Голоса и кастинг»).</p>;
  async function run() {
    setBusy(true); setMsg(null);
    const res = await fetch('/api/admin/audio/render', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ audio_id: audioId, approved_plan_hash: planHash, budget_cap_usd: cap }) });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setMsg({ ok: false, text: j.message ?? 'Генерация не выполнена' });
    setMsg({ ok: true, text: j.status === 'REUSED' ? 'Этот план уже был сгенерирован — файл переиспользован.' : `Готово: ${j.render_status ?? j.job_status}` });
    router.refresh();
  }
  return (
    <div className="inline-form mt16">
      <div className="field"><label htmlFor="cap">Лимит расходов на запуск, USD</label><input id="cap" type="number" min={0.01} max={100} step={0.5} value={cap} onChange={(e) => setCap(Number(e.target.value))} /></div>
      <div className="check-list"><label><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />Я утверждаю этот план (хеш плана выше) и понимаю, что результат — синтезированная речь, не запись носителя.</label></div>
      <button type="button" className="btn" disabled={!ack || busy} onClick={run}>{busy ? 'Генерирую… (может занять минуты)' : 'Сгенерировать'}</button>
      {msg ? <span className={msg.ok ? 'msg-ok' : 'error-text'} role="status">{msg.text}</span> : null}
    </div>
  );
}

export function RightsForm({ assetId, provider }: { assetId: string; provider: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [prov, setProv] = useState(provider);
  const [url, setUrl] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [scope, setScope] = useState('Синтезированная речь для учебной платформы; показ приглашённым ученикам');
  const [msg, setMsg] = useState<string | null>(null);
  async function save() {
    const res = await fetch('/api/admin/audio/rights', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ asset_id: assetId, provider: prov, terms_url: url, checked_on: date, scope_ru: scope }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return setMsg(j.message ?? 'Не сохранено');
    setOpen(false);
    router.refresh();
  }
  if (!open) return <button type="button" className="btn flat" onClick={() => setOpen(true)}>Записать условия провайдера</button>;
  return (
    <div className="inline-form" style={{ width: '100%' }}>
      <div className="field"><label>Провайдер</label><input value={prov} onChange={(e) => setProv(e.target.value)} /></div>
      <div className="field"><label>Ссылка на условия использования</label><input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" /></div>
      <div className="field"><label>Дата проверки</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
      <div className="field"><label>Охват использования</label><input value={scope} onChange={(e) => setScope(e.target.value)} /></div>
      <div className="row"><button type="button" className="btn outline" onClick={save}>Сохранить</button><button type="button" className="btn outline" onClick={() => setOpen(false)}>Отмена</button></div>
      {msg ? <span className="error-text">{msg}</span> : null}
    </div>
  );
}

export function AssetPlayer({ assetId }: { assetId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function load() {
    const r = await fetch(`/api/media/audio/${assetId}`);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return setErr(j.message ?? 'Недоступно');
    setUrl(j.url);
  }
  return url ? <audio controls src={url} style={{ width: '100%' }}><track kind="captions" /></audio> : <span><button type="button" className="text-link" onClick={load}>Прослушать (подписанная ссылка, 5 мин)</button>{err ? <span className="error-text"> {err}</span> : null}</span>;
}
