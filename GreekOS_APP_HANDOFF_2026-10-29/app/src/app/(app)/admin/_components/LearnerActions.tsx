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
