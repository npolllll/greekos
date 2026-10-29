'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { browserClient } from '@/lib/supabase/browser';

interface Consent { consent_id: string; purpose: string; artifact_id: string | null; granted_at: string; expires_at: string | null; revoked_at: string | null }

export function SettingsClient(props: {
  consents: Consent[];
  enrollment: { daily_minutes: number; days_per_week: number; exam_date: string | null; start_date: string | null; end_date: string | null } | null;
  reducedMotion: boolean;
  speakingRate: 'slow' | 'normal';
  isOwner: boolean;
}) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [minutes, setMinutes] = useState(props.enrollment?.daily_minutes ?? 60);
  const [days, setDays] = useState(props.enrollment?.days_per_week ?? 6);
  const [exam, setExam] = useState(props.enrollment?.exam_date ?? '');
  const [rate, setRate] = useState(props.speakingRate);
  const [del, setDel] = useState('');
  const activeVoice = props.consents.find((c) => c.purpose === 'voice_review_retention' && !c.revoked_at && (!c.expires_at || new Date(c.expires_at) > new Date()));

  async function post(url: string, body: unknown, ok: string) {
    setMsg(null);
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    setMsg(r.ok ? ok : j.message ?? 'Ошибка');
    if (r.ok) router.refresh();
    return r.ok;
  }

  return (
    <div className="stack">
      {props.enrollment ? (
        <div className="card cardpad">
          <div className="card-title">Расписание</div>
          <div className="grid-2">
            <div className="field"><label htmlFor="m">Минут в день</label><input id="m" type="number" min={10} max={480} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} /></div>
            <div className="field"><label htmlFor="d">Дней в неделю</label><input id="d" type="number" min={1} max={7} value={days} onChange={(e) => setDays(Number(e.target.value))} /></div>
            <div className="field"><label htmlFor="x">Дата экзамена</label><input id="x" type="date" value={exam} onChange={(e) => setExam(e.target.value)} /><span className="hint">Не меняет 9 месяцев от старта ({props.enrollment.start_date} → {props.enrollment.end_date}).</span></div>
          </div>
          <button className="btn outline" type="button" onClick={() => post('/api/me/schedule', { daily_minutes: minutes, days_per_week: days, exam_date: exam || null }, 'Расписание сохранено.')}>Сохранить</button>
        </div>
      ) : null}
      <div className="card cardpad">
        <div className="card-title">Речь</div>
        <div className="chip-row mt8" role="radiogroup" aria-label="Темп синтезированной речи">
          {(['normal', 'slow'] as const).map((r) => <button key={r} type="button" role="radio" aria-checked={rate === r} className={`chip ${rate === r ? 'active' : ''}`} onClick={async () => { setRate(r); await post('/api/me/preferences', { speaking_rate: r }, 'Сохранено.'); }}>{r === 'normal' ? 'Обычный темп' : 'Медленнее'}</button>)}
        </div>
        <div className="subtle-divider" />
        <div className="card-title">Хранение голосовых записей для проверки</div>
        {activeVoice ? (
          <>
            <p className="small">Разрешено до {new Date(activeVoice.expires_at!).toLocaleDateString('ru-RU')}. Отзыв удалит сохранённые записи.</p>
            <button className="btn outline" type="button" onClick={() => post('/api/consents', { action: 'revoke', consent_id: activeVoice.consent_id }, 'Согласие отозвано, записи удалены.')}>Отозвать и удалить</button>
          </>
        ) : (
          <>
            <p className="small quiet">Сейчас записи не сохраняются. Можно разрешить хранение на срок до 30 дней для проверки произношения человеком.</p>
            <button className="btn outline" type="button" onClick={() => post('/api/consents', { action: 'grant', purpose: 'voice_review_retention', days: 30 }, 'Разрешено на 30 дней.')}>Разрешить на 30 дней</button>
          </>
        )}
      </div>
      <div className="card cardpad">
        <div className="card-title">Мои данные</div>
        <a className="btn outline" href="/api/me/export">Скачать все мои данные (JSON)</a>
        {!props.isOwner ? (
          <>
            <div className="subtle-divider" />
            <p className="small">Удаление аккаунта необратимо: будут удалены прогресс, ответы, разговоры и записи. Введите «УДАЛИТЬ».</p>
            <div className="row"><input className="input" style={{ maxWidth: 200 }} aria-label="Подтверждение удаления" value={del} onChange={(e) => setDel(e.target.value)} /><button className="btn dark" type="button" disabled={del !== 'УДАЛИТЬ'} onClick={async () => { if (await post('/api/me/delete', { confirm: 'УДАЛИТЬ' }, 'Аккаунт удалён.')) { await browserClient().auth.signOut(); router.replace('/login'); } }}>Удалить аккаунт</button></div>
          </>
        ) : null}
        <div className="subtle-divider" />
        <div className="card-title">Согласия</div>
        {props.consents.length ? props.consents.map((c) => <div className="review-row" key={c.consent_id}><b>{c.purpose === 'voice_review_retention' ? 'Хранение голоса' : c.purpose === 'owner_transcript_access' ? 'Доступ владельца к расшифровке' : c.purpose}</b><small>{c.revoked_at ? 'отозвано' : c.expires_at ? `до ${new Date(c.expires_at).toLocaleDateString('ru-RU')}` : 'действует'}</small></div>) : <p className="small quiet">Согласий нет.</p>}
      </div>
      {msg ? <p className="small" role="status">{msg}</p> : null}
    </div>
  );
}
