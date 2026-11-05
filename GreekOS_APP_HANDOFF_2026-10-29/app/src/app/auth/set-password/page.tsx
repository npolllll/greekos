import { redirect } from 'next/navigation';
import { serverClient } from '@/lib/supabase/server';
import { SetPasswordForm } from './SetPasswordForm';

export const metadata = { title: 'Пароль' };

export default async function SetPasswordPage() {
  const supabase = await serverClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect('/login?error=link');
  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <div className="brand" style={{ margin: 0 }}>Greek<span className="os">OS</span><i className="brand-mark" /></div>
        <h1>Задайте пароль</h1>
        <p>Для входа в GreekOS с любого устройства. Минимум 10 символов.</p>
        <SetPasswordForm email={data.user.email ?? ''} />
      </div>
    </div>
  );
}
