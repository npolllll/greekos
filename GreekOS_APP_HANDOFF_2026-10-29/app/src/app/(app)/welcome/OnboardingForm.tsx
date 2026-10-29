'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

const PATHS = [
  { id: 'from_zero', title: 'С полного нуля', text: 'Не знаю букв и произношения. Начну с алфавита и звуков.' },
  { id: 'prior_learning', title: 'Уже изучал(а) греческий', text: 'Пройду короткую диагностику по навыкам, чтобы не повторять известное.' },
  { id: 'unsure', title: 'Не уверен(а)', text: 'Диагностика поможет выбрать точку входа; можно остановиться в любой момент.' },
] as const;

export function OnboardingForm({ today, defaultTz }: { today: string; defaultTz: string }) {
  const router = useRouter();
  const [path, setPath] = useState<string | null>(null);
  const [tz, setTz] = useState(() => {
    if (typeof window === 'undefined') return defaultTz;
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || defaultTz; } catch { return defaultTz; }
  });
  const [start, setStart] = useState(today);
  const [minutes, setMinutes] = useState(60);
  const [days, setDays] = useState(6);
  const [exam, setExam] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!path) return setError('Выберите вариант начала.');
    setBusy(true);
    setError(null);
    const res = await fetch('/api/me/onboarding', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ entry_path: path, timezone: tz, start_date: start, daily_minutes: minutes, days_per_week: days, exam_date: exam || null }) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { setBusy(false); return setError(json.message ?? 'Не удалось сохранить.'); }
    router.replace(json.next ?? '/');
    router.refresh();
  }

  return (
    <div>
      <div className="eyebrow">Шаг 1 · опыт</div>
      <h2 className="placement-title">Какой у вас опыт с греческим?</h2>
      <div className="placement-choices" role="radiogroup" aria-label="Опыт изучения">
        {PATHS.map((p) => (
          <button key={p.id} type="button" role="radio" aria-checked={path === p.id} className={`placement-choice ${path === p.id ? 'selected' : ''}`} onClick={() => setPath(p.id)}>
            <span><b style={{ display: 'block', fontSize: 15 }}>{p.title}</b><small className="quiet" style={{ fontSize: 11.5 }}>{p.text}</small></span>
          </button>
        ))}
      </div>
      <div className="eyebrow" style={{ marginTop: 24 }}>Шаг 2 · расписание</div>
      <div className="grid-2">
        <div className="field"><label htmlFor="start">Дата начала</label><input id="start" type="date" value={start} onChange={(e) => setStart(e.target.value)} /><span className="hint">От неё считаются 9 месяцев.</span></div>
        <div className="field"><label htmlFor="tz">Часовой пояс</label><input id="tz" value={tz} onChange={(e) => setTz(e.target.value)} suppressHydrationWarning /><span className="hint">Нужен для D7/D28 по вашему календарю.</span></div>
        <div className="field"><label htmlFor="min">Минут в день</label><input id="min" type="number" min={10} max={480} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} /></div>
        <div className="field"><label htmlFor="days">Дней в неделю</label><input id="days" type="number" min={1} max={7} value={days} onChange={(e) => setDays(Number(e.target.value))} /></div>
        <div className="field"><label htmlFor="exam">Дата экзамена (необязательно)</label><input id="exam" type="date" value={exam} onChange={(e) => setExam(e.target.value)} /><span className="hint">Не меняет девятимесячный план.</span></div>
      </div>
      {error ? <p className="error-text" role="alert">{error}</p> : null}
      <div className="placement-footer"><span className="quiet">Изменить дневное время можно позже в настройках.</span><button className="btn" type="button" disabled={busy} onClick={submit}>{busy ? 'Сохраняю…' : 'Начать'}</button></div>
    </div>
  );
}
