'use client';
import { useState } from 'react';
import { browserClient } from '@/lib/supabase/browser';

/**
 * Change of one's own password: the current password is checked first, the new one is saved, and every
 * other session of this account is signed out (a leaked password stops working everywhere at once).
 * This device stays signed in, so the owner never locks themselves out.
 */
export function ChangePassword({ email }: { email: string }) {
  const [cur, setCur] = useState('');
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (p1.length < 12) return setMsg({ ok: false, text: 'Новый пароль — не короче 12 символов.' });
    if (p1 !== p2) return setMsg({ ok: false, text: 'Новые пароли не совпадают.' });
    if (p1 === cur) return setMsg({ ok: false, text: 'Новый пароль совпадает с текущим.' });
    setBusy(true);
    const sb = browserClient();
    const check = await sb.auth.signInWithPassword({ email, password: cur });
    if (check.error) { setBusy(false); return setMsg({ ok: false, text: 'Текущий пароль неверный.' }); }
    const { error } = await sb.auth.updateUser({ password: p1 });
    if (error) { setBusy(false); return setMsg({ ok: false, text: 'Не удалось сохранить пароль: выберите другой.' }); }
    await sb.auth.signOut({ scope: 'others' });
    setBusy(false);
    setCur(''); setP1(''); setP2('');
    setMsg({ ok: true, text: 'Пароль изменён. Остальные устройства вышли из аккаунта; на этом вы остаётесь в системе.' });
  }

  return (
    <form className="card cardpad" onSubmit={submit} aria-label="Смена пароля">
      <div className="card-title">Пароль и вход</div>
      <input type="email" autoComplete="username" value={email} readOnly hidden />
      <div className="field"><label htmlFor="pw-cur">Текущий пароль</label><input id="pw-cur" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} /></div>
      <div className="field"><label htmlFor="pw-new">Новый пароль</label><input id="pw-new" type="password" autoComplete="new-password" value={p1} onChange={(e) => setP1(e.target.value)} /></div>
      <div className="field"><label htmlFor="pw-new2">Повторите новый пароль</label><input id="pw-new2" type="password" autoComplete="new-password" value={p2} onChange={(e) => setP2(e.target.value)} /></div>
      {msg ? <p className={msg.ok ? 'small' : 'error-text'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</p> : null}
      <button className="btn" type="submit" disabled={busy || !cur || !p1 || !p2}>{busy ? 'Сохраняю…' : 'Сменить пароль'}</button>
      <p className="tiny muted mt8">Не короче 12 символов. После смены все другие устройства выходят из аккаунта.</p>
    </form>
  );
}
