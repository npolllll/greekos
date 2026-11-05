/**
 * Renders the v5.4 Markdown reports from the measured JSON evidence in reports/v5.4:
 * VOICE_PROVIDER_BENCHMARK.md and ASR_ERROR_ANALYSIS.md. Word error rates are recomputed with the
 * current round-trip rules (numeral normalisation) from the stored transcripts — no new numbers
 * are invented here.  npx tsx scripts/voice-reports.ts [--dir reports/v5.4]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { roundTrip, alignmentDiff } from '../src/lib/audio/roundtrip.ts';

const i = process.argv.indexOf('--dir');
const dir = resolve(i > 0 ? process.argv[i + 1] : 'reports/v5.4');
const read = <T,>(f: string): T | null => (existsSync(join(dir, f)) ? (JSON.parse(readFileSync(join(dir, f), 'utf8')) as T) : null);
const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);
const pct = (v: number[], p: number) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)] : null; };
const f2 = (x: number | null | undefined, d = 2) => (x == null ? '—' : x.toFixed(d));
const sec = (ms: number | null | undefined) => (ms == null ? '—' : `${(ms / 1000).toFixed(2)} с`);

interface BenchRow { voice_id: string; phrase_id: string; speed: string; synth_ms: number; duration_ms: number | null; rtf: number | null; technical_pass: boolean | null; speech_rate_syll_per_s: number | null; rate_flag: string | null; truncated_end: boolean | null; asr_text: string | null; wer: number | null; cer: number | null; error: string | null }
interface Bench { generated_at: string; asr_engine: string | null; phrases: Array<{ id: string; text: string; focus: string }>; summary: Array<Record<string, unknown>>; rows: BenchRow[]; cloud_providers: Record<string, string> }
interface LiveRow { scenario: string; level: string; class: string; reference: string; transcript: string; confidence: number | null; needs_confirmation: boolean; confirm_reason: string | null; split_into_finals: number; wer: number | null; cer: number | null; client_end_of_speech_to_first_chunk_ms: number | null; gateway: Record<string, number | boolean | null> | null }
interface Live { generated_at: string; label: string; environment: Record<string, unknown>; slo_pilot: Record<string, unknown>; turns: number; end_of_speech_to_first_audio_ms: { p50: number | null; p95: number | null; max: number | null; note: string }; components_ms: Record<string, { p50: number | null; p95: number | null }>; rows: LiveRow[] }

const bench = read<Bench>('VOICE_PROVIDER_BENCHMARK.json');
const live = read<Live>('LIVE_SPEAKING_LATENCY.json');

if (bench) {
  const text = new Map(bench.phrases.map((p) => [p.id, p]));
  for (const r of bench.rows) if (r.asr_text != null) { const m = roundTrip(text.get(r.phrase_id)!.text, r.asr_text); r.wer = m.wer; r.cer = m.cer_accent_insensitive; }
  writeFileSync(join(dir, 'VOICE_PROVIDER_BENCHMARK.json'), JSON.stringify(bench, null, 2));
  const L: string[] = [];
  L.push('# Бенчмарк голосов (v5.4)', '', `Сформировано: ${bench.generated_at}. Измерено на этой машине; ASR для проверки: ${bench.asr_engine ?? 'нет'}.`, '');
  L.push('| Провайдер | Статус |', '|---|---|');
  for (const [k, v] of Object.entries(bench.cloud_providers)) L.push(`| ${k} | ${v} |`);
  L.push('| local_macos | ПРОТЕСТИРОВАНО локально (ниже) — права только для разработки |', '');
  for (const v of bench.summary) {
    const rows = bench.rows.filter((r) => r.voice_id === v.voice_id && !r.error);
    const by = (s: string) => rows.filter((r) => r.speed === s);
    L.push(`## ${v.voice_id}`, '', `Пол: **${v.presentation}** (${v.presentation_source}); качество: ${v.quality_tier ?? '—'}; распространение ученикам: ${v.distribution_allowed ? 'разрешено' : '**запрещено (DEV_LOCAL_ONLY)**'}.`, '');
    L.push('| Скорость | Фраз | Синтез p50 | RTF p50 | Темп, слог/с (ср.) | Тех. проверка | Обрыв конца | WER ср. (ASR) | CER ср. |', '|---|---|---|---|---|---|---|---|---|');
    for (const s of ['normal', 'slow', 'fast']) {
      const r = by(s);
      if (!r.length) continue;
      L.push(`| ${s} | ${r.length} | ${pct(r.map((x) => x.synth_ms), 0.5)} мс | ${f2(pct(r.filter((x) => x.rtf != null).map((x) => x.rtf!), 0.5), 3)} | ${f2(mean(r.filter((x) => x.speech_rate_syll_per_s != null).map((x) => x.speech_rate_syll_per_s!)))} | ${r.filter((x) => x.technical_pass).length}/${r.length} | ${r.filter((x) => x.truncated_end).length} | ${f2(mean(r.filter((x) => x.wer != null).map((x) => x.wer!)), 3)} | ${f2(mean(r.filter((x) => x.cer != null).map((x) => x.cer!)), 3)} |`);
    }
    const worst = by('normal').filter((x) => (x.wer ?? 0) > 0).sort((a, b) => (b.wer ?? 0) - (a.wer ?? 0)).slice(0, 8);
    if (worst.length) {
      L.push('', 'Фразы с расхождением ASR (сигнал для прослушивания, не вердикт о произношении):', '', '| Фраза | Фокус | Эталон | ASR | WER |', '|---|---|---|---|---|');
      for (const w of worst) { const p = text.get(w.phrase_id)!; L.push(`| ${w.phrase_id} | ${p.focus} | ${p.text} | ${w.asr_text} | ${f2(w.wer, 2)} |`); }
    }
    L.push('');
  }
  L.push('## Что это не доказывает', '', '- Естественность темпа и интонации подтверждает только прослушивание владельцем (V04: HUMAN_OWNER_LISTEN — **NOT_TESTED**).', '- ASR round-trip не измеряет правильность произношения; совпадение текста ≠ фонетическая корректность.', '- Мужского греческого голоса локально нет: V02 — **BLOCKED_EXTERNAL** (нужен облачный TTS).', '');
  writeFileSync(join(dir, 'VOICE_PROVIDER_BENCHMARK.md'), L.join('\n'));
}

if (live) {
  for (const r of live.rows) if (r.transcript) { const m = roundTrip(r.reference, r.transcript); r.wer = m.wer; r.cer = m.cer_accent_insensitive; }
  writeFileSync(join(dir, 'LIVE_SPEAKING_LATENCY.json'), JSON.stringify(live, null, 2));
  const L: string[] = [];
  L.push('# Анализ распознавания речи (ASR) — v5.4', '', `Сформировано: ${live.generated_at}. **${live.label}.**`, '');
  L.push('Классы тестов (§6): (a) чистая речь, (b) тихая речь −20 дБ + фоновый шум (SNR ≈ 15 дБ), (c) колебания: паузы 800 мс внутри реплики. Речь — синтетические клипы ответов из самих сценариев (голос Melina), поток в реальном времени через настоящий шлюз; распознавание — локальный Whisper small.', '');
  L.push('| Класс | Реплик | WER ср. | CER ср. | «Это вы сказали?» | Реплика разорвана VAD | Задержка p50 / p95 |', '|---|---|---|---|---|---|---|');
  for (const c of ['clean', 'quiet_noise', 'hesitant']) {
    const r = live.rows.filter((x) => x.class === c);
    const lat = r.map((x) => x.client_end_of_speech_to_first_chunk_ms).filter((x): x is number => typeof x === 'number');
    L.push(`| ${c} | ${r.length} | ${f2(mean(r.filter((x) => x.wer != null).map((x) => x.wer!)), 3)} | ${f2(mean(r.filter((x) => x.cer != null).map((x) => x.cer!)), 3)} | ${r.filter((x) => x.needs_confirmation).length} | ${r.filter((x) => x.split_into_finals > 1).length} | ${sec(pct(lat, 0.5))} / ${sec(pct(lat, 0.95))} |`);
  }
  L.push('', '## Ошибки распознавания (все реплики с расхождением)', '', '| Сценарий | Класс | Эталон | Распознано | WER | Уверенность | Подтверждение |', '|---|---|---|---|---|---|---|');
  for (const r of live.rows.filter((x) => (x.wer ?? 0) > 0)) L.push(`| ${r.scenario} ${r.level} | ${r.class} | ${r.reference} | ${r.transcript || '(пусто)'} | ${f2(r.wer, 2)} | ${f2(r.confidence, 2)} | ${r.needs_confirmation ? `да (${r.confirm_reason})` : 'нет'} |`);
  const diffs = live.rows.filter((x) => x.transcript).map((x) => alignmentDiff(x.reference, x.transcript));
  const missing = new Map<string, number>();
  for (const d of diffs) for (const w of d.missing) missing.set(w, (missing.get(w) ?? 0) + 1);
  L.push('', '## Частые пропуски/замены слов', '', [...missing.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([w, n]) => `«${w}» ×${n}`).join(', ') || '—', '');
  L.push('## Выводы и ограничения', '',
    '- Неуверенное или подозрительное распознавание не штрафуется: показывается «Это вы сказали?» (подтвердить / исправить / сказать заново).',
    '- Синтетический голос — «идеальный» диктор: реальные ученики (акцент, ошибки, тихий микрофон) дадут больше ошибок. **R01 (30 живых реплик) — NOT_TESTED**: нужен пилот с учениками.',
    '- Облачные ASR (OpenAI/Azure) — NOT_TESTED / BLOCKED_EXTERNAL (ключи не подключались по решению владельца).',
    '- Оценка произношения из WER/уверенности не выводится (§6).', '');
  writeFileSync(join(dir, 'ASR_ERROR_ANALYSIS.md'), L.join('\n'));
}
console.log(JSON.stringify({ dir, benchmark: !!bench, live: !!live }));
