'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/admin', label: 'Обзор' },
  { href: '/admin/learners', label: 'Ученики' },
  { href: '/admin/content', label: 'Контент и QA' },
  { href: '/admin/reviews', label: 'Проверка ответов' },
  { href: '/admin/audio', label: 'Аудио' },
  { href: '/admin/voices', label: 'Голоса и кастинг' },
  { href: '/admin/exams', label: 'Экзамены' },
  { href: '/admin/consents', label: 'Согласия и аудит' },
  { href: '/admin/providers', label: 'Провайдеры' },
  { href: '/admin/policy', label: 'Политика выпуска' },
];

export function AdminTabs() {
  const path = usePathname();
  const active = (href: string) => (href === '/admin' ? path === '/admin' : path === href || path.startsWith(`${href}/`));
  return (
    <nav className="admin-tabs" aria-label="Разделы админ-панели">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} className={`chip ${active(t.href) ? 'active' : ''}`} aria-current={active(t.href) ? 'page' : undefined}>{t.label}</Link>
      ))}
    </nav>
  );
}
