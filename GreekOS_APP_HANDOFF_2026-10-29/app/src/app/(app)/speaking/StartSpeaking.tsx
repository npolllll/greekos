'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/Icon';

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
    <div className="card voice-stage" style={{ minHeight: 0 }}>
      <div className="card-title"><Icon name="mic" /> Режим</div>
      <div className="chip-row mt8" role="radiogroup" aria-label="Режим разговора">
        {Object.entries(modes).filter(([k]) => k !== 'tutor_help').map(([k, v]) => <button key={k} type="button" role="radio" aria-checked={mode === k} className={`chip ${mode === k ? 'active' : ''}`} onClick={() => setMode(k)}>{v}</button>)}
      </div>
      <p className="small quiet mt8">{mode === 'a0_guided' ? 'С нуля: образец, затем ваша короткая фраза; можно русский, медленный темп, текст. Без оценки фонетики.' : mode === 'b2_mock' ? 'Учебная симуляция B2: без подсказок, оценка после разговора — не официальный экзамен ΚΕΓ.' : mode === 'free_talk' ? 'Свободный разговор на тему сценария; ответы собеседника — AI-черновик, не материал курса.' : mode === 'real_greek' ? 'Разговорные ситуации Real Greek: регистр и уместность. Без оценки и без звуковой сертификации.' : 'Ситуация с целью и неожиданными поворотами; отвечайте своими словами — примеры не являются ключом.'}</p>
      <div className="card-title mt16">Собеседник</div>
      <div className="chip-row mt8" role="radiogroup" aria-label="Голос собеседника">
        {personas.map((p) => (
          <button key={p.cast_role_id} type="button" role="radio" aria-checked={persona === p.cast_role_id} disabled={!p.available} className={`chip ${persona === p.cast_role_id ? 'active' : ''}`} onClick={() => setPersona(p.cast_role_id)} title={p.available ? undefined : 'Нет подходящего голоса с заявленным полом — не подменяем другим голосом'}>
            {p.presentation === 'female' ? 'Собеседница' : 'Собеседник'}{p.voice_name ? ` · ${p.voice_name}` : ' · голос не подключён'}{p.dev_only ? ' · dev' : ''}
          </button>
        ))}
      </div>
      {voice ? (
        <div className="chip-row mt8" role="radiogroup" aria-label="Формат голосового разговора">
          <button type="button" role="radio" aria-checked={live && stream} disabled={!stream} className={`chip ${live && stream ? 'active' : ''}`} onClick={() => setLive(true)}>Живой разговор (потоковый)</button>
          <button type="button" role="radio" aria-checked={!live || !stream} className={`chip ${!live || !stream ? 'active' : ''}`} onClick={() => setLive(false)}>Пошаговый (менее интерактивный)</button>
        </div>
      ) : null}
      <div className="chip-row mt16">{['Все', 'A1', 'A2', 'B1', 'B2'].map((l) => <button key={l} type="button" className={`chip ${level === l ? 'active' : ''}`} onClick={() => setLevel(l)}>{l}</button>)}</div>
      {err ? <p className="error-text" role="alert">{err}</p> : null}
      <div className="mt16">
        {visible.map((s) => (
          <div key={s.id} className="scenario" style={{ cursor: 'default' }}>
            <span className="unit-num">{s.level}</span>
            <span style={{ flex: 1, minWidth: 0 }}><b>{s.domain} · {s.id}</b><span>{s.objective}</span></span>
            {s.released || isOwner ? (
              <span className="row" style={{ gap: 6 }}>
                {voice ? <button className="btn" type="button" disabled={!!busy} onClick={() => start(s, 'voice')}>{busy === s.id ? '…' : 'Голосом'}</button> : null}
                <button className="btn outline" type="button" disabled={!!busy} onClick={() => start(s, 'text_fallback')} title="Текстовый режим не засчитывается как говорение">Текстом</button>
                {!s.released ? <span className="tag">предпросмотр</span> : null}
              </span>
            ) : <span className="tag gray">На проверке</span>}
          </div>
        ))}
        {!visible.length ? <div className="empty"><strong>Нет сценариев для этого режима</strong></div> : null}
      </div>
    </div>
  );
}
