/**
 * Voice catalog and casting (v5.4 §2). Presentation (female/male) is ALWAYS what the provider or
 * OS declares; the app never infers it from a character name or alters pitch to fake it.
 */
import { adminClient } from '../supabase/admin.ts';
import { env } from '../env.ts';
import { listLocalGreekVoices, listServiceVoices, localTtsSupported } from '../providers/local-engines.ts';

export type Presentation = 'female' | 'male' | 'other' | 'unspecified';

export interface CatalogVoice {
  voice_id: string;
  provider: 'local_macos' | 'local_coqui' | 'local_mbrola' | 'azure' | 'google' | 'openai' | 'mock';
  provider_voice_name: string;
  display_name: string;
  presentation: Presentation;
  presentation_source: string;
  quality_tier: string | null;
  engine_kind: 'local' | 'cloud' | 'test';
  available: boolean;
  streaming_capable: boolean;
  speed_profile: { normal: number; slow: number; fast: number };
  distribution_allowed: boolean;
  approved_by_owner: boolean;
  qa_status: string;
  rights: Record<string, unknown>;
}

export const MACOS_RIGHTS = {
  license: 'macOS System Voice (Apple Software License Agreement)',
  scope: 'Personal, non-commercial use on this Mac. Not cleared for distribution to learners.',
  status: 'DEV_LOCAL_ONLY',
};

/**
 * Detect local voices and upsert them; previously known local voices that are gone become unavailable.
 *  - macOS system el-GR voices (personal licence → DEV_LOCAL_ONLY);
 *  - GreekOS local speech service voices (Coqui VITS: BSD-3 model on a public-domain dataset, so
 *    distribution is allowed by the licence once the owner records the terms; MBROLA: non-commercial).
 */
export async function syncLocalVoices() {
  const db = adminClient();
  const voices = localTtsSupported() ? await listLocalGreekVoices() : [];
  const now = new Date().toISOString();
  await db.from('voice_catalog').update({ available: false, last_synced_at: now }).in('provider', ['local_macos', 'local_coqui', 'local_mbrola']);
  for (const v of voices) {
    await db.from('voice_catalog').upsert({
      voice_id: `local:macos:${v.id}`, provider: 'local_macos', provider_voice_name: v.id, display_name: `${v.name} (macOS)`, locale: 'el-GR',
      presentation: v.presentation, presentation_source: 'NSSpeechSynthesizer.VoiceGender', quality_tier: v.quality, engine_kind: 'local',
      available: true, streaming_capable: false, rights: MACOS_RIGHTS, distribution_allowed: false, last_synced_at: now,
      notes: 'Локальный движок разработки: реальная речь, но только для локальной проверки (лицензия macOS).',
    }, { onConflict: 'voice_id', ignoreDuplicates: false });
  }
  const service = env.localEnginesAllowed ? await listServiceVoices() : [];
  for (const v of service.filter((x) => x.available)) {
    const provider = v.engine.startsWith('coqui') ? 'local_coqui' : 'local_mbrola';
    await db.from('voice_catalog').upsert({
      voice_id: `local:${v.id}`, provider, provider_voice_name: v.id, display_name: v.name, locale: 'el-GR',
      presentation: v.presentation, presentation_source: v.presentation_source, quality_tier: v.quality_tier, engine_kind: 'local',
      available: true, streaming_capable: v.streaming_capable, version: v.engine,
      speed_profile: { normal: 1.0, slow: 0.85, fast: 1.1 },
      rights: { license: v.license, source: v.source, status: v.distribution_allowed_by_license ? 'LICENSE_ALLOWS_DISTRIBUTION_OWNER_MUST_RECORD' : 'DEV_LOCAL_ONLY' },
      distribution_allowed: v.distribution_allowed_by_license, last_synced_at: now,
      notes: provider === 'local_coqui'
        ? 'Открытая нейросетевая модель (локально, без сети). Лицензия допускает распространение; условия фиксирует владелец.'
        : 'Дифонный синтез MBROLA: настоящий мужской голос, но низкая естественность; лицензия только некоммерческая (DEV_LOCAL_ONLY).',
    }, { onConflict: 'voice_id', ignoreDuplicates: false });
  }
  return [...voices.map((v) => ({ id: v.id, name: v.name, presentation: v.presentation })), ...service.map((v) => ({ id: v.id, name: v.name, presentation: v.presentation }))];
}

/** Cloud voice lists (declared gender). Requires keys; returns NOT_CONFIGURED otherwise. NOT_TESTED live. */
export async function syncCloudVoices(): Promise<Record<string, string>> {
  const db = adminClient();
  const out: Record<string, string> = {};
  const now = new Date().toISOString();
  if (env.azureSpeechKey && env.azureSpeechRegion) {
    try {
      const r = await fetch(`https://${env.azureSpeechRegion}.tts.speech.microsoft.com/cognitiveservices/voices/list`, { headers: { 'Ocp-Apim-Subscription-Key': env.azureSpeechKey }, signal: AbortSignal.timeout(15_000) });
      if (!r.ok) throw new Error(String(r.status));
      const list = (await r.json()) as Array<{ ShortName: string; DisplayName: string; Locale: string; Gender: string; VoiceType?: string }>;
      for (const v of list.filter((x) => x.Locale === 'el-GR')) {
        await db.from('voice_catalog').upsert({
          voice_id: `azure:${v.ShortName}`, provider: 'azure', provider_voice_name: v.ShortName, display_name: `${v.DisplayName} (Azure)`,
          presentation: v.Gender === 'Female' ? 'female' : v.Gender === 'Male' ? 'male' : 'unspecified', presentation_source: 'azure voices/list Gender',
          quality_tier: v.VoiceType ?? null, engine_kind: 'cloud', available: true, streaming_capable: true, last_synced_at: now,
        }, { onConflict: 'voice_id' });
      }
      out.azure = 'SYNCED';
    } catch (e) { out.azure = `ERROR ${(e as Error).message}`; }
  } else out.azure = 'NOT_CONFIGURED';
  if (env.googleTtsKey) {
    try {
      const r = await fetch(`https://texttospeech.googleapis.com/v1/voices?languageCode=el-GR&key=${encodeURIComponent(env.googleTtsKey)}`, { signal: AbortSignal.timeout(15_000) });
      if (!r.ok) throw new Error(String(r.status));
      const j = (await r.json()) as { voices?: Array<{ name: string; ssmlGender: string }> };
      for (const v of j.voices ?? []) {
        await db.from('voice_catalog').upsert({
          voice_id: `google:${v.name}`, provider: 'google', provider_voice_name: v.name, display_name: `${v.name} (Google)`,
          presentation: v.ssmlGender === 'FEMALE' ? 'female' : v.ssmlGender === 'MALE' ? 'male' : 'unspecified', presentation_source: 'google voices.list ssmlGender',
          quality_tier: v.name.split('-')[2] ?? null, engine_kind: 'cloud', available: true, streaming_capable: false, last_synced_at: now,
        }, { onConflict: 'voice_id' });
      }
      out.google = 'SYNCED';
    } catch (e) { out.google = `ERROR ${(e as Error).message}`; }
  } else out.google = 'NOT_CONFIGURED';
  if (env.openaiKey) {
    for (const name of env.openaiTtsVoices) {
      await db.from('voice_catalog').upsert({
        voice_id: `openai:${name}`, provider: 'openai', provider_voice_name: name, display_name: `${name} (OpenAI)`,
        presentation: 'unspecified', presentation_source: 'OpenAI does not declare voice gender', engine_kind: 'cloud', available: true, streaming_capable: true, last_synced_at: now,
      }, { onConflict: 'voice_id' });
    }
    out.openai = 'LISTED_FROM_CONFIG';
  } else out.openai = 'NOT_CONFIGURED';
  return out;
}

export async function loadCatalog(): Promise<Map<string, CatalogVoice>> {
  const { data } = await adminClient().from('voice_catalog').select('*');
  return new Map(((data ?? []) as CatalogVoice[]).map((v) => [v.voice_id, v]));
}

export interface CastRole { cast_role_id: string; requested_presentation: 'female' | 'male' | 'any'; voice_id: string | null; approved: boolean; use_case: string }

export async function loadCastRoles(): Promise<Map<string, CastRole>> {
  const { data } = await adminClient().from('cast_roles').select('cast_role_id, requested_presentation, voice_id, approved, use_case');
  return new Map(((data ?? []) as CastRole[]).map((c) => [c.cast_role_id, c]));
}

/**
 * Propose (never approve) a voice for each cast role whose voice is empty: the first available
 * catalog voice whose DECLARED presentation matches. Distinct cast roles get distinct voices when
 * the catalog allows it; otherwise the role stays empty (blocked) rather than reusing a voice.
 */
/** Local voice preference by measured round-trip quality (lower is better); unknown voices last. */
const LOCAL_VOICE_RANK: Record<string, number> = { 'coqui-el-css10': 0, 'mbrola-gr2': 1, 'mbrola-gr1': 2 };
function voiceRank(v: CatalogVoice): number {
  return LOCAL_VOICE_RANK[v.provider_voice_name] ?? 9;
}

export async function proposeCastVoices() {
  const db = adminClient();
  const [roles, catalog] = await Promise.all([loadCastRoles(), loadCatalog()]);
  const used = new Set([...roles.values()].map((r) => r.voice_id).filter(Boolean) as string[]);
  const changes: Array<{ cast_role_id: string; voice_id: string }> = [];
  for (const r of [...roles.values()].sort((a, b) => a.cast_role_id.localeCompare(b.cast_role_id))) {
    if (r.voice_id) continue;
    const pick = [...catalog.values()]
      .filter((v) => v.available && v.provider !== 'mock' && (r.requested_presentation === 'any' || v.presentation === r.requested_presentation))
      .sort((a, b) => Number(b.engine_kind === 'cloud') - Number(a.engine_kind === 'cloud') || voiceRank(a) - voiceRank(b) || a.voice_id.localeCompare(b.voice_id))
      .find((v) => !used.has(v.voice_id) || r.cast_role_id.startsWith('TUTOR_'));
    if (!pick) continue;
    await db.from('cast_roles').update({ voice_id: pick.voice_id, approved: false, status: 'proposed' }).eq('cast_role_id', r.cast_role_id);
    if (!r.cast_role_id.startsWith('TUTOR_')) used.add(pick.voice_id);
    changes.push({ cast_role_id: r.cast_role_id, voice_id: pick.voice_id });
  }
  return changes;
}

// ---------- casting proposals for audio-job roles ----------

/**
 * Grammatical gender of role nouns as written by the authors (textual evidence, not a guess about a
 * person). Personal names, letters (Α/Β) and common-gender nouns (ο/η υπάλληλος) need owner casting.
 */
export const ROLE_NOUN_GENDER: Record<string, 'female' | 'male'> = {
  'Συντονίστρια': 'female', 'Πωλήτρια': 'female', 'Ιδιοκτήτρια': 'female', 'Ομιλήτρια': 'female', 'Πελάτισσα': 'female',
  'Φίλη': 'female', 'Συντάκτρια': 'female', 'Αδελφή': 'female', 'Επισκέπτρια': 'female', 'Μητέρα': 'female', 'Δασκάλα': 'female',
  'Πελάτης': 'male', 'Συνεργάτης': 'male', 'Μαθητής': 'male', 'Πωλητής': 'male', 'Συμμετέχων': 'male', 'Αδελφός': 'male',
  'Ενοικιαστής': 'male', 'Επιβάτης': 'male', 'Επιμελητής': 'male', 'Υπεύθυνος': 'male', 'Φίλος': 'male', 'Πατέρας': 'male', 'Δάσκαλος': 'male',
};

export const COMMON_GENDER_NOUNS = new Set(['Υπάλληλος', 'Γραμματέας', 'Βοηθός', 'Οδηγός', 'Γιατρός', 'Δικηγόρος', 'Φαρμακοποιός']);

export interface CastingProposal {
  speaker_role: string;
  required_presentation: 'female' | 'male' | 'any' | null;
  source: 'grammatical_gender_proposal' | 'self_reference_proposal' | 'narrator_default_proposal' | 'article_reference_proposal' | 'distinct_voice_proposal' | 'needs_casting';
  evidence: string;
}

/** Speaker labels that are only letters (Α/Β, A/B): any voice works as long as speakers stay distinct. */
export const LETTER_ROLES = new Set(['Α', 'Β', 'Γ', 'Δ', 'A', 'B', 'C', 'D']);

const ARTICLES: Record<string, 'female' | 'male'> = { η: 'female', την: 'female', της: 'female', ο: 'male', τον: 'male', του: 'male' };

/**
 * Textual evidence for a personal name: the authored corpus itself writes it with a gendered
 * article («η Άννα», «τον Πέτρο»). Counted over all scripts; a mixed or absent signal → no proposal.
 */
export function articleEvidence(name: string, corpusText: string): { presentation: 'female' | 'male'; count: number; sample: string } | null {
  const stem = name.normalize('NFC');
  // Masculine names in -ης/-ος/-ας lose the final ς in the accusative/genitive («τον Πέτρο», «του Νίκου»).
  const forms = new Set([stem, stem.replace(/ς$/u, ''), stem.replace(/ος$/u, 'ου'), stem.replace(/ης$/u, 'η'), stem.replace(/ας$/u, 'α')]);
  const counts = { female: 0, male: 0 };
  let sample = '';
  const re = /(?:^|[\s«"(—-])(η|την|της|ο|τον|του)\s+(\p{Lu}\p{Ll}+)/gu;
  for (const m of corpusText.matchAll(re)) {
    if (!forms.has(m[2])) continue;
    const g = ARTICLES[m[1].toLowerCase()];
    // «η/της Μαρία» vs. «ο/του …»: the genitive «του» can precede a feminine name only through
    // apposition, which the corpus does not use for characters; still require a clear majority.
    counts[g] += 1;
    if (!sample) sample = `${m[1]} ${m[2]}`;
  }
  const total = counts.female + counts.male;
  if (total === 0) return null;
  const top = counts.female >= counts.male ? 'female' : 'male';
  if (counts[top] / total < 0.9) return null;
  return { presentation: top, count: counts[top], sample };
}

export function proposeRoleCasting(role: string, corpusText = ''): CastingProposal {
  const g = ROLE_NOUN_GENDER[role];
  if (g) return { speaker_role: role, required_presentation: g, source: 'grammatical_gender_proposal', evidence: `грамматический род ролевого существительного «${role}» (${g === 'female' ? 'женский' : 'мужской'})` };
  if (LETTER_ROLES.has(role)) return { speaker_role: role, required_presentation: 'any', source: 'distinct_voice_proposal', evidence: `«${role}» — условное обозначение говорящего: подходит любой голос, если собеседники звучат разными голосами (методическое предложение, владелец может сменить)` };
  if (COMMON_GENDER_NOUNS.has(role)) {
    const art = articleEvidence(role, corpusText);
    if (art) return { speaker_role: role, required_presentation: art.presentation, source: 'article_reference_proposal', evidence: `в сценариях курса «${art.sample}» (${art.count}×): артикль задаёт ${art.presentation === 'female' ? 'женский' : 'мужской'} род` };
    return { speaker_role: role, required_presentation: null, source: 'needs_casting', evidence: `«${role}» — существительное общего рода (ο/η): нужен выбор владельца` };
  }
  const art = articleEvidence(role, corpusText);
  if (art) return { speaker_role: role, required_presentation: art.presentation, source: 'article_reference_proposal', evidence: `в текстах курса имя пишется с артиклем «${art.sample}» (${art.count}×) — ${art.presentation === 'female' ? 'женский' : 'мужской'} род; это предложение, решение за владельцем` };
  return { speaker_role: role, required_presentation: null, source: 'needs_casting', evidence: `роль «${role}» (имя или обозначение) не задаёт голос: нужен выбор владельца, пол по имени не угадывается` };
}

/** Narration without speaker segments: first-person agreement in the text is evidence; else any voice. */
export function proposeNarratorCasting(text: string): CastingProposal {
  const fem = /(?:^|[\s«"(—-])[Εε]ίμαι η\s/u.test(text);
  const masc = /(?:^|[\s«"(—-])[Εε]ίμαι ο\s/u.test(text);
  if (fem && !masc) return { speaker_role: '__narrator__', required_presentation: 'female', source: 'self_reference_proposal', evidence: 'в тексте говорящий называет себя с артиклем «η» («Είμαι η …»)' };
  if (masc && !fem) return { speaker_role: '__narrator__', required_presentation: 'male', source: 'self_reference_proposal', evidence: 'в тексте говорящий называет себя с артиклем «ο» («Είμαι ο …»)' };
  return { speaker_role: '__narrator__', required_presentation: 'any', source: 'narrator_default_proposal', evidence: 'повествование без персонажей: голос диктора выбирается методически (по умолчанию NARRATOR_F, можно сменить)' };
}

/**
 * Picks cast roles for proposals inside one job; distinct speaker roles get distinct cast roles.
 * 'any' speakers take the presentation with the most free cast roles left, so A/B dialogues stay
 * distinguishable even when the catalog has one voice per presentation.
 */
export function castRolesForJob(proposals: CastingProposal[]): Map<string, string | null> {
  const pools: Record<'female' | 'male', string[]> = { female: ['NARRATOR_F', 'ROLE_CAFE_F'], male: ['NARRATOR_M', 'ROLE_CAFE_M'] };
  const used = new Set<string>();
  const out = new Map<string, string | null>();
  const order = [...proposals].sort((a, b) => Number(a.required_presentation === 'any') - Number(b.required_presentation === 'any'));
  const taken = { female: 0, male: 0 };
  for (const p of order) {
    if (!p.required_presentation) { out.set(p.speaker_role, null); continue; }
    const want: 'female' | 'male' = p.required_presentation === 'any'
      ? (p.speaker_role === '__narrator__' ? 'female' : taken.female <= taken.male ? 'female' : 'male')
      : p.required_presentation;
    const pick = pools[want].find((c) => !used.has(c)) ?? null;
    if (pick) { used.add(pick); taken[want] += 1; }
    out.set(p.speaker_role, pick);
  }
  return out;
}

/** Writes proposals for all jobs (never overwrites owner decisions or approved rows). */
export async function proposeJobCasting() {
  const db = adminClient();
  const { data: jobs } = await db.from('audio_jobs').select('audio_id, text_el, segments').order('audio_id');
  // Corpus text used as article evidence for personal names (all scripts + scenario payloads).
  const { data: scen } = await db.from('speaking_scenarios').select('payload');
  const { data: objects } = await db.from('content_objects').select('payload');
  const items: Array<{ envelope: { prompt?: string; stimulus?: unknown; model_response?: unknown } }> = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await db.from('items').select('envelope').order('item_id').range(from, from + 999);
    items.push(...((data ?? []) as typeof items));
    if (!data || data.length < 1000) break;
  }
  const corpusText = [
    ...(objects ?? []).map((x) => JSON.stringify(x.payload)),
    ...items.map((i) => `${i.envelope.prompt ?? ''} ${JSON.stringify(i.envelope.stimulus ?? '')} ${JSON.stringify(i.envelope.model_response ?? '')}`),
    ...(jobs ?? []).map((j) => `${j.text_el ?? ''} ${(Array.isArray(j.segments) ? j.segments : []).map((x: { text_el?: string; text?: string }) => x.text_el ?? x.text ?? '').join(' ')}`),
    ...(scen ?? []).map((x) => JSON.stringify(x.payload)),
  ].join('\n');
  const { data: existing } = await db.from('audio_job_casting').select('audio_id, speaker_role, source, approved');
  const locked = new Set((existing ?? []).filter((e) => e.approved || e.source === 'owner').map((e) => `${e.audio_id}|${e.speaker_role}`));
  let written = 0;
  for (const j of jobs ?? []) {
    const segs = (Array.isArray(j.segments) ? j.segments : []) as Array<{ speaker_role?: string; speaker?: string }>;
    const roles = [...new Set(segs.map((s) => s.speaker_role ?? s.speaker).filter((r): r is string => !!r))];
    const proposals = roles.length ? roles.map((r) => proposeRoleCasting(r, corpusText)) : [proposeNarratorCasting(j.text_el ?? '')];
    const cast = castRolesForJob(proposals);
    for (const p of proposals) {
      if (locked.has(`${j.audio_id}|${p.speaker_role}`)) continue;
      await db.from('audio_job_casting').upsert({
        audio_id: j.audio_id, speaker_role: p.speaker_role, cast_role_id: cast.get(p.speaker_role) ?? null,
        required_presentation: p.required_presentation, source: p.source, evidence: p.evidence, approved: false, updated_at: new Date().toISOString(),
      });
      written++;
    }
  }
  return written;
}
