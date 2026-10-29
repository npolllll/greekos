'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** Manual route change: requires a reason; history and audit are written server-side. */
export function RouteForm({ userId, current, units }: { userId: string; current: string | null; units: Array<{ id: string; label: string }> }) {
  const router = useRouter();
  const [unit, setUnit] = useState(current ?? '');
  const [kind, setKind] = useState<'manual' | 'foundations' | 'provisional' | 'verified'>('manual');
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setMsg(null);
    if (reason.trim().length < 5) return setMsg({ ok: false, text: 'Укажите причину (не менее 5 символов).' });
    setBusy(true);
    const res = await fetch(`/api/admin/learners/${userId}/route`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ start_unit_id: unit || null, route_kind: kind, reason: reason.trim() }) });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setMsg({ ok: false, text: j.message ?? 'Не сохранено' });
    setMsg({ ok: true, text: 'Маршрут изменён; ученик увидит обновление.' });
    setReason('');
    router.refresh();
  }

  return (
    <details className="box mt8">
      <summary>Изменить маршрут</summary>
      <div className="inline-form">
        <div className="field"><label htmlFor="rf-unit">Стартовый урок</label>
          <select id="rf-unit" value={unit} onChange={(e) => setUnit(e.target.value)}>
            <option value="">— не назначен —</option>
            {units.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
          </select>
        </div>
        <div className="field"><label htmlFor="rf-kind">Тип маршрута</label>
          <select id="rf-kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="manual">Назначен владельцем</option><option value="foundations">Основы (с нуля)</option><option value="provisional">Предварительный</option><option value="verified">Подтверждённый</option>
          </select>
        </div>
        <div className="field"><label htmlFor="rf-reason">Причина (обязательно)</label><textarea id="rf-reason" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
        <button type="button" className="btn outline" disabled={busy} onClick={save}>{busy ? 'Сохраняю…' : 'Сохранить маршрут'}</button>
        {msg ? <span className={msg.ok ? 'msg-ok' : 'error-text'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</span> : null}
      </div>
    </details>
  );
}
