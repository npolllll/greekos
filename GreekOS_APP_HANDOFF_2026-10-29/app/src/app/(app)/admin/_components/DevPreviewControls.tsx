'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

async function post(body: unknown) {
  const r = await fetch('/api/admin/dev-preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { ok: r.ok, json: (await r.json().catch(() => ({}))) as Record<string, unknown> };
}

export function CreateTester() {
  const router = useRouter();
  const [name, setName] = useState('Тестовый ученик');
  const [email, setEmail] = useState('');
  const [days, setDays] = useState(14);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ ok: boolean; text: string; password?: string } | null>(null);
  async function create() {
    setBusy(true);
    const { ok, json } = await post({ action: 'create_tester', display_name: name, email, days });
    setBusy(false);
    if (!ok) return setRes({ ok: false, text: String(json.message ?? 'Не создано') });
    setRes({ ok: true, text: `Создан ${json.email}. DEV-PREVIEW до ${new Date(String(json.expires_at)).toLocaleDateString('ru-RU')}.`, password: String(json.password_once) });
    router.refresh();
  }
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="grid-3">
        <div className="field" style={{ margin: 0 }}><label htmlFor="t-name">Имя</label><input id="t-name" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="field" style={{ margin: 0 }}><label htmlFor="t-mail">E-mail (локальный)</label><input id="t-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tester@greekos.local" /></div>
        <div className="field" style={{ margin: 0 }}><label htmlFor="t-days">Дней доступа</label><input id="t-days" type="number" min={1} max={30} value={days} onChange={(e) => setDays(Number(e.target.value))} /></div>
      </div>
      <button type="button" className="btn" disabled={busy || !email} onClick={create}>{busy ? 'Создаю…' : 'Создать тестового ученика'}</button>
      {res ? <div className={`banner ${res.ok ? 'ok' : 'danger'}`} role="status"><span>{res.text}{res.password ? <> Пароль (показывается один раз): <span className="code">{res.password}</span></> : null}</span></div> : null}
    </div>
  );
}

export function GrantRevoke({ userId, active }: { userId: string; active: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function act() {
    let body: Record<string, unknown> = { action: 'grant', user_id: userId, days: 14 };
    if (active) {
      const reason = window.prompt('Причина отзыва DEV-PREVIEW');
      if (!reason || reason.trim().length < 3) return;
      body = { action: 'revoke', user_id: userId, reason };
    }
    setBusy(true);
    const { ok, json } = await post(body);
    setBusy(false);
    if (!ok) return setErr(String(json.message ?? 'Ошибка'));
    router.refresh();
  }
  return <span className="inline-form"><button type="button" className={`btn small ${active ? 'outline' : ''}`} disabled={busy} onClick={act}>{active ? 'Отозвать' : 'Выдать на 14 дней'}</button>{err ? <span className="error-text">{err}</span> : null}</span>;
}
