'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ActionButton } from './ActionButton';
import { CopyBox } from './CopyBox';

export function LearnerActions({ userId, active, name }: { userId: string; active: boolean; name: string }) {
  const router = useRouter();
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);

  async function newLink() {
    setError(null);
    const res = await fetch(`/api/admin/learners/${userId}/link`, { method: 'POST' });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return setError(j.message ?? 'Ссылка не создана');
    setLink(j.link);
  }

  async function remove() {
    setError(null);
    setDeleting(true);
    const res = await fetch(`/api/admin/learners/${userId}/delete`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm }) });
    const j = await res.json().catch(() => ({}));
    setDeleting(false);
    if (!res.ok) return setError(j.message ?? 'Удаление не выполнено');
    router.replace('/admin/learners');
    router.refresh();
  }

  return (
    <div className="mt16">
      <div className="row">
        {active ? (
          <ActionButton url={`/api/admin/learners/${userId}/deactivate`} label="Деактивировать" promptReason={`Причина деактивации (${name}): вход и API будут заблокированы, сессии отозваны.`} successText="Доступ отключён" />
        ) : (
          <ActionButton url={`/api/admin/learners/${userId}/reactivate`} label="Восстановить доступ" confirmText={`Восстановить доступ для ${name}?`} successText="Доступ восстановлен" />
        )}
        {active ? <button type="button" className="btn outline" onClick={newLink}>Новая ссылка для входа</button> : null}
        <a className="btn outline" href={`/api/admin/learners/${userId}/export`}>Экспорт данных (JSON)</a>
      </div>
      {link ? <CopyBox value={link} label="Ссылка для входа" /> : null}
      <details className="box mt16">
        <summary>Удалить аккаунт и все учебные данные</summary>
        <p className="small quiet">Необратимо: профиль, попытки, оценки, расписание D7/D28, разговоры и сохранённые голосовые файлы будут удалены. Перед удалением можно сделать экспорт. Запись в журнале аудита сохранится без содержимого.</p>
        <div className="field"><label htmlFor="del-confirm">Введите УДАЛИТЬ</label><input id="del-confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" /></div>
        <button type="button" className="btn dark" disabled={confirm !== 'УДАЛИТЬ' || deleting} onClick={remove}>{deleting ? 'Удаляю…' : 'Удалить навсегда'}</button>
      </details>
      {error ? <p className="error-text" role="alert">{error}</p> : null}
    </div>
  );
}

/** Co-owner role: granting needs the account's e-mail typed back; removing never leaves the app without an owner. */
export function RoleControl({ userId, isOwner, email }: { userId: string; isOwner: boolean; email: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true); setError(null);
    const res = await fetch(`/api/admin/learners/${userId}/role`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ grant: !isOwner, confirm_email: isOwner ? undefined : confirmEmail, reason }) });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(j.message ?? 'Не сохранено');
    setOpen(false);
    router.refresh();
  }
  return (
    <div className="box mt16">
      <div className="row between"><span className="small">Роль: <b>{isOwner ? 'владелец (совладелец)' : 'ученик'}</b></span>{!open ? <button type="button" className="btn small outline" onClick={() => setOpen(true)}>{isOwner ? 'Снять роль владельца' : 'Сделать совладельцем'}</button> : null}</div>
      {open ? (
        <div className="inline-form mt8">
          {!isOwner ? <p className="tiny quiet" style={{ margin: 0 }}>Совладелец видит всех учеников, корпус, аудио и может принимать решения о выпуске. Сессии аккаунта будут сброшены.</p> : null}
          {!isOwner ? <div className="field"><label htmlFor={`role-email-${userId}`}>Введите e-mail аккаунта{email ? ` (${email})` : ''}</label><input id={`role-email-${userId}`} value={confirmEmail} onChange={(e) => setConfirmEmail(e.target.value)} autoComplete="off" /></div> : null}
          <div className="field"><label htmlFor={`role-reason-${userId}`}>Причина</label><input id={`role-reason-${userId}`} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
          <div className="row"><button type="button" className="btn" disabled={busy || reason.trim().length < 3} onClick={save}>{busy ? 'Сохраняю…' : 'Подтвердить'}</button><button type="button" className="btn outline" onClick={() => setOpen(false)}>Отмена</button></div>
        </div>
      ) : null}
      {error ? <p className="error-text" role="alert">{error}</p> : null}
    </div>
  );
}
