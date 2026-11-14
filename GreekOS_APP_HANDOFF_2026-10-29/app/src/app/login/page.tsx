import { LoginForm } from './LoginForm';

export const metadata = { title: 'Вход' };
export const dynamic = 'force-dynamic';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const sp = await searchParams;
  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <div className="brand" style={{ margin: 0 }}>Greek<span className="os">OS</span><i className="brand-mark" /></div>
        <h1>Вход</h1>
        <p>Личный курс новогреческого A0–B2. Доступ выдаёт владелец курса.</p>
        {sp.error === 'link' ? <div className="banner warn mt16">Ссылка недействительна или уже использована. Попросите владельца курса выдать новую ссылку.</div> : null}
        <LoginForm />
      </div>
    </div>
  );
}
