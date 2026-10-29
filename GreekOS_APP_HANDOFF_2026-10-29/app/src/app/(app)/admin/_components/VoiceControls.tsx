'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

async function post(body: Record<string, unknown>) {
  const res = await fetch('/api/admin/voices', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.message ?? 'Ошибка');
  return j;
}

const PRES_RU: Record<string, string> = { female: 'женский', male: 'мужской', any: 'любой', other: 'другой', unspecified: 'не указан' };
const SOURCE_RU: Record<string, string> = {
  owner: 'назначено владельцем', grammatical_gender_proposal: 'предложение: грамматический род', self_reference_proposal: 'предложение: самоназвание в тексте',
  narrator_default_proposal: 'предложение: голос диктора', needs_casting: 'нужен выбор владельца',
};

export function SyncVoices() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="row">
      <button className="btn" type="button" disabled={busy} onClick={async () => {
        setBusy(true); setMsg(null);
        try {
          const j = await post({ action: 'sync' });
          setMsg(`Локальных голосов: ${j.local_voices}; облако: ${Object.entries(j.cloud).map(([k, v]) => `${k} — ${v}`).join(', ')}; предложений кастинга: ${j.job_casting_rows}.`);
          router.refresh();
        } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
      }}>{busy ? 'Синхронизирую…' : 'Обновить каталог и предложения'}</button>
      {msg ? <span className="small" role="status">{msg}</span> : null}
    </div>
  );
}

export function VoiceRow(props: { voiceId: string; hasSample: boolean; approved: boolean; available: boolean; mock: boolean }) {
  const router = useRouter();
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function listen() {
    setErr(null);
    const r = await fetch(`/api/admin/voices/sample?voice_id=${encodeURIComponent(props.voiceId)}`);
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.url) setUrl(j.url); else setErr(j.message ?? 'Нет образца');
  }
  return (
    <div className="row" style={{ gap: 6 }}>
      {props.available && !props.mock ? <button className="btn outline" type="button" disabled={busy} onClick={async () => { setBusy(true); setErr(null); try { await post({ action: 'sample', voice_id: props.voiceId }); await listen(); router.refresh(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } }}>{busy ? 'Синтез…' : props.hasSample ? 'Обновить образец' : 'Сделать образец'}</button> : null}
      {props.hasSample ? <button className="btn outline" type="button" onClick={listen}>Слушать</button> : null}
      {props.hasSample && !props.mock ? <button className="btn flat" type="button" onClick={async () => { try { await post({ action: 'approve_voice', voice_id: props.voiceId, approved: !props.approved }); router.refresh(); } catch (e) { setErr((e as Error).message); } }}>{props.approved ? 'Снять утверждение' : 'Прослушано — утверждаю'}</button> : null}
      {url ? <audio controls autoPlay src={url} style={{ maxWidth: 260 }}><track kind="captions" /></audio> : null}
      {err ? <span className="error-text">{err}</span> : null}
    </div>
  );
}

export function CastRoleControl(props: { castRoleId: string; presentation: string; voiceId: string | null; approved: boolean; options: Array<{ id: string; label: string; presentation: string }> }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const opts = props.options.filter((o) => props.presentation === 'any' || o.presentation === props.presentation);
  return (
    <div className="row" style={{ gap: 6 }}>
      <select aria-label={`Голос для ${props.castRoleId}`} value={props.voiceId ?? ''} onChange={async (e) => { setErr(null); try { await post({ action: 'set_cast_role', cast_role_id: props.castRoleId, voice_id: e.target.value || null }); router.refresh(); } catch (x) { setErr((x as Error).message); } }}>
        <option value="">— не назначен —</option>
        {opts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
      {props.voiceId ? <button className="btn flat" type="button" onClick={async () => { try { await post({ action: 'approve_cast_role', cast_role_id: props.castRoleId, approved: !props.approved }); router.refresh(); } catch (x) { setErr((x as Error).message); } }}>{props.approved ? 'Снять утверждение' : 'Утвердить'}</button> : null}
      {!opts.length ? <span className="tiny muted">нет голосов с заявленным полом «{PRES_RU[props.presentation]}»</span> : null}
      {err ? <span className="error-text">{err}</span> : null}
    </div>
  );
}

export function CastingEditor(props: { audioId: string; rows: Array<{ speaker_role: string; cast_role_id: string | null; required_presentation: string | null; source: string; approved: boolean }>; castRoles: Array<{ id: string; presentation: string; voice: string | null }> }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  if (!props.rows.length) return <p className="small quiet">Предложений кастинга ещё нет — нажмите «Обновить каталог и предложения» в разделе «Голоса и кастинг».</p>;
  return (
    <div>
      <div className="table-wrap"><table className="data-table"><thead><tr><th>Роль</th><th>Основание</th><th>Роль кастинга → голос</th><th>Утверждено</th></tr></thead><tbody>
        {props.rows.map((r) => (
          <tr key={r.speaker_role}>
            <td lang="el"><strong>{r.speaker_role === '__narrator__' ? 'диктор' : r.speaker_role}</strong></td>
            <td className="tiny">{SOURCE_RU[r.source] ?? r.source}{r.required_presentation ? ` · нужен ${PRES_RU[r.required_presentation]}` : ''}</td>
            <td>
              <select aria-label={`Кастинг для ${r.speaker_role}`} value={r.cast_role_id ?? ''} onChange={async (e) => { setErr(null); try { await post({ action: 'set_job_casting', audio_id: props.audioId, speaker_role: r.speaker_role, cast_role_id: e.target.value || null, approved: false }); router.refresh(); } catch (x) { setErr((x as Error).message); } }}>
                <option value="">— не назначено —</option>
                {props.castRoles.map((c) => <option key={c.id} value={c.id}>{c.id} ({PRES_RU[c.presentation]}) → {c.voice ?? 'нет голоса'}</option>)}
              </select>
            </td>
            <td>{r.approved ? <span className="status">да</span> : <span className="status wait">нет</span>}</td>
          </tr>
        ))}
      </tbody></table></div>
      <button className="btn flat mt8" type="button" disabled={props.rows.some((r) => !r.cast_role_id)} onClick={async () => { try { await post({ action: 'approve_job_casting', audio_id: props.audioId }); router.refresh(); } catch (x) { setErr((x as Error).message); } }}>Утвердить кастинг задания</button>
      {err ? <p className="error-text">{err}</p> : null}
    </div>
  );
}

export function BatchRender({ defaultCap }: { defaultCap: number }) {
  const router = useRouter();
  const [cap, setCap] = useState(defaultCap);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [ack, setAck] = useState(false);
  async function run() {
    setRunning(true);
    setLog([]);
    try {
      for (let round = 0; round < 60; round++) {
        const j = await post({ action: 'render_batch', limit: 2, budget_cap_usd: cap });
        setLog((l) => [...l, ...j.processed.map((p: { audio_id: string; job_status: string; error: string | null }) => `${p.audio_id}: ${p.job_status}${p.error ? ` — ${p.error}` : ''}`)]);
        router.refresh();
        if (!j.processed.length || j.remaining_renderable === 0) { setLog((l) => [...l, `Готово. Заблокировано без подходящего голоса/кастинга: ${j.blocked}.`]); break; }
      }
    } catch (e) { setLog((l) => [...l, `Ошибка: ${(e as Error).message}`]); } finally { setRunning(false); }
  }
  return (
    <div>
      <div className="field"><label htmlFor="bcap">Лимит расходов на одно задание, USD (локальные голоса — $0)</label><input id="bcap" type="number" min={0} max={100} step={0.5} value={cap} onChange={(e) => setCap(Number(e.target.value))} /></div>
      <label className="small"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> Понимаю: генерируется синтезированная речь; файлы не публикуются автоматически, выпуск — отдельное решение.</label>
      <div className="row mt8"><button className="btn" type="button" disabled={running || !ack} onClick={run}>{running ? 'Генерирую по очереди…' : 'Сгенерировать доступные задания'}</button></div>
      {log.length ? <pre className="code" style={{ whiteSpace: 'pre-wrap', maxHeight: 240, overflow: 'auto', display: 'block', marginTop: 8 }}>{log.join('\n')}</pre> : null}
    </div>
  );
}
