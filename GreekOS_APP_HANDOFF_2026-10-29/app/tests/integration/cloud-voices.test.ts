import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { admin } from './helpers';
import { buildWav, parseWav } from '@/lib/audio/wav';
import { loadCatalog, proposeCastVoices, syncCloudVoices } from '@/lib/voice/catalog';
import { synthesizeWithVoice } from '@/lib/providers/speech';
import { loadCastingContext, planJob, renderJob } from '@/lib/audio/pipeline';
import { normalizeAudioJob } from '@/lib/admin/audio';

/**
 * Quality cloud voices (contract test). A local server speaks the Azure Speech and Google Cloud TTS
 * HTTP protocols (voice lists, SSML / JSON synthesis, WAV / base64 LINEAR16 answers); the app is
 * pointed at it through the same endpoint settings a deployment uses. Checks that a key alone turns
 * the dialogues blocked for lack of voices (two women; four speakers) into plannable jobs with
 * distinct male and female voices, that multilingual voices speak Greek inside <lang>, that native
 * Greek voices are preferred, and that cloud renders wait for the owner's provider terms instead of
 * being marked development-only. Local data (cast roles, catalog, job status, usage) is restored.
 */

const AZURE_KEY = 'contract-azure-key';
const GOOGLE_KEY = 'contract-google-key';
const AZURE_VOICES = [
  { ShortName: 'el-GR-AthinaNeural', DisplayName: 'Athina', Locale: 'el-GR', Gender: 'Female', VoiceType: 'Neural' },
  { ShortName: 'el-GR-NestorasNeural', DisplayName: 'Nestoras', Locale: 'el-GR', Gender: 'Male', VoiceType: 'Neural' },
  { ShortName: 'en-US-AvaMultilingualNeural', DisplayName: 'Ava Multilingual', Locale: 'en-US', Gender: 'Female', VoiceType: 'Neural', SecondaryLocaleList: ['de-DE', 'el-GR', 'fr-FR'] },
  { ShortName: 'en-US-AndrewMultilingualNeural', DisplayName: 'Andrew Multilingual', Locale: 'en-US', Gender: 'Male', VoiceType: 'Neural', SecondaryLocaleList: ['el-GR', 'it-IT'] },
  // Neither Greek nor multilingual with Greek: must not enter the catalog.
  { ShortName: 'en-US-JennyNeural', DisplayName: 'Jenny', Locale: 'en-US', Gender: 'Female', VoiceType: 'Neural' },
];
const GOOGLE_VOICES = [
  { name: 'el-GR-Standard-A', ssmlGender: 'FEMALE', languageCodes: ['el-GR'] },
  { name: 'el-GR-Wavenet-A', ssmlGender: 'FEMALE', languageCodes: ['el-GR'] },
  { name: 'el-GR-Chirp3-HD-Charon', ssmlGender: 'MALE', languageCodes: ['el-GR'] },
];
// Dialogues blocked locally: two women (Άννα, Λένα), four speakers (two women, two men), etc.
const BLOCKED_JOBS = ['U-A1-002-AUD01', 'KEG-B2-L01-AUD2', 'KEG-B2-L02-AUD2', 'KEG-B2-L03-AUD2', 'U-B2-001-AUD01', 'U-B2-015-AUD01', 'U-B2-015-AUD02', 'U-B2-015-AUD03'];

interface Seen { method: string; path: string; headers: IncomingMessage['headers']; body: string }
const seen: Seen[] = [];
let server: Server;
let base = '';
const started = new Date().toISOString();
const ENV_KEYS = ['AZURE_SPEECH_KEY', 'AZURE_SPEECH_REGION', 'AZURE_SPEECH_TTS_URL', 'GOOGLE_TTS_API_KEY', 'GOOGLE_TTS_URL', 'APP_ENV'] as const;
const envBefore: Record<string, string | undefined> = {};
const restore: { castRoles: unknown[]; voiceIds: Set<string>; status: Record<string, unknown> | null; assets: string[]; created: string[] } = { castRoles: [], voiceIds: new Set(), status: null, assets: [], created: [] };

/** 0.7 s of a voiced-like tone at 24 kHz (what the providers return for riff-24khz-16bit-mono-pcm / LINEAR16). */
function toneWav(freq: number): Uint8Array {
  const rate = 24_000;
  const n = Math.round(rate * 0.7);
  const s = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const env = Math.min(1, i / 1200, (n - i) / 1200);
    s[i] = Math.round(9000 * env * (Math.sin((2 * Math.PI * freq * i) / rate) + 0.3 * Math.sin((4 * Math.PI * freq * i) / rate)));
  }
  return buildWav(s, rate);
}

const readBody = (req: IncomingMessage) => new Promise<string>((res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => res(b)); });

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const body = await readBody(req);
    seen.push({ method: req.method ?? '', path: url.pathname + url.search, headers: req.headers, body });
    const json = (code: number, v: unknown) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(v)); };
    if (url.pathname.startsWith('/azure/')) {
      if (req.headers['ocp-apim-subscription-key'] !== AZURE_KEY) return json(401, { error: 'bad key' });
      if (req.method === 'GET' && url.pathname === '/azure/cognitiveservices/voices/list') return json(200, AZURE_VOICES);
      if (req.method === 'POST' && url.pathname === '/azure/cognitiveservices/v1') {
        if (req.headers['content-type'] !== 'application/ssml+xml' || req.headers['x-microsoft-outputformat'] !== 'riff-24khz-16bit-mono-pcm') return json(400, { error: 'format' });
        const voice = /<voice name="([^"]+)"/.exec(body)?.[1] ?? '';
        res.writeHead(200, { 'Content-Type': 'audio/wav' });
        return res.end(toneWav(voice.includes('Nestoras') || voice.includes('Andrew') ? 140 : 220));
      }
    }
    if (url.pathname.startsWith('/google/')) {
      if (url.searchParams.get('key') !== GOOGLE_KEY) return json(403, { error: { message: 'API key not valid' } });
      if (req.method === 'GET' && url.pathname === '/google/v1/voices') return json(200, { voices: url.searchParams.get('languageCode') === 'el-GR' ? GOOGLE_VOICES : [] });
      if (req.method === 'POST' && url.pathname === '/google/v1/text:synthesize') {
        const j = JSON.parse(body) as { audioConfig?: { audioEncoding?: string } };
        if (j.audioConfig?.audioEncoding !== 'LINEAR16') return json(400, { error: { message: 'encoding' } });
        return json(200, { audioContent: Buffer.from(toneWav(200)).toString('base64') });
      }
    }
    json(404, { error: 'not found' });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  for (const k of ENV_KEYS) envBefore[k] = process.env[k];
  process.env.APP_ENV = 'local';
  process.env.AZURE_SPEECH_KEY = AZURE_KEY;
  process.env.AZURE_SPEECH_REGION = 'westeurope';
  process.env.AZURE_SPEECH_TTS_URL = `${base}/azure`;
  delete process.env.GOOGLE_TTS_API_KEY;
  process.env.GOOGLE_TTS_URL = `${base}/google`;
  restore.castRoles = (await admin.from('cast_roles').select('*')).data ?? [];
  restore.voiceIds = new Set(((await admin.from('voice_catalog').select('voice_id')).data ?? []).map((v) => v.voice_id));
  restore.status = (await admin.from('audio_job_render_status').select('*').eq('audio_id', 'U-A1-002-AUD01').maybeSingle()).data;
  restore.assets = ((await admin.from('audio_assets').select('id').eq('audio_id', 'U-A1-002-AUD01').is('invalidated_at', null)).data ?? []).map((a) => a.id);
});

afterAll(async () => {
  for (const id of restore.created) {
    const { data } = await admin.from('audio_assets').select('object_path, master_object_path').eq('id', id).single();
    await admin.storage.from('course-audio').remove([data?.object_path, data?.master_object_path].filter(Boolean) as string[]);
    await admin.from('digital_qa_runs').delete().eq('content_id', id);
    await admin.from('audio_job_render_status').update({ last_asset_id: null }).eq('last_asset_id', id);
    await admin.from('audio_assets').delete().eq('id', id);
  }
  if (restore.assets.length) await admin.from('audio_assets').update({ invalidated_at: null, invalidated_reason: null }).in('id', restore.assets);
  if (restore.status) await admin.from('audio_job_render_status').upsert(restore.status);
  for (const r of restore.castRoles) await admin.from('cast_roles').upsert(r as Record<string, unknown>);
  const { data: now } = await admin.from('voice_catalog').select('voice_id');
  const added = (now ?? []).map((v) => v.voice_id).filter((id) => !restore.voiceIds.has(id));
  if (added.length) await admin.from('voice_catalog').delete().in('voice_id', added);
  await admin.from('provider_usage').delete().in('provider', ['azure', 'google']).gte('created_at', started);
  for (const k of ENV_KEYS) envBefore[k] === undefined ? delete process.env[k] : (process.env[k] = envBefore[k]);
  await new Promise((r) => server.close(r));
});

const loadJob = async (id: string) => {
  const { data } = await admin.from('audio_jobs').select('audio_id, script_hash, text_el, segments, payload').eq('audio_id', id).single();
  return normalizeAudioJob(data as never);
};

describe('quality cloud voices (Azure / Google protocols, local contract server)', () => {
  it('an Azure key alone gives two female and two male voices and unblocks every dialogue blocked for lack of voices', async () => {
    const out = await syncCloudVoices();
    expect(out.azure).toBe('SYNCED');
    expect(out.google).toBe('NOT_CONFIGURED');
    const list = seen.find((s) => s.path === '/azure/cognitiveservices/voices/list');
    expect(list?.headers['ocp-apim-subscription-key']).toBe(AZURE_KEY);

    const cat = await loadCatalog();
    const athina = cat.get('azure:el-GR-AthinaNeural')!;
    expect(athina).toMatchObject({ presentation: 'female', engine_kind: 'cloud', quality_tier: 'Neural', available: true, distribution_allowed: true });
    expect(athina.rights).toMatchObject({ status: 'PROVIDER_TERMS_OWNER_MUST_RECORD' });
    expect(cat.get('azure:el-GR-NestorasNeural')?.presentation).toBe('male');
    expect(cat.get('azure:en-US-AvaMultilingualNeural')).toMatchObject({ presentation: 'female', quality_tier: 'Multilingual' });
    expect(cat.get('azure:en-US-AvaMultilingualNeural')?.display_name).toContain('многоязычный');
    expect(cat.get('azure:en-US-AndrewMultilingualNeural')?.presentation).toBe('male');
    expect(cat.has('azure:en-US-JennyNeural')).toBe(false);

    // Proposals replace local development voices with licensed ones; native Greek voices narrate.
    await proposeCastVoices();
    const roles = new Map(((await admin.from('cast_roles').select('cast_role_id, voice_id, approved')).data ?? []).map((r) => [r.cast_role_id, r]));
    expect(roles.get('NARRATOR_F')?.voice_id).toBe('azure:el-GR-AthinaNeural');
    expect(roles.get('NARRATOR_M')?.voice_id).toBe('azure:el-GR-NestorasNeural');
    expect(roles.get('ROLE_CAFE_F')?.voice_id).toBe('azure:en-US-AvaMultilingualNeural');
    expect(roles.get('ROLE_CAFE_M')?.voice_id).toBe('azure:en-US-AndrewMultilingualNeural');
    expect([...roles.values()].every((r) => !r.approved)).toBe(true); // proposals only — the owner approves

    const ctx = await loadCastingContext();
    for (const id of BLOCKED_JOBS) {
      const p = planJob(await loadJob(id), ctx);
      expect(p.ok, `${id}: ${p.ok ? '' : p.reason}`).toBe(true);
      if (!p.ok) continue;
      expect(p.plan.engines).toEqual(['azure']);
      expect(new Set(Object.values(p.plan.voice_map)).size).toBe(Object.keys(p.plan.voice_map).length);
      expect(p.plan.estimated_cost_usd).toBeGreaterThan(0);
    }
  });

  it('SSML: native Greek voices speak directly, multilingual voices inside <lang xml:lang="el-GR">; answers decode as WAV', async () => {
    const cat = await loadCatalog();
    seen.length = 0;
    const a = await synthesizeWithVoice('Καλημέρα, τι κάνεις;', cat.get('azure:el-GR-AthinaNeural')!, { userId: null });
    const b = await synthesizeWithVoice('Πολύ καλά & εσύ;', cat.get('azure:en-US-AvaMultilingualNeural')!, { userId: null, speed: 'slow' });
    expect(parseWav(a.bytes)?.sampleRate).toBe(24_000);
    expect(parseWav(b.bytes)?.durationMs).toBeGreaterThan(600);
    const [s1, s2] = seen.filter((s) => s.path === '/azure/cognitiveservices/v1').map((s) => s.body);
    expect(s1).toContain('<voice name="el-GR-AthinaNeural">');
    expect(s1).not.toContain('<lang');
    expect(s1).toContain('Καλημέρα, τι κάνεις;');
    expect(s2).toContain('<voice name="en-US-AvaMultilingualNeural"><lang xml:lang="el-GR"><prosody');
    expect(s2).toContain('Πολύ καλά &amp; εσύ;');
    const { data: usage } = await admin.from('provider_usage').select('provider, unit_kind, ok').eq('provider', 'azure').gte('created_at', started);
    expect(usage?.length).toBeGreaterThanOrEqual(2);
    expect(usage?.every((u) => u.unit_kind === 'characters' && u.ok)).toBe(true);
  });

  it('a dialogue of two women renders with two distinct licensed voices and waits for the owner\'s provider terms (not development-only)', async () => {
    const job = await loadJob('U-A1-002-AUD01');
    // Speech screening is covered by the audio pipeline tests; here the tone stands in for speech.
    process.env.APP_ENV = 'preview';
    try {
      const r = await renderJob(job, { actorId: null, budgetCapUsd: 1, force: true });
      expect(r.status, r.error).toBe('RENDERED');
      restore.created.push(r.asset_id!);
      const { data: a } = await admin.from('audio_assets').select('provider, voice_ids, voice_map, rights_status, cast_approved, technical_status').eq('id', r.asset_id!).single();
      expect(a!.provider).toBe('azure');
      expect(a!.voice_ids).toEqual(expect.arrayContaining(['azure:el-GR-AthinaNeural', 'azure:en-US-AvaMultilingualNeural']));
      expect(a!.rights_status).toBe('RIGHTS_PENDING');
      expect(a!.cast_approved).toBe(false);
    } finally {
      process.env.APP_ENV = 'local';
    }
  }, 120_000);

  it('Google: voices by declared gender; a native Greek voice replaces a multilingual one; JSON request, base64 LINEAR16 answer', async () => {
    process.env.GOOGLE_TTS_API_KEY = GOOGLE_KEY;
    const out = await syncCloudVoices();
    expect(out.google).toBe('SYNCED');
    const cat = await loadCatalog();
    expect(cat.get('google:el-GR-Wavenet-A')).toMatchObject({ presentation: 'female', engine_kind: 'cloud', distribution_allowed: true });
    expect(cat.get('google:el-GR-Chirp3-HD-Charon')?.presentation).toBe('male');
    await proposeCastVoices();
    const { data: cafe } = await admin.from('cast_roles').select('voice_id').eq('cast_role_id', 'ROLE_CAFE_F').single();
    expect(cafe!.voice_id).toBe('google:el-GR-Wavenet-A'); // native Greek (Wavenet) over multilingual, Standard last
    const { data: narr } = await admin.from('cast_roles').select('voice_id').eq('cast_role_id', 'NARRATOR_F').single();
    expect(narr!.voice_id).toBe('azure:el-GR-AthinaNeural'); // an equally good voice is kept

    seen.length = 0;
    const r = await synthesizeWithVoice('Ένα φρέντο, παρακαλώ.', cat.get('google:el-GR-Wavenet-A')!, { userId: null });
    expect(parseWav(r.bytes)?.sampleRate).toBe(24_000);
    const req = seen.find((s) => s.path.startsWith('/google/v1/text:synthesize'))!;
    expect(req.path).toContain(`key=${GOOGLE_KEY}`);
    expect(JSON.parse(req.body)).toMatchObject({ input: { text: 'Ένα φρέντο, παρακαλώ.' }, voice: { languageCode: 'el-GR', name: 'el-GR-Wavenet-A' }, audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: 24000 } });
  });

  it('a wrong key is reported, not hidden', async () => {
    process.env.AZURE_SPEECH_KEY = 'wrong';
    try {
      const out = await syncCloudVoices();
      expect(out.azure).toBe('ERROR 401');
    } finally {
      process.env.AZURE_SPEECH_KEY = AZURE_KEY;
    }
  });
});
