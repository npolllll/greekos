import Link from 'next/link';
import { registrationSettings } from '@/lib/registration';
import { RegisterForm } from './RegisterForm';

export const metadata = { title: 'Регистрация' };
export const dynamic = 'force-dynamic';

export default async function RegisterPage() {
  const s = await registrationSettings();
  const open = s.registration_mode !== 'closed' && s.seats_free > 0;
  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <div className="brand" style={{ margin: 0 }}>Greek<span className="os">OS</span><i className="brand-mark" /></div>
        <h1>Регистрация</h1>
        {open ? (
          <>
            <p>Личный курс новогреческого: с нуля — от алфавита, с опытом — после короткой диагностики. Мы пришлём письмо, чтобы подтвердить e-mail; пароль вы зададите по ссылке.</p>
            <RegisterForm needsCode={s.registration_mode === 'code'} />
          </>
        ) : (
          <div className="banner warn mt16"><span>{s.registration_mode === 'closed' ? 'Регистрация сейчас закрыта: доступ — по приглашению владельца курса.' : 'Свободных мест в группе сейчас нет. Напишите владельцу курса.'}</span></div>
        )}
        <p className="small mt16">Уже есть аккаунт? <Link className="text-link" href="/login">Войти</Link></p>
      </div>
    </div>
  );
}
