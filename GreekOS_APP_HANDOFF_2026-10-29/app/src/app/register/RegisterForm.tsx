'use client';
import { useState } from 'react';

export function RegisterForm({ needsCode }: { needsCode: boolean }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!consent) { setError('Подтвердите согласие на обработку данных для обучения.'); return; }
    setBusy(true);
    const r = await fetch('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ display_name: name, email, code, consent: true }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    setBusy(false);
    if (!r) { setError('Нет связи с сервером. Проверьте подключение и повторите.'); return; }
    if (!r.ok) { setError(j.message ?? 'Не удалось зарегистрироваться. Проверьте данные.'); return; }
    setSent(j.message_ru);
  }

  if (sent) return <div className="banner ok mt16" role="status"><span><strong>Проверьте почту.</strong> {sent}</span></div>;

  return (
    <form onSubmit={submit} noValidate>
      <div className="field">
        <label htmlFor="name">Как к вам обращаться</label>
        <input id="name" autoComplete="name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="email">E-mail</label>
        <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      {needsCode ? (
        <div className="field">
          <label htmlFor="code">Код регистрации</label>
          <input id="code" autoComplete="off" required value={code} onChange={(e) => setCode(e.target.value)} placeholder="XXXX-XXXX" />
          <small className="quiet">Код выдаёт владелец курса.</small>
        </div>
      ) : null}
      <label className="consent-row">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>Согласен(на), чтобы мои ответы, прогресс и (по отдельному согласию) записи голоса хранились для обучения. Данные видит только владелец курса; их можно выгрузить или удалить.</span>
      </label>
      {error ? <p className="error-text" role="alert">{error}</p> : null}
      <button className="btn" type="submit" disabled={busy || !name.trim() || !email.trim()} style={{ width: '100%', marginTop: 6 }}>{busy ? 'Отправляю…' : 'Получить письмо для входа'}</button>
    </form>
  );
}
