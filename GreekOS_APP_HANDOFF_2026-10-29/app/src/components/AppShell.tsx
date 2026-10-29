'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { useLive } from './LiveProvider';
import { browserClient } from '@/lib/supabase/browser';
import { ActivityTracker } from './ActivityTracker';

const LEARN = [
  { href: '/', label: 'Главная', icon: 'home', mobile: 'Главная' },
  { href: '/course', label: 'Мой курс', icon: 'book', mobile: 'Курс' },
  { href: '/practice', label: 'Практика', icon: 'layers' },
  { href: '/real-greek', label: 'Живой греческий', icon: 'heart', mobile: 'Живой' },
  { href: '/speaking', label: 'Разговоры', icon: 'mic', mobile: 'Разговор' },
  { href: '/listening', label: 'Аудирование', icon: 'headphones' },
  { href: '/writing', label: 'Письмо', icon: 'pen' },
  { href: '/errors', label: 'Мои ошибки', icon: 'rotate' },
  { href: '/exams', label: 'Экзамены ΚΕΓ', icon: 'school' },
  { href: '/pegp', label: 'ΠΕΓΠ', icon: 'flag' },
  { href: '/progress', label: 'Прогресс', icon: 'chart' },
  { href: '/diagnostic', label: 'Определение уровня', icon: 'spark' },
];
const MANAGE = [{ href: '/admin', label: 'Админ-панель', icon: 'users' }];
const MOBILE = ['/', '/course', '/real-greek', '/speaking'];

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
}) {
  const path = usePathname();
  const router = useRouter();
  const live = useLive();
  // Menus are tied to the path they were opened on, so navigation closes them without an effect.
  const [menuAt, setMenuAt] = useState<string | null>(null);
  const [moreAt, setMoreAt] = useState<string | null>(null);
  const menu = menuAt === path;
  const more = moreAt === path;
  const setMenu = (v: boolean | ((m: boolean) => boolean)) => setMenuAt((cur) => ((typeof v === 'function' ? v(cur === path) : v) ? path : null));
  const setMore = (v: boolean) => setMoreAt(v ? path : null);
  const [motionOff, setMotionOff] = useState(props.reducedMotion);
  const menuRef = useRef<HTMLDivElement>(null);
  const initials = (props.name.match(/\p{L}+/gu) ?? ['?']).map((p) => p[0]).join('').slice(0, 2).toUpperCase();

  useEffect(() => {
    document.body.classList.toggle('no-motion', motionOff);
  }, [motionOff]);
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

  const nav = (items: typeof LEARN) => items.map((i) => (
    // On narrow layouts the text label is hidden (icon rail), so the name is also given explicitly.
    <Link key={i.href} href={i.href} className={`navbtn ${isActive(path, i.href) ? 'active' : ''}`} aria-current={isActive(path, i.href) ? 'page' : undefined} aria-label={i.href === '/admin' && props.learnerCount !== null ? `${i.label} (учеников: ${props.learnerCount})` : i.label} title={i.label}>
      <Icon name={i.icon} />
      <span>{i.label}</span>
      {i.href === '/admin' && props.learnerCount !== null ? <span className="count">{props.learnerCount}</span> : null}
    </Link>
  ));

  const liveLabel = live.status === 'live' ? 'Синхронизировано' : live.status === 'reconnecting' ? 'Переподключение…' : live.status === 'offline' ? 'Нет сети' : 'Подключение…';

  return (
    <div className="viewport">
      <a className="skip-link" href="#main">Перейти к содержанию</a>
      <ActivityTracker />
      <div className="studio-bar">
        <span>
          <span className={`status-live ${live.status === 'offline' ? 'offline' : live.status === 'reconnecting' ? 'reconnecting' : ''}`} role="status" aria-live="polite">
            <span className="dot" /> <b>GreekOS</b> · {liveLabel}
          </span>
          {props.envLabel ? <span className="env">· {props.envLabel}</span> : null}
        </span>
        <span className="studio-right">
          <button className="studio-btn" type="button" onClick={toggleMotion} aria-pressed={motionOff}>{motionOff ? 'Включить анимации' : 'Отключить анимации'}</button>
        </span>
      </div>
      <div className="shell">
        <aside className="rail" aria-label="Боковая панель">
          <Link href="/" className="brand" aria-label="GreekOS — на главную">Greek<span className="os">OS</span><i className="brand-mark" /></Link>
          <p className="nav-title">Обучение</p>
          <nav className="navitems" aria-label="Основная навигация">{nav(LEARN)}</nav>
          {props.isOwner ? (
            <>
              <div className="navsep" />
              <p className="nav-title">Управление</p>
              <nav className="navitems" aria-label="Управление">{nav(MANAGE)}</nav>
            </>
          ) : null}
          <div className="rail-bottom">
            <div className="rail-art" aria-hidden="true"><span>Изучай язык.<br />Понимай культуру.</span></div>
            <div className="rail-profile">
              <div className="avatar">{initials}</div>
              <div><strong>{props.name}</strong><span>{props.meta}</span></div>
            </div>
          </div>
        </aside>
        <div className="workspace">
          <header className="topbar">
            <form className="search" role="search" action="/search">
              <Icon name="search" />
              <input name="q" aria-label="Поиск" autoComplete="off" placeholder="Найти урок, выражение или раздел…" />
              <span className="kbd">Enter</span>
            </form>
            <div className="top-actions">
              <Link className="icon-btn no-mobile" href="/settings" aria-label="Настройки и приватность" title="Настройки и приватность"><Icon name="settings" /></Link>
              <Link className={`icon-btn ${live.unseen > 0 ? 'notification' : ''}`} href="/progress#events" aria-label={`События обучения${live.unseen ? `: ${live.unseen} новых` : ''}`}><Icon name="bell" /></Link>
              <div style={{ position: 'relative' }} ref={menuRef}>
                <button className="profile-button" type="button" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
                  <div className="avatar">{initials}</div>
                  <div><div className="profile-name">{props.name}</div><div className="profile-meta">{props.meta}</div></div>
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
      <nav className="mobilebar" aria-label="Мобильная навигация">
        {LEARN.filter((i) => MOBILE.includes(i.href)).map((i) => (
          <Link key={i.href} href={i.href} className={`mobile-nav ${isActive(path, i.href) ? 'active' : ''}`} aria-current={isActive(path, i.href) ? 'page' : undefined}>
            <Icon name={i.icon} /><span>{i.mobile}</span>
          </Link>
        ))}
        <button type="button" className={`mobile-nav more ${!MOBILE.some((h) => isActive(path, h)) ? 'active' : ''}`} onClick={() => setMore(true)} aria-haspopup="dialog">
          <Icon name="menu" /><span>Ещё</span>
        </button>
      </nav>
      {more ? (
        <>
          <div className="overlay show" onClick={() => setMore(false)} />
          <div className="more-sheet" role="dialog" aria-modal="true" aria-label="Все разделы">
            <div className="row between" style={{ marginBottom: 12 }}>
              <b>Все разделы</b>
              <button className="close" type="button" onClick={() => setMore(false)} aria-label="Закрыть"><Icon name="close" /></button>
            </div>
            <nav className="navitems">{nav([...LEARN, ...(props.isOwner ? MANAGE : []), { href: '/settings', label: 'Настройки', icon: 'settings' }])}</nav>
          </div>
        </>
      ) : null}
      {live.status === 'offline' ? <div className="offline-bar" role="status">Нет соединения. Подтверждённые ответы сохранены на сервере; новые данные синхронизируются после восстановления.</div> : null}
    </div>
  );
}
