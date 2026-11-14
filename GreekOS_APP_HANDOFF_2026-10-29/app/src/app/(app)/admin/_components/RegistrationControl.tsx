'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** Owner: learner seats. Access is closed: only the owner adds learners (one-time link, no e-mail needed). */
export function RegistrationControl(props: { maxLearners: number; seatsUsed: number }) {
  const router = useRouter();
  const [max, setMax] = useState(props.maxLearners);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save() {
    setBusy(true); setMsg(null);
    const r = await fetch('/api/admin/registration', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ max_learners: max }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setMsg(j.message ?? 'Не удалось сохранить.'); return; }
    setMsg('Сохранено.');
    router.refresh();
  }

  return (
    <div className="card cardpad">
      <div className="card-top"><div className="card-title">Доступ учеников</div><span className="tag">{props.seatsUsed} из {props.maxLearners} мест занято</span></div>
      <p className="small quiet">Регистрация закрыта: аккаунт ученику создаёте только вы — кнопка «Добавить ученика». Система покажет одноразовую ссылку: передайте её ученику в любом мессенджере, по ней он задаст свой пароль. Почта не нужна. Забытый пароль — «Новая ссылка» в карточке ученика. Отключённые ученики место не занимают.</p>
      <div className="reg-grid">
        <div className="field"><label htmlFor="reg-max">Мест для учеников</label>
          <input id="reg-max" type="number" min={Math.max(1, props.seatsUsed)} max={100} value={max} onChange={(e) => setMax(Number(e.target.value))} />
        </div>
      </div>
      <div className="row">
        <button className="btn" type="button" disabled={busy || max === props.maxLearners} onClick={save}>{busy ? 'Сохраняю…' : 'Сохранить'}</button>
      </div>
      {msg ? <p className="small mt8" role="status">{msg}</p> : null}
    </div>
  );
}
