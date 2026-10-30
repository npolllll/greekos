import Link from 'next/link';
import { requireOwnerPage } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';
import { ttsStatus, asrStatus } from '@/lib/providers/speech';
import { DIGITAL_STATUS_LABEL } from '@/lib/admin/labels';
import { verifiedAudioCount } from '@/lib/admin/data';
import { loadCastingContext } from '@/lib/audio/pipeline';
import { Icon } from '@/components/Icon';
import { AssetPlayer, AudioReleaseButton } from '../_components/AudioControls';
import { audioReleaseBlockers, ownerListening } from '@/lib/qa/audio-release';
import { activePolicy } from '@/lib/admin/releases';

export const metadata = { title: 'Аудио' };

type Bucket = 'verified' | 'review' | 'blocked' | 'missing';
const BUCKET_RU: Record<Bucket, string> = { verified: 'Цифровая проверка пройдена', review: 'Нужен разбор', blocked: 'Заблокировано кастингом', missing: 'Нет файла' };
const JOB_STATUS_RU: Record<string, string> = {
  DIGITAL_REVIEWED: 'проверено распознаванием', TECH_QA_PASS: 'технически ок, нужен разбор', TECH_QA_FAIL: 'технический брак', RENDER_FAILED: 'ошибка рендера',
  BLOCKED_NO_SUITABLE_VOICE: 'нет голоса нужного пола', BLOCKED_MISSING_VOICE_METADATA: 'роль без пола — нужен кастинг', AUDIO_PENDING: 'ждёт рендера',
};

interface Seg { segment_id: string; voice_id: string; pass: boolean; cer_phonetic?: number }

export default async function AudioPage({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  await requireOwnerPage();
  const f = (await searchParams).f as Bucket | undefined;
  const db = adminClient();
  const [{ data: jobs }, { data: assets }, { data: statuses }, counts, ctx] = await Promise.all([
    db.from('audio_jobs').select('audio_id, priority, segments, text_el, script_hash').order('audio_id'),
    db.from('audio_assets').select('id, audio_id, script_hash, sha256, technical_status, digital_status, rights_status, voice_ids, duration_ms, asr_roundtrip, cast_approved, invalidated_at, history, created_at').is('invalidated_at', null).order('created_at', { ascending: false }),
    db.from('audio_job_render_status').select('audio_id, status, reason'),
    verifiedAudioCount(),
    loadCastingContext(),
  ]);
  const tts = ttsStatus();
  const asr = asrStatus();
  const policy = await activePolicy();
  const statusOf = new Map((statuses ?? []).map((s) => [s.audio_id, s]));
  const rows = (jobs ?? []).map((j) => {
    const latest = (assets ?? []).find((a) => a.audio_id === j.audio_id && a.script_hash === j.script_hash) ?? null;
    const st = statusOf.get(j.audio_id);
    const segs = ((latest?.asr_roundtrip as { segments?: Seg[] } | null)?.segments ?? []);
    const bucket: Bucket = st?.status?.startsWith('BLOCKED') && !latest ? 'blocked' : !latest ? 'missing' : latest.digital_status === 'AUDIO_VERIFIED_DIGITAL' ? 'verified' : 'review';
    const voices = ((latest?.voice_ids as string[] | null) ?? []).map((id) => ctx.voices.get(id)?.display_name?.split(' · ')[0] ?? id);
    const blockers = latest ? audioReleaseBlockers(latest as Parameters<typeof audioReleaseBlockers>[0], j.script_hash) : ['нет файла'];
    return { j, latest, st, segs, bucket, voices, blockers, listened: latest ? ownerListening(latest as Parameters<typeof ownerListening>[0]) : null };
  });
  const eligible = rows.filter((r) => r.latest && !r.blockers.length).map((r) => r.latest!.id);
  const byBucket = rows.reduce<Record<string, number>>((a, r) => ({ ...a, [r.bucket]: (a[r.bucket] ?? 0) + 1 }), {});
  const shown = f ? rows.filter((r) => r.bucket === f) : rows;
  const failingByVoice = new Map<string, { pass: number; fail: number }>();
  for (const r of rows) for (const s of r.segs) { const k = ctx.voices.get(s.voice_id)?.display_name ?? s.voice_id; const c = failingByVoice.get(k) ?? { pass: 0, fail: 0 }; c[s.pass ? 'pass' : 'fail'] += 1; failingByVoice.set(k, c); }

  return (
    <div className="admin-section">
      <div className="admin-top">
        <div className="card admin-stat"><small className="quiet">Заданий на аудио</small><div className="metric mono">{counts.jobs}</div><small className="quiet">с файлом: {counts.jobs - (byBucket.missing ?? 0) - (byBucket.blocked ?? 0)}</small></div>
        <div className="card admin-stat"><small className="quiet">Цифровая проверка пройдена</small><div className="metric mono">{byBucket.verified ?? 0}</div><small className="quiet">все сегменты прошли распознавание</small></div>
        <div className="card admin-stat"><small className="quiet">Выпущено для учеников</small><div className="metric mono">{counts.released}</div>{counts.released ? <span className="tag green">синтез, не носитель</span> : <span className="tag">не выпущено</span>}</div>
        <div className="card admin-stat"><small className="quiet">Движки</small><div className="metric" style={{ fontSize: 15 }}>Синтез: {tts.configured ? (tts.provider === 'local' ? 'локальный' : tts.provider) : 'нет'} · Распознавание: {asr.configured ? (asr.provider === 'local' ? 'локальный Whisper' : asr.provider) : 'нет'}</div>{tts.synthetic || asr.synthetic ? <span className="tag">тестовый транспорт</span> : null}</div>
      </div>
      <div className="banner info"><Icon name="info" /><span><strong>Как читать статусы.</strong> «Цифровая проверка пройдена» — файл технически исправен и каждый сегмент распознан близко к сценарию (Whisper, фонетическое сравнение). Это не проверка носителем и не оценка естественности: прослушайте файл перед выпуском. Мужские голоса MBROLA — только для разработки (лицензия), выпуск ученикам с ними невозможен.</span></div>
      {failingByVoice.size ? (
        <div className="card cardpad">
          <div className="card-title"><Icon name="volume" /> Сегменты по голосам</div>
          <div className="pill-row mt8">{[...failingByVoice.entries()].map(([v, c]) => <span key={v} className={`tag ${c.fail / Math.max(1, c.pass + c.fail) > 0.3 ? '' : 'green'}`}>{v}: прошло {c.pass} из {c.pass + c.fail}</span>)}</div>
        </div>
      ) : null}
      <div className="card cardpad">
        <div className="card-top"><div className="card-title">Очередь аудио</div><span className="row"><AudioReleaseButton assetIds={eligible} blockers={eligible.length ? [] : ['нет файлов, готовых к выпуску (нужны: цифровая проверка, записанные права, утверждённый кастинг и прослушивание владельцем)']} label={`Выпустить готовые (${eligible.length})`} policyActive={!!policy} /><span className="tag gray">{shown.length}</span></span></div>
        <div className="chip-row" style={{ marginBottom: 12 }}>
          <Link className={`chip ${!f ? 'active' : ''}`} href="/admin/audio">Все {rows.length}</Link>
          {(Object.keys(BUCKET_RU) as Bucket[]).map((b) => <Link key={b} className={`chip ${f === b ? 'active' : ''}`} href={`/admin/audio?f=${b}`}>{BUCKET_RU[b]} {byBucket[b] ?? 0}</Link>)}
        </div>
        <div className="table-wrap"><table className="data-table">
          <thead><tr><th>Аудио</th><th>Голоса</th><th>Сегменты</th><th>Длит.</th><th>Статус</th><th>Права</th><th>Владелец</th><th style={{ minWidth: 220 }}>Прослушать</th></tr></thead>
          <tbody>{shown.map(({ j, latest, st, segs, voices, listened }) => (
            <tr key={j.audio_id}>
              <td><Link href={`/admin/audio/${encodeURIComponent(j.audio_id)}`}><strong>{j.audio_id}</strong></Link>{j.priority ? <div className="tiny quiet">приоритет {j.priority}</div> : null}</td>
              <td className="tiny">{voices.join(', ') || '—'}</td>
              <td className="mono tiny">{segs.length ? `${segs.filter((s) => s.pass).length}/${segs.length}` : (Array.isArray(j.segments) ? (j.segments as unknown[]).length : 1)}</td>
              <td className="mono tiny">{latest?.duration_ms ? `${(latest.duration_ms / 1000).toFixed(1)} с` : '—'}</td>
              <td>{latest ? <span className={`status ${latest.digital_status === 'AUDIO_VERIFIED_DIGITAL' ? '' : 'wait'}`}>{DIGITAL_STATUS_LABEL[latest.digital_status] ?? latest.digital_status}</span> : <span className="tiny quiet">{JOB_STATUS_RU[st?.status ?? ''] ?? st?.status ?? 'нет файла'}</span>}{st?.reason && !latest ? <div className="tiny quiet">{st.reason}</div> : null}</td>
              <td className="tiny">{latest ? (latest.rights_status === 'DEV_LOCAL_ONLY' ? 'только разработка' : latest.rights_status === 'PROVIDER_TERMS_RECORDED' ? 'записаны' : 'не записаны') : '—'}</td>
              <td className="tiny">{listened ? (listened.decision === 'OK' ? 'прослушано: ОК' : 'проблема') : latest ? 'не слушал' : '—'}</td>
              <td>{latest ? <AssetPlayer assetId={latest.id} /> : null}</td>
            </tr>
          ))}</tbody>
        </table></div>
        <p className="tiny muted">Все аудио — цифровой синтез el-GR. Статус «проверено носителем» системой не присваивается.</p>
      </div>
    </div>
  );
}
