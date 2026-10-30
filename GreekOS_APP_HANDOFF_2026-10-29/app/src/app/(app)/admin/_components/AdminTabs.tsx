'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/admin', label: 'Обзор' },
  { href: '/admin/learners', label: 'Ученики' },
  { href: '/admin/qa', label: 'Цифровой QA' },
  { href: '/admin/qa/release', label: 'Выпуск' },
  { href: '/admin/content', label: 'Контент' },
  { href: '/admin/reviews', label: 'Проверка ответов' },
  { href: '/admin/audio', label: 'Аудио' },
  { href: '/admin/voices', label: 'Голоса и кастинг' },
  { href: '/admin/exams', label: 'Экзамены' },
  { href: '/admin/preview', label: 'DEV-PREVIEW' },
  { href: '/admin/consents', label: 'Согласия и аудит' },
  { href: '/admin/providers', label: 'Провайдеры' },
  { href: '/admin/policy', label: 'Политика выпуска' },
];

export function AdminTabs() {
  const path = usePathname();
  // Longest matching tab wins (/admin/qa/release must not also light up /admin/qa).
  const best = TABS.filter((t) => (t.href === '/admin' ? path === '/admin' : path === t.href || path.startsWith(`${t.href}/`))).sort((a, b) => b.href.length - a.href.length)[0]?.href;
  const active = (href: string) => href === best;
  return (
    <nav className="admin-tabs" aria-label="Разделы админ-панели">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} className={`chip ${active(t.href) ? 'active' : ''}`} aria-current={active(t.href) ? 'page' : undefined}>{t.label}</Link>
      ))}
    </nav>
  );
}
