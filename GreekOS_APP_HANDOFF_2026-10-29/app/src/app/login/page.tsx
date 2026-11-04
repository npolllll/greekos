import Link from 'next/link';
import { LoginForm } from './LoginForm';
import { registrationSettings } from '@/lib/registration';

export const metadata = { title: 'Вход' };
export const dynamic = 'force-dynamic';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const sp = await searchParams;
  const reg = await registrationSettings().catch(() => null);
  const canRegister = !!reg && reg.registration_mode !== 'closed' && reg.seats_free > 0;
  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <div className="brand" style={{ margin: 0 }}>Greek<span className="os">OS</span><i className="brand-mark" /></div>
        <h1>Вход</h1>
        <p>{canRegister ? 'Личный курс новогреческого A0–B2.' : 'Доступ по приглашению владельца курса.'}</p>
        {sp.error === 'link' ? <div className="banner warn mt16">Ссылка недействительна или уже использована. Попросите владельца отправить новое приглашение.</div> : null}
        <LoginForm />
        {canRegister ? <p className="small mt16">Нет аккаунта? <Link className="text-link" href="/register">Зарегистрироваться</Link></p> : null}
      </div>
    </div>
  );
}
