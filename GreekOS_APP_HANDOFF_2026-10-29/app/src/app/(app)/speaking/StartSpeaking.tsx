'use client';
import { useMemo, useState, ViewTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/Icon';

const MODE_NOTE: Record<string, string> = {
  a0_guided: 'С нуля: образец, затем ваша короткая фраза; можно русский, медленный темп, текст. Без оценки фонетики.',
  b2_mock: 'Учебная симуляция B2: без подсказок, оценка после разговора — не официальный экзамен ΚΕΓ.',
  free_talk: 'Свободный разговор на тему сценария; ответы собеседника — AI-черновик, не материал курса.',
  real_greek: 'Разговорные ситуации Real Greek: регистр и уместность. Без оценки и без звуковой сертификации.',
  roleplay: 'Ситуация с целью и неожиданными поворотами; отвечайте своими словами — примеры не являются ключом.',
};
/** Crop of the shared Thessaloniki scene per domain: a calm, consistent visual cue, not a stock photo. */
const SCENE_POS: Record<string, [number, number]> = {
  'Супермаркет': [90, 80], 'Ресторан': [14, 84], 'Кафе': [62, 62], 'Банк': [80, 46], 'Госучреждение': [78, 40], 'Общественный транспорт': [42, 64],
  'Жильё': [96, 56], 'Здравоохранение': [66, 54], 'Университет': [80, 34], 'Работа': [92, 50], 'Спорт': [30, 64], 'Социальные отношения': [8, 14],
  'Клиентский сервис': [86, 74], 'Живой греческий': [22, 46],
};

interface Sc { id: string; level: string; domain: string; objective: string; released: boolean; rg: boolean }
interface Persona { cast_role_id: string; presentation: string; voice_name: string | null; available: boolean; dev_only: boolean }

export function StartSpeaking({ scenarios, isOwner, voice, stream, personas, defaultMode, modes }: { scenarios: Sc[]; isOwner: boolean; voice: boolean; stream: boolean; personas: Persona[]; defaultMode: string; modes: Record<string, string> }) {
  const router = useRouter();
  const [mode, setMode] = useState(Object.keys(modes).includes(defaultMode) ? defaultMode : 'roleplay');
  const [level, setLevel] = useState<string>('Все');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [persona, setPersona] = useState<string>(personas.find((p) => p.available)?.cast_role_id ?? 'TUTOR_F');
  const [live, setLive] = useState(stream);
  const visible = useMemo(() => scenarios.filter((s) => (mode === 'real_greek' ? s.rg : !s.rg) && (mode !== 'b2_mock' || s.level === 'B2') && (level === 'Все' || s.level === level)), [scenarios, mode, level]);

  async function start(s: Sc, inputMode: 'voice' | 'text_fallback') {
    setBusy(s.id); setErr(null);
    const r = await fetch('/api/speaking', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'start', scenario_id: s.id, mode, input_mode: inputMode, idempotency_key: crypto.randomUUID(), voice_persona: persona, transport: inputMode === 'voice' && live && stream ? 'stream_local_gateway' : 'batch' }) });
    const j = await r.json().catch(() => ({}));
    setBusy(null);
    if (!r.ok) return setErr(j.message ?? 'Не удалось начать разговор.');
    router.push(`/speaking/${j.session_id}`);
  }

  return (
    <div className="stack" style={{ minWidth: 0 }}>
      <div className="card cardpad">
        <div className="seg" role="radiogroup" aria-label="Режим разговора">
          {Object.entries(modes).filter(([k]) => k !== 'tutor_help').map(([k, v]) => <button key={k} type="button" role="radio" aria-checked={mode === k} className={mode === k ? 'on' : ''} onClick={() => setMode(k)}>{v}</button>)}
        </div>
        <p className="small quiet" style={{ margin: '10px 2px 0' }}>{MODE_NOTE[mode] ?? MODE_NOTE.roleplay}</p>
        <div className="picker-grid">
          <div>
            <div className="eyebrow">Собеседник</div>
            <div className="chip-row mt8" role="radiogroup" aria-label="Голос собеседника">
              {personas.map((p) => (
                <button key={p.cast_role_id} type="button" role="radio" aria-checked={persona === p.cast_role_id} disabled={!p.available} className={`chip ${persona === p.cast_role_id ? 'active' : ''}`} onClick={() => setPersona(p.cast_role_id)} title={p.available ? undefined : 'Нет подходящего голоса с заявленным полом — не подменяем другим голосом'}>
                  {p.presentation === 'female' ? 'Собеседница' : 'Собеседник'}{p.voice_name ? ` · ${p.voice_name}` : ' · голос не подключён'}{p.dev_only ? ' · dev' : ''}
                </button>
              ))}
            </div>
          </div>
          {voice ? (
            <div>
              <div className="eyebrow">Формат</div>
              <div className="chip-row mt8" role="radiogroup" aria-label="Формат голосового разговора">
                <button type="button" role="radio" aria-checked={live && stream} disabled={!stream} className={`chip ${live && stream ? 'active' : ''}`} onClick={() => setLive(true)}>Живой (потоковый)</button>
                <button type="button" role="radio" aria-checked={!live || !stream} className={`chip ${!live || !stream ? 'active' : ''}`} onClick={() => setLive(false)}>Пошаговый</button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
      <div className="row between" style={{ padding: '0 4px' }}>
        <div className="chip-row" role="radiogroup" aria-label="Уровень">{['Все', 'A1', 'A2', 'B1', 'B2'].map((l) => <button key={l} type="button" role="radio" aria-checked={level === l} className={`chip ${level === l ? 'active' : ''}`} onClick={() => setLevel(l)}>{l}</button>)}</div>
        <span className="tiny quiet">{visible.length} сценариев</span>
      </div>
      {err ? <p className="error-text" role="alert">{err}</p> : null}
      <div className="sc-grid stagger">
        {visible.map((s, i) => {
          const pos = SCENE_POS[s.domain] ?? [(i * 23) % 100, 60];
          const open = s.released || isOwner;
          return (
            <article key={s.id} className={`sc-card ${open ? '' : 'locked'}`}>
              <div className="thumb" style={{ ['--tx' as string]: `${pos[0]}%`, ['--ty' as string]: `${pos[1]}%`, ['--ts' as string]: '190%' }} aria-hidden="true"><span className="sc-level">{s.level}</span></div>
              <div className="sc-body">
                <span className="tiny quiet">{s.id}{!s.released && open ? ' · предпросмотр' : ''}</span>
                <ViewTransition name={`scenario-${s.id}`} share="morph" default="none"><h3>{s.domain}</h3></ViewTransition>
                <p>{s.objective}</p>
              </div>
              {open ? (
                <div className="sc-actions">
                  {voice ? <button className="btn small" type="button" disabled={!!busy} onClick={() => start(s, 'voice')}><Icon name="mic" size={14} /> {busy === s.id ? 'Запуск…' : 'Голосом'}</button> : null}
                  <button className="btn small outline" type="button" disabled={!!busy} onClick={() => start(s, 'text_fallback')} title="Текстовый режим не засчитывается как говорение">Текстом</button>
                </div>
              ) : <div className="sc-actions"><span className="tag gray"><Icon name="lock" size={12} /> На проверке</span></div>}
            </article>
          );
        })}
      </div>
      {!visible.length ? <div className="empty card"><strong>Нет сценариев для этого режима</strong>Выберите другой уровень или режим.</div> : null}
    </div>
  );
}
