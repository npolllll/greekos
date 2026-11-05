'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { browserClient } from '@/lib/supabase/browser';

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'password' | 'reset'>('password');
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = browserClient();
    if (mode === 'reset') {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/auth/set-password` });
      setBusy(false);
      if (error) setError('Не удалось отправить письмо. Попробуйте позже.');
      else setSent(true);
      return;
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setBusy(false);
      setError('Неверный e-mail или пароль, либо доступ отключён.');
      return;
    }
    router.replace('/');
    router.refresh();
  }

  if (sent) return <div className="banner ok mt16">Если такой аккаунт существует, мы отправили письмо со ссылкой для нового пароля.</div>;

  return (
    <form onSubmit={submit} noValidate>
      <div className="field">
        <label htmlFor="email">E-mail</label>
        <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      {mode === 'password' ? (
        <div className="field">
          <label htmlFor="password">Пароль</label>
          <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
      ) : null}
      {error ? <p className="error-text" role="alert">{error}</p> : null}
      <button className="btn" type="submit" disabled={busy} style={{ width: '100%', marginTop: 6 }}>{busy ? 'Подождите…' : mode === 'password' ? 'Войти' : 'Отправить ссылку'}</button>
      <button type="button" className="text-link mt16" onClick={() => { setMode(mode === 'password' ? 'reset' : 'password'); setError(null); }}>
        {mode === 'password' ? 'Забыли пароль?' : 'Вернуться ко входу'}
      </button>
    </form>
  );
}
