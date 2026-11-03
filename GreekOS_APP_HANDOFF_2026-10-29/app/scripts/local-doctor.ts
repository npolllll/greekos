/**
 * What is actually running on this machine: database, model server (model, GPU backend, KV-cache
 * reuse, flash attention, threads), qualification of the model, speech service (ASR provider, TTS
 * device, voices), voice gateway. On Apple Silicon it says whether Metal / CoreML / MPS are really in
 * use — the acceleration is reported by the services themselves, not assumed.
 *
 *   npm run local:doctor
 */
import os from 'node:os';
import { env } from '../src/lib/env.ts';
import { qualificationOf } from '../src/lib/speaking/qualification.ts';
import { llmInfo } from '../src/lib/providers/llm.ts';
import { localAsrUrl } from '../src/lib/providers/local-engines.ts';

const ok = (b: boolean) => (b ? '✓' : '✗');
const get = async (url: string) => { try { const r = await fetch(url, { signal: AbortSignal.timeout(3000) }); return r.ok ? await r.json() : null; } catch { return null; } };
const apple = os.platform() === 'darwin' && os.arch() === 'arm64';

async function main() {
  const lines: string[] = [];
  lines.push(`Машина: ${os.cpus()[0]?.model ?? 'cpu'} × ${os.cpus().length}, ${Math.round(os.totalmem() / 2 ** 30)} ГБ, ${os.platform()}/${os.arch()}${apple ? ' (Apple Silicon)' : ''}`);
  const db = await get(`${env.supabaseUrl.replace(/\/$/, '')}/auth/v1/health`) ?? await fetch(`${env.supabaseUrl}/rest/v1/`, { signal: AbortSignal.timeout(3000) }).then((r) => ({ status: r.status })).catch(() => null);
  lines.push(`${ok(!!db)} База Supabase: ${env.supabaseUrl}`);
  const llm = env.llmBaseUrl ? await get(`${env.llmBaseUrl.replace(/\/$/, '')}/health`) : null;
  if (llm) {
    lines.push(`${ok(true)} Модель: ${llm.model} · бэкенд ${llm.gpu}${apple && llm.gpu !== 'metal' ? ' ✗ ожидался Metal' : ''} · потоков ${llm.threads} · слотов ${llm.slots} · KV-кэш ${llm.kv_reuse ? 'переиспользуется' : 'НЕ переиспользуется'} · flash attention ${llm.flash_attention ? 'вкл' : 'выкл'}`);
  } else lines.push(`${ok(false)} Модель: сервер не отвечает (${env.llmBaseUrl ?? 'LLM_BASE_URL не задан'}) — npm run local:llm`);
  const q = qualificationOf(llmInfo().model ?? '');
  lines.push(`${ok(!!q?.passed)} Квалификация модели для разговора: ${q ? `${q.passed ? 'пройдена' : 'НЕ пройдена'} (${q.cases} случаев, ${q.evaluated_at?.slice(0, 10)})` : 'нет записи — npm run speaking:eval'}`);
  const sp = await get(`${localAsrUrl().replace(/\/$/, '')}/health`);
  if (sp) {
    const asrAccel = sp.asr?.provider ?? 'cpu';
    lines.push(`${ok(true)} Речь: ASR ${(sp.asr?.loaded ?? []).join(', ') || '—'} на ${asrAccel}${apple && asrAccel !== 'coreml' ? ' ✗ ожидался CoreML' : ''} · TTS на ${sp.tts_device}${apple && sp.tts_device !== 'mps' ? ' (MPS недоступен — CPU)' : ''} · голоса: ${(sp.voices ?? []).join(', ')}`);
  } else lines.push(`${ok(false)} Речь: сервис не отвечает (${localAsrUrl()}) — npm run local:speech`);
  const gwUrl = (env.voiceGatewayPublicUrl ?? 'ws://127.0.0.1:3311/v1/stream').replace(/^ws/, 'http').replace(/\/v1\/stream$/, '');
  const gw = await get(`${gwUrl}/health`);
  lines.push(`${ok(!!gw)} Голосовой шлюз: ${gw ? `${gw.protocol}, сессий ${gw.sessions}` : 'не отвечает — npm run voice:gateway'}`);
  lines.push('', 'Задержку на этой машине измеряет: npm run speaking:latency (сцена SC05, отчёт в reports/v7/speaking-latency).');
  console.log(lines.join('\n'));
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
