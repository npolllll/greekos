import Link from 'next/link';

export const metadata = { title: 'Регистрация' };

/** GreekOS is private: there is no self-registration. Old links land here and get a clear answer. */
export default function RegisterPage() {
  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <div className="brand" style={{ margin: 0 }}>Greek<span className="os">OS</span><i className="brand-mark" /></div>
        <h1>Регистрация закрыта</h1>
        <p>GreekOS — частный курс. Доступ выдаёт владелец курса: он создаст аккаунт и передаст вам одноразовую ссылку, по которой вы зададите пароль.</p>
        <p className="small mt16">Уже есть аккаунт? <Link className="text-link" href="/login">Войти</Link></p>
      </div>
    </div>
  );
}
