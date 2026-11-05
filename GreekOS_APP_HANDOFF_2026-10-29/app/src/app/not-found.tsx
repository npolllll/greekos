import Link from 'next/link';

export const metadata = { title: 'Страница не найдена' };

/** Any unknown address: a quiet page in the same glass system, never the framework's English 404. */
export default function NotFound() {
  return (
    <main className="standalone">
      <div className="card cardpad standalone-card">
        <div className="eyebrow">GreekOS · 404</div>
        <h1 className="screen-title">Страница не найдена</h1>
        <p className="screen-sub">Такого адреса нет — возможно, ссылка устарела или в ней опечатка. <span lang="el" className="greek-serif">Δεν βρέθηκε.</span></p>
        <div className="row mt16"><Link className="btn" href="/">На главную</Link><Link className="btn outline" href="/course">Мой маршрут</Link></div>
      </div>
    </main>
  );
}
