// GreekOS ops — can Azure Speech score pronunciation for Modern Greek on this resource?
// Synthesises one short Greek sentence with Azure TTS, sends it to the short-audio REST recogniser with the
// Pronunciation-Assessment header, and prints what came back. A control request does the same for en-US.
// Uses the free F0 quota (a few seconds of audio); prints no key.
const key = process.env.AZURE_SPEECH_KEY;
const region = process.env.AZURE_SPEECH_REGION || 'northeurope';
if (!key) { console.error('AZURE_SPEECH_KEY missing'); process.exit(2); }

async function tts(text, lang, voice) {
  const ssml = `<speak version="1.0" xml:lang="${lang}"><voice name="${voice}">${text}</voice></speak>`;
  const r = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: 'POST', body: ssml,
    headers: { 'Ocp-Apim-Subscription-Key': key, 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'riff-16khz-16bit-mono-pcm', 'User-Agent': 'greekos-ops' },
  });
  if (!r.ok) throw new Error(`TTS ${lang} HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return new Uint8Array(await r.arrayBuffer());
}

async function assess(wav, lang, reference) {
  const pa = Buffer.from(JSON.stringify({ ReferenceText: reference, GradingSystem: 'HundredMark', Granularity: 'Phoneme', Dimension: 'Comprehensive', EnableMiscue: true })).toString('base64');
  const t0 = Date.now();
  const r = await fetch(`https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=${lang}&format=detailed`, {
    method: 'POST', body: wav,
    headers: { 'Ocp-Apim-Subscription-Key': key, 'Content-Type': 'audio/wav; codecs=audio/pcm; samplerate=16000', Accept: 'application/json', 'Pronunciation-Assessment': pa },
  });
  const body = await r.text();
  let j = null; try { j = JSON.parse(body); } catch { /* not json */ }
  const best = j?.NBest?.[0];
  console.log(JSON.stringify({
    lang, http: r.status, ms: Date.now() - t0, recognition: j?.RecognitionStatus ?? null, display: j?.DisplayText ?? null,
    confidence: best?.Confidence ?? null,
    pronunciation: best?.PronunciationAssessment ?? (best && 'AccuracyScore' in best ? { AccuracyScore: best.AccuracyScore, FluencyScore: best.FluencyScore, CompletenessScore: best.CompletenessScore, PronScore: best.PronScore } : null),
    words: (best?.Words ?? []).slice(0, 6).map((w) => ({ w: w.Word, acc: w.PronunciationAssessment?.AccuracyScore ?? w.AccuracyScore ?? null, err: w.PronunciationAssessment?.ErrorType ?? w.ErrorType ?? null, phonemes: (w.Phonemes ?? []).length })),
    error: r.ok ? null : body.slice(0, 300),
  }));
}

const el = 'Καλημέρα, θέλω ένα κιλό ντομάτες.';
const en = 'Good morning, I would like a kilo of tomatoes.';
await assess(await tts(el, 'el-GR', 'el-GR-AthinaNeural'), 'el-GR', el);
await assess(await tts(en, 'en-US', 'en-US-JennyNeural'), 'en-US', en);
