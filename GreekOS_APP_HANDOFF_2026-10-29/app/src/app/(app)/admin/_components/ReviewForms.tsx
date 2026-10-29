'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  return { ok: res.ok, j };
}

export function ReviewDecisionForm({ assessmentId }: { assessmentId: string }) {
  const router = useRouter();
  const [verdict, setVerdict] = useState<'CORRECT' | 'ACCEPTABLE_VARIANT' | 'INCORRECT_CONFIRMED'>('CORRECT');
  const [comment, setComment] = useState('');
  const [correction, setCorrection] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    if (comment.trim().length < 2) return setMsg({ ok: false, text: 'Добавьте комментарий для ученика.' });
    setBusy(true);
    const { ok, j } = await post('/api/admin/reviews', { assessment_id: assessmentId, verdict, comment_ru: comment.trim(), ...(correction.trim() ? { correction_el: correction.trim() } : {}) });
    setBusy(false);
    if (!ok) return setMsg({ ok: false, text: j.message ?? 'Не сохранено' });
    setMsg({ ok: true, text: j.mastery_eligible ? 'Решение записано; доказательство учтено.' : 'Решение записано; на освоение не влияет (помощь, предпросмотр или письменный ответ на устное задание).' });
    router.refresh();
  }
  return (
    <details className="box mt8">
      <summary>Решение владельца</summary>
      <div className="inline-form">
        <div className="field"><label>Вердикт</label>
          <select value={verdict} onChange={(e) => setVerdict(e.target.value as typeof verdict)}>
            <option value="CORRECT">Верно</option><option value="ACCEPTABLE_VARIANT">Допустимый вариант</option><option value="INCORRECT_CONFIRMED">Ошибка подтверждена</option>
          </select>
        </div>
        <div className="field"><label>Комментарий для ученика (по-русски)</label><textarea value={comment} onChange={(e) => setComment(e.target.value)} /></div>
        {verdict === 'INCORRECT_CONFIRMED' ? <div className="field"><label>Исправление (по-гречески, необязательно)</label><input value={correction} onChange={(e) => setCorrection(e.target.value)} lang="el" /></div> : null}
        <button type="button" className="btn outline" disabled={busy} onClick={save}>{busy ? 'Сохраняю…' : 'Записать решение'}</button>
        {msg ? <span className={msg.ok ? 'msg-ok' : 'error-text'}>{msg.text}</span> : null}
        <span className="tiny muted">Будет отмечено как «Проверено владельцем — не независимый преподаватель».</span>
      </div>
    </details>
  );
}

export function AppealDecisionForm({ appealId }: { appealId: string }) {
  const router = useRouter();
  const [decision, setDecision] = useState<'UPHELD' | 'REJECTED'>('UPHELD');
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function save() {
    if (note.trim().length < 2) return setMsg({ ok: false, text: 'Добавьте пояснение.' });
    const { ok, j } = await post('/api/admin/appeals', { appeal_id: appealId, decision, note_ru: note.trim(), ...(decision === 'UPHELD' ? { verdict: 'CORRECT' } : {}) });
    if (!ok) return setMsg({ ok: false, text: j.message ?? 'Не сохранено' });
    setMsg({ ok: true, text: 'Решение записано.' });
    router.refresh();
  }
  return (
    <details className="box mt8">
      <summary>Рассмотреть оспаривание</summary>
      <div className="inline-form">
        <div className="field"><label>Решение</label>
          <select value={decision} onChange={(e) => setDecision(e.target.value as typeof decision)}>
            <option value="UPHELD">Принять: ответ верный (компенсирующие события)</option><option value="REJECTED">Отклонить: исходная оценка остаётся</option>
          </select>
        </div>
        <div className="field"><label>Пояснение</label><textarea value={note} onChange={(e) => setNote(e.target.value)} /></div>
        <button type="button" className="btn outline" onClick={save}>Записать</button>
        {msg ? <span className={msg.ok ? 'msg-ok' : 'error-text'}>{msg.text}</span> : null}
      </div>
    </details>
  );
}
