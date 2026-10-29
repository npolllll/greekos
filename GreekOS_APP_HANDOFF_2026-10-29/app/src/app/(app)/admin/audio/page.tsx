import Link from 'next/link';
import { requireOwnerPage } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';
import { ttsStatus, asrStatus } from '@/lib/providers/speech';
import { DIGITAL_STATUS_LABEL } from '@/lib/admin/labels';
import { verifiedAudioCount } from '@/lib/admin/data';

export const metadata = { title: 'Аудио' };

export default async function AudioPage() {
  await requireOwnerPage();
  const db = adminClient();
  const [{ data: jobs }, { data: assets }, counts] = await Promise.all([
    db.from('audio_jobs').select('audio_id, priority, segments, text_el, status, script_hash').order('audio_id'),
    db.from('audio_assets').select('id, audio_id, script_hash, technical_status, digital_status, rights_status, invalidated_at, created_at').order('created_at', { ascending: false }),
    verifiedAudioCount(),
  ]);
  const tts = ttsStatus();
  const asr = asrStatus();
  return (
    <div className="admin-section">
      <div className="admin-top">
        <div className="card admin-stat"><small className="quiet">Заданий на аудио</small><div className="metric mono">{counts.jobs}</div><span className="tag gray">AUDIO_EXECUTION_PACK</span></div>
        <div className="card admin-stat"><small className="quiet">Цифровая проверка пройдена</small><div className="metric mono">{counts.verified}</div><span className="tag gray">ASR round-trip + технический QA</span></div>
        <div className="card admin-stat"><small className="quiet">Выпущено для учеников</small><div className="metric mono">{counts.released}</div>{counts.released ? <span className="tag green">синтез, не носитель</span> : <span className="tag">Не готово к публикации</span>}</div>
        <div className="card admin-stat"><small className="quiet">Провайдеры</small><div className="metric" style={{ fontSize: 15 }}>TTS: {tts.configured ? tts.provider : 'нет'} · ASR: {asr.configured ? asr.provider : 'нет'}</div>{tts.synthetic || asr.synthetic ? <span className="tag">синтетический тестовый транспорт</span> : null}</div>
      </div>
      {!tts.configured ? <div className="banner warn"><span><strong>Синтез речи не подключён.</strong> Задайте <span className="code">TTS_PROVIDER=openai|azure|google</span> и ключ (<span className="code">OPENAI_API_KEY</span> / <span className="code">AZURE_SPEECH_KEY</span> + <span className="code">AZURE_SPEECH_REGION</span> / <span className="code">GOOGLE_TTS_API_KEY</span>). Для статуса «цифровая проверка пройдена» также нужен ASR (<span className="code">ASR_PROVIDER=openai|azure</span>).</span></div> : null}
      <div className="card cardpad">
        <div className="card-title">Очередь аудио</div>
        <div className="table-wrap"><table className="data-table">
          <thead><tr><th>Аудио</th><th>Приоритет</th><th>Сегменты</th><th>Символов</th><th>Последний файл</th><th>Права</th></tr></thead>
          <tbody>{(jobs ?? []).map((j) => {
            const latest = (assets ?? []).find((a) => a.audio_id === j.audio_id && !a.invalidated_at && a.script_hash === j.script_hash);
            const segs = (j.segments as Array<{ text_el?: string; text?: string }>) ?? [];
            const chars = segs.length ? segs.reduce((a, s) => a + ((s.text_el ?? s.text)?.length ?? 0), 0) : (j.text_el ?? '').length;
            return (
              <tr key={j.audio_id}>
                <td><Link href={`/admin/audio/${encodeURIComponent(j.audio_id)}`}><strong>{j.audio_id}</strong></Link></td>
                <td>{j.priority ?? '—'}</td>
                <td className="mono">{segs.length || 1}</td>
                <td className="mono">{chars}</td>
                <td>{latest ? `${latest.technical_status} · ${DIGITAL_STATUS_LABEL[latest.digital_status] ?? latest.digital_status}` : <span className="tiny muted">нет файла</span>}</td>
                <td>{latest ? latest.rights_status : '—'}</td>
              </tr>
            );
          })}</tbody>
        </table></div>
        <p className="tiny muted">Все аудио — цифровой синтез el-GR. Статус HUMAN_AUDIO_VERIFIED системой не присваивается.</p>
      </div>
    </div>
  );
}
