import { requireOwnerPage } from '@/lib/auth';
import { AdminTabs } from './_components/AdminTabs';
import './admin.css';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireOwnerPage();
  return (
    <section className="screen active">
      <div className="screen-head">
        <div>
          <div className="eyebrow">GreekOS / Админ-панель</div>
          <h1 className="screen-title">Админ-панель</h1>
          <p className="screen-sub">Режим владельца · ученики, качество материалов, выпуск и доступ. Все показатели — из базы данных.</p>
        </div>
      </div>
      <AdminTabs />
      {children}
    </section>
  );
}
