import { requireOwnerPage } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';
import { llmConfigured, llmInfo } from '@/lib/providers/llm';
import { localAsrHealth, listServiceVoices } from '@/lib/providers/local-engines';
import { asrStatus, ttsStatus } from '@/lib/providers/speech';
import { env } from '@/lib/env';
import { dateTimeRu } from '@/lib/admin/labels';
import { ProviderCheck } from '../_components/ProviderCheck';
import { isoDaysAgo, isoMonthStart } from '@/lib/admin/time';

export const metadata = { title: 'Провайдеры' };

function sum(rows: Array<{ estimated_cost_usd: number | string }> | null) {
  return (rows ?? []).reduce((a, r) => a + Number(r.estimated_cost_usd), 0);
}

export default async function ProvidersPage() {
  await requireOwnerPage();
  const db = adminClient();
  const day = isoDaysAgo(1);
  const monthStart = isoMonthStart();
  const [{ data: today }, { data: month }, { data: lastCheck }, { data: failures }] = await Promise.all([
    db.from('provider_usage').select('estimated_cost_usd').gte('created_at', day),
    db.from('provider_usage').select('estimated_cost_usd, provider, operation').gte('created_at', monthStart),
    db.from('admin_audit_log').select('meta, occurred_at').eq('action', 'providers.check').order('occurred_at', { ascending: false }).limit(1).maybeSingle(),
    db.from('provider_usage').select('provider, operation, created_at').eq('ok', false).gte('created_at', day).order('created_at', { ascending: false }).limit(10),
  ]);
  const llm = llmConfigured();
  const info = llmInfo();
  const asr = asrStatus();
  const tts = ttsStatus();
  const [asrHealth, serviceVoices, llmHealth] = await Promise.all([
    asr.provider === 'local' ? localAsrHealth().catch(() => null) : Promise.resolve(null),
    tts.provider === 'local' ? listServiceVoices().catch(() => []) : Promise.resolve([]),
    info.local && env.llmBaseUrl ? fetch(`${env.llmBaseUrl.replace(/\/$/, '')}/health`, { signal: AbortSignal.timeout(1500), cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null) : Promise.resolve(null),
  ]);
  const byProvider = new Map<string, number>();
  for (const r of month ?? []) byProvider.set(r.provider, (byProvider.get(r.provider) ?? 0) + Number(r.estimated_cost_usd));
  const rows = [
    { name: 'LLM (диалог, AI-проверка)', ok: llm, detail: !llm ? 'ANTHROPIC_API_KEY или LLM_PROVIDER=openai_compatible + LLM_BASE_URL' : env.llmProvider === 'anthropic' ? `Anthropic · диалог ${env.llmModelDialogue} · оценка ${env.llmModelAssessor}` : `${info.label_ru}${info.local ? ` · ${env.llmBaseUrl}${llmHealth ? ` · сервер отвечает (${(llmHealth as { gpu?: string }).gpu ?? 'cpu'})` : ' · сервер НЕ отвечает'}` : ''}`, synthetic: false },
    { name: 'Распознавание речи (ASR)', ok: asr.configured, detail: !asr.configured ? 'ASR_PROVIDER=openai|azure + OPENAI_API_KEY или AZURE_SPEECH_KEY/AZURE_SPEECH_REGION' : asr.provider === 'local' ? `локальный Whisper (sherpa-onnx) · ${asrHealth ? `модели: ${asrHealth.available.join(', ')}` : 'сервис речи НЕ отвечает'} · только разработка` : asr.provider, synthetic: asr.synthetic },
    { name: 'Синтез речи (TTS el-GR)', ok: tts.configured, detail: !tts.configured ? 'TTS_PROVIDER=openai|azure|google + OPENAI_API_KEY / AZURE_SPEECH_KEY+AZURE_SPEECH_REGION / GOOGLE_TTS_API_KEY' : tts.provider === 'local' ? `локальные голоса: ${serviceVoices.filter((v) => v.available).map((v) => v.name).join(', ') || tts.voices.join(', ')} · ученикам — только после выпуска` : `${tts.provider} · голоса: ${tts.voices.join(', ')}`, synthetic: tts.synthetic },
  ];
  const last = lastCheck?.meta as { results?: Record<string, { status?: string }> } | undefined;
  return (
    <div className="admin-section">
      <div className="card cardpad">
        <div className="card-title">Подключения</div>
        <div className="table-wrap"><table className="data-table">
          <thead><tr><th>Сервис</th><th>Статус</th><th>Настройка</th><th>Последняя живая проверка</th></tr></thead>
          <tbody>{rows.map((r, i) => {
            const key = ['llm', 'asr', 'tts'][i];
            const res = last?.results?.[key]?.status;
            return <tr key={r.name}><td><strong>{r.name}</strong></td><td>{r.ok ? <span className="status">{r.synthetic ? 'Синтетический тест' : 'Подключено'}</span> : <span className="status blocked">НЕ ПОДКЛЮЧЕНО / НЕ ПРОВЕРЕНО</span>}</td><td className="tiny"><span className="code">{r.detail}</span></td><td>{res ? `${res} · ${dateTimeRu(lastCheck?.occurred_at)}` : 'не проводилась'}</td></tr>;
          })}</tbody>
        </table></div>
        <p className="tiny muted">Ключи хранятся только в переменных окружения сервера и не передаются в браузер. «Подключено» означает наличие настроек; работоспособность подтверждает только живая проверка ниже. Синтетический тестовый транспорт никогда не используется в production.</p>
        <ProviderCheck />
      </div>
      <div className="admin-top">
        <div className="card admin-stat"><small className="quiet">Расходы за 24 часа (оценка)</small><div className="metric mono">${sum(today).toFixed(2)}</div><span className="tag gray">лимит на ученика ${env.dailyUserBudgetUsd}/день</span></div>
        <div className="card admin-stat"><small className="quiet">Расходы за месяц (оценка)</small><div className="metric mono">${sum(month).toFixed(2)}</div><span className="tag gray">лимит ${env.monthlyBudgetUsd}/мес</span></div>
        <div className="card admin-stat"><small className="quiet">По провайдерам</small><div className="small mt8">{[...byProvider.entries()].map(([p, v]) => <div key={p}>{p}: ${v.toFixed(2)}</div>)}{!byProvider.size ? '—' : null}</div></div>
        <div className="card admin-stat"><small className="quiet">Сбои за 24 часа</small><div className="metric mono">{failures?.length ?? 0}</div><span className="tag gray">{(failures ?? []).slice(0, 2).map((f) => `${f.provider}:${f.operation}`).join(', ') || 'нет'}</span></div>
      </div>
    </div>
  );
}
