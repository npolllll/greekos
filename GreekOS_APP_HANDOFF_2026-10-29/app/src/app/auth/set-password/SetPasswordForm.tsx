'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { browserClient } from '@/lib/supabase/browser';

export function SetPasswordForm({ email }: { email: string }) {
  const router = useRouter();
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (p1.length < 10) return setError('Пароль должен быть не короче 10 символов.');
    if (p1 !== p2) return setError('Пароли не совпадают.');
    setBusy(true);
    const { error } = await browserClient().auth.updateUser({ password: p1 });
    if (error) {
      setBusy(false);
      return setError('Не удалось сохранить пароль. Выберите другой пароль.');
    }
    await fetch('/api/me/activate', { method: 'POST' });
    router.replace('/');
    router.refresh();
  }

  return (
    <form onSubmit={submit}>
      <input type="email" autoComplete="username" value={email} readOnly hidden />
      <div className="field"><label htmlFor="p1">Новый пароль</label><input id="p1" type="password" autoComplete="new-password" value={p1} onChange={(e) => setP1(e.target.value)} /></div>
      <div className="field"><label htmlFor="p2">Повторите пароль</label><input id="p2" type="password" autoComplete="new-password" value={p2} onChange={(e) => setP2(e.target.value)} /></div>
      {error ? <p className="error-text" role="alert">{error}</p> : null}
      <button className="btn" type="submit" disabled={busy} style={{ width: '100%' }}>{busy ? 'Сохраняю…' : 'Сохранить и продолжить'}</button>
    </form>
  );
}
