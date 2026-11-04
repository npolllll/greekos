'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Mode = 'closed' | 'code' | 'open';
const MODE_RU: Record<Mode, string> = { closed: 'Закрыта (только приглашения)', code: 'По коду регистрации', open: 'Открыта для всех' };

/** Owner: who may register themselves and how many learner seats the group has. */
export function RegistrationControl(props: { mode: Mode; maxLearners: number; seatsUsed: number; hasCode: boolean; appUrl: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(props.mode);
  const [max, setMax] = useState(props.maxLearners);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);

  async function save(newCode = false) {
    setBusy(true); setMsg(null);
    const r = await fetch('/api/admin/registration', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ registration_mode: mode, max_learners: max, new_code: newCode }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setMsg(j.message ?? 'Не удалось сохранить.'); return; }
    if (j.code) setCode(j.code);
    setMsg('Сохранено.');
    router.refresh();
  }

  return (
    <div className="card cardpad">
      <div className="card-top"><div className="card-title">Регистрация учеников</div><span className="tag">{props.seatsUsed} из {props.maxLearners} мест занято</span></div>
      <p className="small quiet">Ученик регистрируется сам на странице входа: подтверждает e-mail по ссылке, задаёт пароль и проходит онбординг (с нуля — алфавит, с опытом — диагностика). Отключённые ученики место не занимают.</p>
      <div className="reg-grid">
        <div className="field"><label htmlFor="reg-mode">Режим</label>
          <select id="reg-mode" value={mode} onChange={(e) => setMode(e.target.value as Mode)}>{(Object.keys(MODE_RU) as Mode[]).map((m) => <option key={m} value={m}>{MODE_RU[m]}</option>)}</select>
        </div>
        <div className="field"><label htmlFor="reg-max">Мест для учеников</label>
          <input id="reg-max" type="number" min={Math.max(1, props.seatsUsed)} max={100} value={max} onChange={(e) => setMax(Number(e.target.value))} />
        </div>
      </div>
      <div className="row">
        <button className="btn" type="button" disabled={busy} onClick={() => save(false)}>{busy ? 'Сохраняю…' : 'Сохранить'}</button>
        {mode === 'code' ? <button className="btn outline" type="button" disabled={busy} onClick={() => save(true)}>{props.hasCode ? 'Выпустить новый код' : 'Создать код'}</button> : null}
        {mode !== 'closed' ? <span className="small quiet">Ссылка для учеников: <span className="mono">{props.appUrl}/register</span></span> : null}
      </div>
      {code ? <div className="banner ok mt8" role="status"><span>Код регистрации: <strong className="mono">{code}</strong> — сообщите его ученикам. Он показывается один раз; прежний код больше не действует.</span></div> : null}
      {msg ? <p className="small mt8" role="status">{msg}</p> : null}
    </div>
  );
}
