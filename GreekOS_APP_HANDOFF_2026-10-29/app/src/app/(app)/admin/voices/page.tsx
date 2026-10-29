import Link from 'next/link';
import { requireOwnerPage } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';
import { env } from '@/lib/env';
import { localAsrHealth } from '@/lib/providers/local-engines';
import { asrStatus, ttsStatus } from '@/lib/providers/speech';
import { AUDITION_TEXT } from '@/lib/voice/samples';
import { SyncVoices, VoiceRow, CastRoleControl, BatchRender } from '../_components/VoiceControls';

export const metadata = { title: 'Голоса и кастинг' };

const PRES_RU: Record<string, string> = { female: 'женский', male: 'мужской', any: 'любой', other: 'другой', unspecified: 'не заявлен' };
const JOB_STATUS_RU: Record<string, string> = {
  AUDIO_PENDING: 'ждёт генерации', BLOCKED_MISSING_VOICE_METADATA: 'нет кастинга ролей', BLOCKED_NO_SUITABLE_VOICE: 'нет подходящего голоса',
  BLOCKED_BUDGET: 'выше бюджета', RENDER_FAILED: 'ошибка генерации', GENERATED: 'сгенерировано', TECH_QA_PASS: 'тех. QA пройден, нужен разбор',
  TECH_QA_FAIL: 'тех. QA не пройден', DIGITAL_REVIEWED: 'цифровая проверка пройдена', RELEASE_ELIGIBLE: 'может быть выпущено',
};

export default async function VoicesPage() {
  await requireOwnerPage();
  const db = adminClient();
  const [{ data: voices }, { data: roles }, { data: casting }, { data: statuses }, { count: jobsTotal }, asr, { data: lat }] = await Promise.all([
    db.from('voice_catalog').select('*').order('provider').order('voice_id'),
    db.from('cast_roles').select('*').order('cast_role_id'),
    db.from('audio_job_casting').select('audio_id, speaker_role, source, approved, cast_role_id'),
    db.from('audio_job_render_status').select('audio_id, status, reason'),
    db.from('audio_jobs').select('audio_id', { count: 'exact', head: true }),
    localAsrHealth(),
    db.from('speaking_turn_metrics').select('input_source, asr_final_ms, llm_first_token_ms, tts_first_audio_ms, playback_start_ms, end_of_speech_to_audio_ms, interrupted').gt('turn_seq', 0).order('created_at', { ascending: false }).limit(500),
  ]);
  const latency = (['microphone', 'synthetic_test_clip'] as const).map((src) => {
    const rows = (lat ?? []).filter((r) => r.input_source === src);
    const col = (k: 'asr_final_ms' | 'llm_first_token_ms' | 'tts_first_audio_ms' | 'end_of_speech_to_audio_ms') => {
      const v = rows.map((r) => r[k]).filter((x): x is number => typeof x === 'number').sort((a, b) => a - b);
      const q = (p: number) => (v.length ? v[Math.min(v.length - 1, Math.ceil(p * v.length) - 1)] : null);
      return { n: v.length, p50: q(0.5), p95: q(0.95) };
    };
    return { src, turns: rows.length, interrupted: rows.filter((r) => r.interrupted).length, asr: col('asr_final_ms'), dialog: col('llm_first_token_ms'), tts: col('tts_first_audio_ms'), total: col('end_of_speech_to_audio_ms') };
  });
  const sec = (ms: number | null) => (ms == null ? '—' : `${(ms / 1000).toFixed(2)} с`);
  const voiceLabel = new Map((voices ?? []).map((v) => [v.voice_id, `${v.display_name} · ${PRES_RU[v.presentation]}`]));
  const byStatus = new Map<string, number>();
  for (const s of statuses ?? []) byStatus.set(s.status, (byStatus.get(s.status) ?? 0) + 1);
  const accounted = (statuses ?? []).length;
  const needsCasting = new Set((casting ?? []).filter((c) => c.source === 'needs_casting' || !c.cast_role_id).map((c) => c.audio_id)).size;
  const pres = (p: string) => (voices ?? []).filter((v) => v.available && v.presentation === p && v.provider !== 'mock').length;

  return (
    <div className="admin-section">
      <div className="card cardpad">
        <div className="card-top"><div className="card-title" style={{ fontSize: 16 }}>Голоса el-GR</div><SyncVoices /></div>
        <div className="banner info"><span>Пол голоса — только как его <b>заявляет провайдер/ОС</b>. Мужской голос нельзя подделать сменой высоты тона. Локальные голоса macOS — реальная речь для разработки, но по лицензии не для распространения ученикам.</span></div>
        <div className="pill-row mb0">
          <span className={`tag ${pres('female') ? 'green' : ''}`}>женских доступно: {pres('female')}</span>
          <span className={`tag ${pres('male') ? 'green' : ''}`}>мужских доступно: {pres('male')}</span>
          <span className="tag gray">TTS по умолчанию: {ttsStatus().provider}</span>
          <span className="tag gray">ASR: {asrStatus().provider}{asr ? ` · локальный Whisper: ${asr.available.join(', ') || 'нет моделей'}` : env.localEnginesAllowed ? ' · локальный ASR-сервис не запущен' : ''}</span>
        </div>
        <div className="table-wrap mt16"><table className="data-table"><thead><tr><th>Голос</th><th>Провайдер</th><th>Пол (заявлен)</th><th>Качество</th><th>Права</th><th>QA</th><th>Действия</th></tr></thead><tbody>
          {(voices ?? []).map((v) => (
            <tr key={v.voice_id}>
              <td><strong>{v.display_name}</strong><div className="tiny code">{v.voice_id}</div>{!v.available ? <div className="tiny">недоступен</div> : null}</td>
              <td>{v.provider}{v.engine_kind === 'local' ? ' (локально)' : ''}</td>
              <td>{PRES_RU[v.presentation]}<div className="tiny muted">{v.presentation_source}</div></td>
              <td>{v.quality_tier ?? '—'}</td>
              <td className="tiny">{v.distribution_allowed ? 'распространение разрешено' : 'только разработка'}</td>
              <td>{v.qa_status}{v.approved_by_owner ? ' · утверждён' : ''}</td>
              <td><VoiceRow voiceId={v.voice_id} hasSample={!!v.sample_object_path} approved={v.approved_by_owner} available={v.available} mock={v.provider === 'mock'} /></td>
            </tr>
          ))}
          {!(voices ?? []).length ? <tr><td colSpan={7}>Каталог пуст — нажмите «Обновить каталог и предложения».</td></tr> : null}
        </tbody></table></div>
        <p className="tiny muted mt8" lang="el">Текст образца: {AUDITION_TEXT}</p>
      </div>

      <div className="card cardpad">
        <div className="card-title">Задержка живого разговора (измерено шлюзом)</div>
        <p className="small quiet">От конца речи ученика до начала звука ответа; цель пилота: p50 ≤ 1,5 с, p95 ≤ 3,5 с. Синтетические клипы — техническая проверка, не замена живым ученикам.</p>
        <div className="table-wrap"><table className="data-table"><thead><tr><th>Источник речи</th><th>Реплик</th><th>ASR final p50/p95</th><th>Диалог p50/p95</th><th>Первый звук TTS p50/p95</th><th>Конец речи → звук p50/p95</th><th>Прервано</th></tr></thead><tbody>
          {latency.map((l) => (
            <tr key={l.src}>
              <td>{l.src === 'microphone' ? 'микрофон ученика' : 'синтетический тестовый клип'}</td><td>{l.turns}</td>
              <td>{sec(l.asr.p50)} / {sec(l.asr.p95)}</td><td>{sec(l.dialog.p50)} / {sec(l.dialog.p95)}</td><td>{sec(l.tts.p50)} / {sec(l.tts.p95)}</td>
              <td><strong>{sec(l.total.p50)} / {sec(l.total.p95)}</strong>{l.total.n ? ` (n=${l.total.n})` : ' — нет данных'}</td><td>{l.interrupted}</td>
            </tr>
          ))}
        </tbody></table></div>
      </div>

      <div className="card cardpad">
        <div className="card-title">Роли кастинга</div>
        <div className="table-wrap"><table className="data-table"><thead><tr><th>Роль</th><th>Нужен</th><th>Назначение</th><th>Голос</th><th>Статус</th></tr></thead><tbody>
          {(roles ?? []).map((r) => (
            <tr key={r.cast_role_id}>
              <td><strong>{r.cast_role_id}</strong></td><td>{PRES_RU[r.requested_presentation]}</td><td className="tiny">{r.use_case}</td>
              <td><CastRoleControl castRoleId={r.cast_role_id} presentation={r.requested_presentation} voiceId={r.voice_id} approved={r.approved} options={(voices ?? []).filter((v) => v.available && v.provider !== 'mock').map((v) => ({ id: v.voice_id, label: voiceLabel.get(v.voice_id)!, presentation: v.presentation }))} /></td>
              <td>{r.approved ? <span className="status">утверждён</span> : r.voice_id ? <span className="status wait">предложен</span> : <span className="status blocked">нет голоса</span>}</td>
            </tr>
          ))}
        </tbody></table></div>
      </div>

      <div className="card cardpad">
        <div className="card-title">Очередь {jobsTotal ?? 0} аудиозаданий</div>
        <div className="admin-top">
          <div className="card admin-stat"><small className="quiet">Учтено в отчёте</small><div className="metric mono">{accounted}/{jobsTotal ?? 0}</div></div>
          <div className="card admin-stat"><small className="quiet">Цифровая проверка пройдена</small><div className="metric mono">{(byStatus.get('DIGITAL_REVIEWED') ?? 0) + (byStatus.get('RELEASE_ELIGIBLE') ?? 0)}</div></div>
          <div className="card admin-stat"><small className="quiet">Нужен кастинг владельца</small><div className="metric mono">{needsCasting}</div></div>
          <div className="card admin-stat"><small className="quiet">Нет подходящего голоса</small><div className="metric mono">{byStatus.get('BLOCKED_NO_SUITABLE_VOICE') ?? 0}</div></div>
        </div>
        <div className="pill-row">{[...byStatus.entries()].sort().map(([k, n]) => <span key={k} className="tag gray">{JOB_STATUS_RU[k] ?? k}: {n}</span>)}</div>
        <div className="subtle-divider" />
        <BatchRender defaultCap={env.audioRunBudgetUsd} />
        <details className="box mt16"><summary>Заблокированные и требующие разбора задания</summary>
          {(statuses ?? []).filter((s) => !['DIGITAL_REVIEWED', 'RELEASE_ELIGIBLE'].includes(s.status)).sort((a, b) => a.audio_id.localeCompare(b.audio_id)).map((s) => (
            <div className="review-row" key={s.audio_id}><Link href={`/admin/audio/${encodeURIComponent(s.audio_id)}`}>{s.audio_id}</Link><small>{JOB_STATUS_RU[s.status] ?? s.status}{s.reason ? ` — ${s.reason}` : ''}</small></div>
          ))}
        </details>
      </div>
    </div>
  );
}
