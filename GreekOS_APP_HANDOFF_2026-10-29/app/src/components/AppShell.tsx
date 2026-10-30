'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { LayoutGroup, MotionConfig, motion } from 'motion/react';
import { Icon } from './Icon';
import { BrandMark } from './BrandMark';
import { useLive } from './LiveProvider';
import { browserClient } from '@/lib/supabase/browser';
import { ActivityTracker } from './ActivityTracker';

const LEARN = [
  { href: '/', label: 'Главная', icon: 'home', mobile: 'Главная' },
  { href: '/course', label: 'Мой маршрут', icon: 'book', mobile: 'Курс' },
  { href: '/alphabet', label: 'Алфавит и звуки', icon: 'alpha' },
  { href: '/practice', label: 'Практика', icon: 'layers' },
  { href: '/speaking', label: 'AI-разговор', icon: 'mic', mobile: 'Разговор' },
  { href: '/real-greek', label: 'Живой греческий', icon: 'heart', mobile: 'Живой' },
  { href: '/listening', label: 'Аудирование', icon: 'headphones' },
  { href: '/writing', label: 'Письмо', icon: 'pen' },
  { href: '/errors', label: 'Мои ошибки', icon: 'rotate' },
  { href: '/exams', label: 'Экзамен ΚΕΓ B2', icon: 'school' },
  { href: '/pegp', label: 'ΠΕΓΠ', icon: 'flag' },
  { href: '/progress', label: 'Мой прогресс', icon: 'chart' },
  { href: '/diagnostic', label: 'Определение уровня', icon: 'spark' },
];
const MANAGE = [{ href: '/admin', label: 'Админ-панель', icon: 'users' }];
const MOBILE = ['/', '/course', '/speaking', '/real-greek'];
// Long reading/exam surfaces push the scene back so the task has the focus.
const FOCUS_ROUTES = [/^\/lesson\//, /^\/exams\/[^/]+/, /^\/practice\//, /^\/diagnostic/, /^\/pegp\/[^/]+/, /^\/writing/];

function isActive(path: string, href: string) {
  return href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`);
}

export function AppShell(props: {
  children: React.ReactNode;
  name: string;
  meta: string;
  isOwner: boolean;
  learnerCount: number | null;
  envLabel: string | null;
  reducedMotion: boolean;
  devPreview: boolean;
  tester: boolean;
}) {
  const path = usePathname();
  const router = useRouter();
  const live = useLive();
  const [menuAt, setMenuAt] = useState<string | null>(null);
  const [moreAt, setMoreAt] = useState<string | null>(null);
  const menu = menuAt === path;
  const more = moreAt === path;
  const setMenu = (v: boolean | ((m: boolean) => boolean)) => setMenuAt((cur) => ((typeof v === 'function' ? v(cur === path) : v) ? path : null));
  const setMore = (v: boolean) => setMoreAt(v ? path : null);
  const [motionOff, setMotionOff] = useState(props.reducedMotion);
  const menuRef = useRef<HTMLDivElement>(null);
  const initials = (props.name.match(/\p{L}+/gu) ?? ['?']).map((p) => p[0]).join('').slice(0, 2).toUpperCase();
  const focus = FOCUS_ROUTES.some((r) => r.test(path));

  useEffect(() => {
    document.body.classList.toggle('no-motion', motionOff);
  }, [motionOff]);
  useEffect(() => {
    document.body.classList.toggle('mode-focus', focus);
    return () => document.body.classList.remove('mode-focus');
  }, [focus]);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuAt(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setMenuAt(null); setMoreAt(null); } };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, []);

  async function toggleMotion() {
    const next = !motionOff;
    setMotionOff(next);
    await fetch('/api/me/preferences', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reduced_motion: next }) }).catch(() => undefined);
  }
  async function signOut() {
    await browserClient().auth.signOut();
    router.replace('/login');
    router.refresh();
  }

  const nav = (items: typeof LEARN, group: string) => items.map((i) => {
    const active = isActive(path, i.href);
    return (
      // On narrow layouts the text label is hidden (icon rail), so the name is also given explicitly.
      <Link key={i.href} href={i.href} className={`navbtn ${active ? 'active' : ''}`} aria-current={active ? 'page' : undefined} aria-label={i.href === '/admin' && props.learnerCount !== null ? `${i.label} (учеников: ${props.learnerCount})` : i.label} title={i.label}>
        {active ? <motion.span layoutId={`nav-active-${group}`} className="nav-active" transition={{ type: 'spring', stiffness: 520, damping: 42, mass: 0.9 }} /> : null}
        <Icon name={i.icon} />
        <span>{i.label}</span>
        {i.href === '/admin' && props.learnerCount !== null ? <span className="count">{props.learnerCount}</span> : null}
      </Link>
    );
  });

  const liveLabel = live.status === 'live' ? 'Синхронизировано' : live.status === 'reconnecting' ? 'Переподключение…' : live.status === 'offline' ? 'Нет сети' : 'Подключение…';

  return (
    <MotionConfig reducedMotion={motionOff ? 'always' : 'user'}>
      <div className="viewport">
        <a className="skip-link" href="#main">Перейти к содержанию</a>
        <ActivityTracker />
        <div className="studio-bar">
          <span>
            <span className={`status-live ${live.status === 'offline' ? 'offline' : live.status === 'reconnecting' ? 'reconnecting' : ''}`} role="status" aria-live="polite">
              <span className="dot" /> <b>GreekOS</b> · {liveLabel}
            </span>
            {props.envLabel ? <span className="env">· {props.envLabel}</span> : null}
            {props.devPreview ? <span className="mode-badge preview" title="Непроверенные материалы открыты только этому тестовому аккаунту и только в локальной среде">DEV-PREVIEW · материалы не выпущены</span> : null}
          </span>
          <span className="studio-right">
            <button className="studio-btn" type="button" onClick={toggleMotion} aria-pressed={motionOff}>{motionOff ? 'Включить анимации' : 'Отключить анимации'}</button>
          </span>
        </div>
        <div className="shell">
          <aside className="rail" aria-label="Боковая панель" style={{ viewTransitionName: 'app-rail' }}>
            <Link href="/" className="brand" aria-label="GreekOS — на главную"><span className="brand-mark"><BrandMark /></span>Greek<span className="os">OS</span></Link>
            <p className="nav-title">Обучение</p>
            <LayoutGroup id="rail">
              <nav className="navitems" aria-label="Основная навигация">{nav(LEARN, 'learn')}</nav>
              {props.isOwner ? (
                <>
                  <div className="navsep" />
                  <p className="nav-title">Управление</p>
                  <nav className="navitems" aria-label="Управление">{nav(MANAGE, 'manage')}</nav>
                </>
              ) : null}
            </LayoutGroup>
            <div className="rail-bottom">
              <div className="rail-art" aria-hidden="true"><span>Больше, чем язык.<br />Ближе к Греции.</span></div>
              <div className="rail-profile">
                <div className="avatar">{initials}</div>
                <div><strong>{props.name}</strong><span>{props.meta}</span></div>
              </div>
            </div>
          </aside>
          <div className="workspace">
            <header className="topbar" style={{ viewTransitionName: 'app-topbar' }}>
              <form className="search" role="search" action="/search">
                <Icon name="search" />
                <input name="q" aria-label="Поиск" autoComplete="off" placeholder="Поиск по урокам, словам, темам…" />
                <span className="kbd">Enter</span>
              </form>
              <div className="top-actions">
                <Link className="icon-btn no-mobile" href="/settings" aria-label="Настройки и приватность" title="Настройки и приватность"><Icon name="settings" /></Link>
                <Link className={`icon-btn ${live.unseen > 0 ? 'notification' : ''}`} href="/progress#events" aria-label={`События обучения${live.unseen ? `: ${live.unseen} новых` : ''}`}><Icon name="bell" /></Link>
                <div style={{ position: 'relative' }} ref={menuRef}>
                  <button className="profile-button" type="button" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
                    <div className="avatar">{initials}</div>
                    <div><div className="profile-name">{props.name}</div><div className="profile-meta">{props.meta}{props.tester ? ' · тестовый' : ''}</div></div>
                    <Icon name="chevron-down" />
                  </button>
                  {menu ? (
                    <div className="profile-menu" role="menu">
                      <Link role="menuitem" href="/settings">Настройки и приватность</Link>
                      <Link role="menuitem" href="/progress">Мой прогресс</Link>
                      <button role="menuitem" type="button" onClick={signOut}>Выйти</button>
                    </div>
                  ) : null}
                </div>
              </div>
            </header>
            <main className="content" id="main" tabIndex={-1}>{props.children}</main>
          </div>
        </div>
        <nav className="mobilebar" aria-label="Мобильная навигация" style={{ viewTransitionName: 'app-mobilebar' }}>
          <LayoutGroup id="mobile">
            {LEARN.filter((i) => MOBILE.includes(i.href)).map((i) => {
              const active = isActive(path, i.href);
              return (
                <Link key={i.href} href={i.href} className={`mobile-nav ${active ? 'active' : ''}`} aria-current={active ? 'page' : undefined}>
                  {active ? <motion.span layoutId="mob-active" className="mob-pill" transition={{ type: 'spring', stiffness: 520, damping: 40 }} /> : null}
                  <Icon name={i.icon} /><span>{i.mobile}</span>
                </Link>
              );
            })}
            <button type="button" className={`mobile-nav more ${!MOBILE.some((h) => isActive(path, h)) ? 'active' : ''}`} onClick={() => setMore(true)} aria-haspopup="dialog">
              {!MOBILE.some((h) => isActive(path, h)) ? <motion.span layoutId="mob-active" className="mob-pill" /> : null}
              <Icon name="menu" /><span>Ещё</span>
            </button>
          </LayoutGroup>
        </nav>
        {more ? (
          <>
            <div className="overlay show" onClick={() => setMore(false)} />
            <div className="more-sheet" role="dialog" aria-modal="true" aria-label="Все разделы">
              <div className="row between" style={{ marginBottom: 12 }}>
                <b>Все разделы</b>
                <button className="close" type="button" onClick={() => setMore(false)} aria-label="Закрыть"><Icon name="close" /></button>
              </div>
              <nav className="navitems">{nav([...LEARN, ...(props.isOwner ? MANAGE : []), { href: '/settings', label: 'Настройки', icon: 'settings', mobile: 'Настройки' }], 'sheet')}</nav>
            </div>
          </>
        ) : null}
        {live.status === 'offline' ? <div className="offline-bar" role="status">Нет соединения. Подтверждённые ответы сохранены на сервере; новые данные синхронизируются после восстановления.</div> : null}
      </div>
    </MotionConfig>
  );
}
