import Link from 'next/link';
import { requireLearner } from '@/lib/page';
import { adminClient } from '@/lib/supabase/admin';
import { releaseMap } from '@/lib/content/repo';
import { asrStatus } from '@/lib/providers/speech';
import { env } from '@/lib/env';
import { personaOptions } from '@/lib/speaking/service';
import { llmConfigured } from '@/lib/providers/llm';
import { MODE_LABEL_RU } from '@/lib/speaking/state-machine';
import { Icon } from '@/components/Icon';
import { StartSpeaking } from './StartSpeaking';

export const metadata = { title: 'Разговоры' };

/** The streaming gateway is a separate process; offer live mode only when it answers. */
async function gatewayUp(): Promise<boolean> {
  const base = env.voiceGatewayPublicUrl;
  if (!base || !env.voiceGatewaySecret) return false;
  try {
    const r = await fetch(`${base.replace(/^ws/, 'http').replace(/\/$/, '')}/health`, { signal: AbortSignal.timeout(600), cache: 'no-store' });
    return r.ok;
  } catch {
    return false;
  }
}

export default async function SpeakingPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const u = await requireLearner();
  const sp = await searchParams;
  const db = adminClient();
  const [{ data: scenarios }, { data: recent }] = await Promise.all([
    db.from('speaking_scenarios').select('scenario_id, level, domain, objective_ru, current_hash').order('scenario_id'),
    db.from('speaking_sessions').select('session_id, scenario_id, mode, input_mode, status, started_at, summary_private').eq('user_id', u.userId).order('started_at', { ascending: false }).limit(6),
  ]);
  const rel = await releaseMap('scenario', (scenarios ?? []).map((s) => ({ id: s.scenario_id, hash: s.current_hash })), u);
  const list = (scenarios ?? []).map((s) => ({ id: s.scenario_id, level: s.level ?? '', domain: s.domain ?? '', objective: s.objective_ru ?? '', released: rel.has(s.scenario_id), rg: s.scenario_id.startsWith('RG-') }));
  const voice = asrStatus().configured && !asrStatus().synthetic;
  const personas = await personaOptions();
  const tts = personas.some((p) => p.available);
  const stream = await gatewayUp();
  return (
    <section className="screen active">
      <div className="screen-head"><div><div className="eyebrow">GreekOS / Разговоры</div><h1 className="screen-title">AI Speaking</h1><p className="screen-sub">Живой диалог на греческом по сценариям курса: подсказки по запросу, повтор медленнее, разбор фразы и возврат в ту же сцену.</p></div></div>
      {!voice || !tts || !llmConfigured() ? (
        <div className="banner warn"><Icon name="mic" /><span><strong>Голосовой режим подключён не полностью.</strong> Распознавание: {voice ? 'есть' : 'нет'} · синтез голоса: {tts ? 'есть' : 'нет'} · AI-диалог: {llmConfigured() ? 'есть' : 'нет — переходы по сценарию без оценки'}. Текстовый режим доступен, но не засчитывается как говорение.</span></div>
      ) : <div className="banner info"><Icon name="info" /><span>Голос собеседника синтезирован (цифровой el-GR), это не запись носителя. Ваша речь по умолчанию не сохраняется.</span></div>}
      {voice && !stream ? <div className="banner warn"><Icon name="info" /><span>Живой (потоковый) разговор сейчас недоступен — голосовой шлюз не запущен. Доступен пошаговый режим: запись → проверка → ответ.</span></div> : null}
      <div className="voice-layout">
        <StartSpeaking scenarios={list} isOwner={u.isOwner} voice={voice} stream={stream} personas={personas} defaultMode={(sp.mode as keyof typeof MODE_LABEL_RU) ?? 'roleplay'} modes={MODE_LABEL_RU} />
        <aside className="stack">
          <div className="card cardpad">
            <div className="card-title"><Icon name="clock" /> Недавние разговоры</div>
            {(recent ?? []).length ? (recent ?? []).map((r) => (
              <Link key={r.session_id} className="scenario" href={`/speaking/${r.session_id}`}>
                <Icon name="chat" /><span><b>{r.scenario_id} · {MODE_LABEL_RU[r.mode as keyof typeof MODE_LABEL_RU]}</b><span>{r.status === 'ENDED' ? 'завершён' : 'можно продолжить'} · {r.input_mode === 'voice' ? 'голос' : 'текст'} · {new Date(r.started_at).toLocaleDateString('ru-RU')}</span></span>
              </Link>
            )) : <p className="small quiet">Здесь появятся ваши разговоры. Их можно продолжить на другом устройстве.</p>}
          </div>
          <div className="card cardpad">
            <div className="card-title"><Icon name="info" /> Как оценивается</div>
            <p className="small quiet">Сначала коммуникативный результат, потом форма: 1–3 исправления после разговора. Неуверенное распознавание — повтор, а не ошибка. Произношение по тексту не оценивается.</p>
          </div>
        </aside>
      </div>
    </section>
  );
}
