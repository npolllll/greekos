import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireOwnerPage } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';
import { planJob, loadCastingContext } from '@/lib/audio/pipeline';
import { normalizeAudioJob } from '@/lib/admin/audio';
import { CastingEditor } from '../../_components/VoiceControls';
import { releaseMap } from '@/lib/content/repo';
import { activePolicy } from '@/lib/admin/releases';
import { DIGITAL_STATUS_LABEL, dateTimeRu } from '@/lib/admin/labels';
import { env } from '@/lib/env';
import { AudioRender, RightsForm, AssetPlayer, ListenVerdict, AudioReleaseButton } from '../../_components/AudioControls';
import { audioReleaseBlockers, ownerListening } from '@/lib/qa/audio-release';
import { ActionButton } from '../../_components/ActionButton';

export const metadata = { title: 'Аудио · задание' };

export default async function AudioJobPage({ params }: { params: Promise<{ audioId: string }> }) {
  await requireOwnerPage();
  const { audioId } = await params;
  const db = adminClient();
  const { data: job } = await db.from('audio_jobs').select('audio_id, script_hash, text_el, segments, payload, current_hash').eq('audio_id', decodeURIComponent(audioId)).maybeSingle();
  if (!job) notFound();
  const ctx = await loadCastingContext();
  const planned = planJob(normalizeAudioJob(job), ctx);
  const plan = planned.ok ? planned.plan : null;
  const roles = [...ctx.casting.values()].filter((c) => c.audio_id === job.audio_id);
  const { data: jobStatus } = await db.from('audio_job_render_status').select('status, reason, attempts, updated_at').eq('audio_id', job.audio_id).maybeSingle();
  const voiceName = (id: string) => ctx.voices.get(id)?.display_name ?? id;
  const [{ data: assets }, policy, { data: items }] = await Promise.all([
    db.from('audio_assets').select('*').eq('audio_id', job.audio_id).order('created_at', { ascending: false }),
    activePolicy(),
    db.from('item_audio').select('item_id').eq('audio_id', job.audio_id),
  ]);
  const rel = await releaseMap('audio_asset', (assets ?? []).filter((a) => a.sha256).map((a) => ({ id: a.id, hash: a.sha256 as string })));
  const pl = job.payload as { voice_profile?: { direction?: string }; speaking_rate?: { target_wpm?: number }; pronunciation_notes?: unknown };
  return (
    <div className="admin-section">
      <div className="card cardpad">
        <div className="card-top"><div className="card-title" style={{ fontSize: 16 }}>{job.audio_id}</div><Link className="text-link" href="/admin/audio">← Очередь</Link></div>
        <dl className="kv">
          <dt>Хеш сценария</dt><dd className="code">{job.script_hash}</dd>
          <dt>Задания</dt><dd>{(items ?? []).map((i) => i.item_id).join(', ') || '—'}</dd>
          <dt>Направление озвучки</dt><dd>{pl.voice_profile?.direction ?? '—'}</dd>
          <dt>Темп (план автора)</dt><dd>{pl.speaking_rate?.target_wpm ? `${pl.speaking_rate.target_wpm} слов/мин — не измерено, не официально` : '—'}</dd>
        </dl>
      </div>
      <div className="card cardpad">
        <div className="card-title">Кастинг ролей</div>
        <p className="small quiet">Голос роли берётся только из утверждённого кастинга. Пол по имени персонажа не угадывается; предложения основаны на грамматическом роде ролевых существительных или самоназвании в тексте и требуют вашего утверждения.</p>
        <CastingEditor audioId={job.audio_id} rows={roles.map((r) => ({ speaker_role: r.speaker_role, cast_role_id: r.cast_role_id, required_presentation: r.required_presentation, source: r.source, approved: r.approved }))} castRoles={[...ctx.castRoles.values()].map((c) => ({ id: c.cast_role_id, presentation: c.requested_presentation, voice: c.voice_id ? voiceName(c.voice_id) : null }))} />
      </div>
      <div className="card cardpad">
        <div className="card-title">План генерации</div>
        {jobStatus ? <p className="small">Статус задания: <b>{jobStatus.status}</b>{jobStatus.reason ? ` — ${jobStatus.reason}` : ''} · попыток {jobStatus.attempts}</p> : null}
        {plan ? (
          <>
            <dl className="kv">
              <dt>Движки</dt><dd>{plan.engines.join(', ')}</dd>
              <dt>Голоса по ролям</dt><dd>{Object.entries(plan.voice_map).map(([r, v]) => `${r === '__narrator__' ? 'диктор' : r} → ${voiceName(v)} (${plan.cast_map[r]})`).join('; ')}</dd>
              <dt>Кастинг утверждён</dt><dd>{plan.cast_approved ? 'да' : 'нет — файл можно сделать для проверки, но выпуск невозможен'}</dd>
              <dt>Сегментов / символов</dt><dd>{plan.segments.length} / {plan.characters}</dd>
              <dt>Оценка стоимости</dt><dd>${plan.estimated_cost_usd} (облачные голоса; локальные — $0)</dd>
              <dt>Хеш плана</dt><dd className="code">{plan.plan_hash}</dd>
            </dl>
            <details className="box mt8"><summary>Сегменты ({plan.segments.length})</summary>
              {plan.segments.map((s) => <div key={s.segment_id} className="review-row"><div><b>{s.segment_id}</b><span className="event-text" lang="el">{s.role !== '__narrator__' ? `${s.role}: ` : ''}{s.text}</span></div><small>{voiceName(s.voice_id)}</small></div>)}
            </details>
          </>
        ) : <div className="banner warn"><span><strong>{!planned.ok ? planned.status : ''}</strong> {!planned.ok ? planned.reason : ''}</span></div>}
        <AudioRender audioId={job.audio_id} planHash={plan?.plan_hash ?? ''} configured={!!plan} defaultCap={env.audioRunBudgetUsd} />
      </div>
      <div className="card cardpad">
        <div className="card-title">Файлы ({assets?.length ?? 0})</div>
        {(assets ?? []).length ? (assets ?? []).map((a) => {
          const tech = a.technical_report as { duration_ms?: number; peak_dbfs?: number; rms_dbfs?: number; clipping_ratio?: number; longest_pause_ms?: number; checks?: Record<string, boolean> } | null;
          const rt = a.asr_roundtrip as { wer?: number; cer_accent_insensitive?: number; accent_mismatches?: string[]; provider?: string } | null;
          const current = !a.invalidated_at && a.script_hash === job.script_hash;
          return (
            <div key={a.id} className="locked-item" style={{ display: 'block' }}>
              <div className="row between"><b>{a.id.slice(0, 8)} · {a.provider} · {dateTimeRu(a.created_at)}</b><span className={`status ${a.digital_status === 'AUDIO_VERIFIED_DIGITAL' ? '' : 'wait'}`}>{current ? DIGITAL_STATUS_LABEL[a.digital_status] ?? a.digital_status : `устарело: ${a.invalidated_reason ?? 'сценарий изменён'}`}</span></div>
              <p className="small">Технически: <b>{a.technical_status}</b>{tech ? ` · ${tech.duration_ms} мс · пик ${tech.peak_dbfs} dBFS · RMS ${tech.rms_dbfs} dBFS · клиппинг ${((tech.clipping_ratio ?? 0) * 100).toFixed(3)}% · макс. пауза ${tech.longest_pause_ms} мс` : ''}</p>
              {tech?.checks ? <div className="pill-row">{Object.entries(tech.checks).map(([k, v]) => <span key={k} className={`tag ${v ? 'green' : ''}`}>{k}: {v ? 'ok' : 'нет'}</span>)}</div> : null}
              <p className="small">Статус рендера: <b>{a.render_status}</b> · голоса: {(a.voice_ids as string[] ?? []).map(voiceName).join(', ') || '—'} · кастинг {a.cast_approved ? 'утверждён' : 'не утверждён'}</p>
              <p className="small">ASR round-trip: {rt ? `WER ${rt.wer} · CER ${rt.cer_accent_insensitive}${rt.accent_mismatches?.length ? ` · ударения: ${rt.accent_mismatches.join(', ')}` : ''} (${(rt as { engine?: string }).engine ?? rt.provider ?? ''}) — сигнал, не доказательство произношения` : 'не выполнялся'}</p>
              <p className="small">Права: <b>{a.rights_status}</b>{a.rights_evidence ? ` · ${(a.rights_evidence as { terms_url?: string }).terms_url ?? ''}` : ''}</p>
              <AssetPlayer assetId={a.id} />
              {current ? (
                <div className="stack mt8" style={{ gap: 8 }}>
                  <ListenVerdict assetId={a.id} current={ownerListening(a)} />
                  <div className="row">
                    {a.rights_status !== 'PROVIDER_TERMS_RECORDED' && a.rights_status !== 'DEV_LOCAL_ONLY' ? <RightsForm assetId={a.id} provider={a.provider} /> : null}
                    {rel.has(a.id)
                      ? <ActionButton url="/api/admin/releases/revoke" body={{ expand: 'audio_asset', id: a.id }} label="Отозвать аудио" promptReason="Причина отзыва аудио" variant="flat" />
                      : <AudioReleaseButton assetIds={[a.id]} blockers={audioReleaseBlockers(a, job.script_hash)} label="Выпустить по цифровой политике" policyActive={!!policy} />}
                  </div>
                </div>
              ) : null}
            </div>
          );
        }) : <p className="small quiet">Файлов ещё нет. Реальные записи не подменяются тишиной или заглушками.</p>}
      </div>
    </div>
  );
}
