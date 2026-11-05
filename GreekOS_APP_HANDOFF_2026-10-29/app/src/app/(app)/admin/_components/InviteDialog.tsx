'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CopyBox } from './CopyBox';

const PATHS = [
  { id: 'from_zero', title: 'С полного нуля', text: 'Не знает букв и произношения: старт с алфавита и звуков. Уровень ещё не измерен.' },
  { id: 'prior_learning', title: 'Уже изучал(а) греческий', text: 'Обязательная многонавыковая диагностика до назначения маршрута.' },
  { id: 'unsure', title: 'Не уверен(а)', text: 'Диагностика поможет выбрать точку входа.' },
] as const;

/** Invite flow (DESIGN/V5_1 03): details → explicit confirmation → send e-mail or show a one-time link. */
export function InviteDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<'form' | 'confirm' | 'done'>('form');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [path, setPath] = useState<string>('from_zero');
  const [delivery, setDelivery] = useState<'email' | 'link'>('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);

  function reset() {
    setStep('form'); setName(''); setEmail(''); setPath('from_zero'); setDelivery('email'); setError(null); setLink(null);
  }

  function next() {
    setError(null);
    if (!name.trim()) return setError('Укажите имя.');
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError('Укажите корректный e-mail.');
    setStep('confirm');
  }

  async function send() {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/admin/invite', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: email.trim(), display_name: name.trim(), entry_path: path, delivery, confirmed: true }) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(json.message ?? 'Приглашение не создано');
    setLink(json.link ?? null);
    setStep('done');
    router.refresh();
  }

  return (
    <>
      <button type="button" className="btn" onClick={() => { reset(); setOpen(true); }}>Добавить ученика</button>
      {open ? (
        <>
          <div className="overlay show" onClick={() => setOpen(false)} />
          <section className="modal show modal-wide wizard" role="dialog" aria-modal="true" aria-label="Добавить ученика">
            <div className="row between"><b>Добавить ученика</b><button type="button" className="close" onClick={() => setOpen(false)} aria-label="Закрыть">×</button></div>
            {step === 'form' ? (
              <div className="mt16">
                <div className="field"><label htmlFor="inv-name">Имя</label><input id="inv-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} autoComplete="off" /></div>
                <div className="field"><label htmlFor="inv-email">E-mail</label><input id="inv-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" /></div>
                <p className="form-label">Опыт (самоотчёт, не уровень CEFR)</p>
                <div className="entry-options" role="radiogroup">
                  {PATHS.map((p) => (
                    <label key={p.id} className="entry-option"><input type="radio" name="entry" checked={path === p.id} onChange={() => setPath(p.id)} /><span><b>{p.title}</b><small>{p.text}</small></span></label>
                  ))}
                </div>
                <p className="form-label">Способ приглашения</p>
                <div className="entry-options" role="radiogroup">
                  <label className="entry-option"><input type="radio" name="delivery" checked={delivery === 'email'} onChange={() => setDelivery('email')} /><span><b>Отправить письмо</b><small>Через Supabase Auth (нужен настроенный SMTP в production).</small></span></label>
                  <label className="entry-option"><input type="radio" name="delivery" checked={delivery === 'link'} onChange={() => setDelivery('link')} /><span><b>Ссылка для ручной передачи</b><small>Письмо не отправляется; одноразовая ссылка будет показана один раз.</small></span></label>
                </div>
                {error ? <p className="error-text" role="alert">{error}</p> : null}
                <div className="row mt16"><button type="button" className="btn" onClick={next}>Далее</button><button type="button" className="btn outline" onClick={() => setOpen(false)}>Отмена</button></div>
              </div>
            ) : step === 'confirm' ? (
              <div className="mt16">
                <dl className="kv"><dt>Имя</dt><dd>{name}</dd><dt>E-mail</dt><dd>{email}</dd><dt>Старт</dt><dd>{PATHS.find((p) => p.id === path)?.title}</dd><dt>Доставка</dt><dd>{delivery === 'email' ? 'Письмо со ссылкой' : 'Одноразовая ссылка в этом окне'}</dd></dl>
                <div className="warning-note">Будет создан отдельный аккаунт с собственным прогрессом. Ссылка одноразовая и ограничена по времени. Владелец видит учебные сводки ученика; сырые записи голоса и полные транскрипты закрыты без отдельного согласия.</div>
                {error ? <p className="error-text" role="alert">{error}</p> : null}
                <div className="row"><button type="button" className="btn" disabled={busy} onClick={send}>{busy ? 'Создаю…' : delivery === 'email' ? 'Подтвердить и отправить' : 'Подтвердить и создать ссылку'}</button><button type="button" className="btn outline" onClick={() => setStep('form')}>Назад</button></div>
              </div>
            ) : (
              <div className="mt16">
                <div className="banner ok"><span>Профиль <b>{name}</b> создан со статусом «Приглашён».{delivery === 'email' ? ' Письмо отправлено.' : ''}</span></div>
                {link ? <CopyBox value={link} label="Ссылка приглашения" /> : null}
                <button type="button" className="btn outline mt16" onClick={() => setOpen(false)}>Готово</button>
              </div>
            )}
          </section>
        </>
      ) : null}
    </>
  );
}
