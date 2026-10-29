import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { planJob, normalizeSegments, type AudioJobRow, type CastingContext, type CastingRow } from '@/lib/audio/pipeline';
import { proposeRoleCasting, proposeNarratorCasting, castRolesForJob, type CatalogVoice, type CastRole } from '@/lib/voice/catalog';

const corpus = resolve(process.env.CORPUS_ROOT ?? '../spec/GreekOS_CLAUDE_UPLOAD_READY');
const jobs: Array<AudioJobRow & { script_version_hash: string }> = JSON.parse(readFileSync(resolve(corpus, 'HANDOFF_IMPORT/audio_jobs.json'), 'utf8'));

const voice = (id: string, presentation: 'female' | 'male'): CatalogVoice => ({
  voice_id: id, provider: 'azure', provider_voice_name: id, display_name: id, presentation, presentation_source: 'test fixture (declared)', quality_tier: 'Neural',
  engine_kind: 'cloud', available: true, streaming_capable: true, speed_profile: { normal: 1, slow: 0.88, fast: 1.1 }, distribution_allowed: true, approved_by_owner: true, qa_status: 'OWNER_LISTENED', rights: {},
});
const role = (id: string, p: 'female' | 'male', v: string | null): CastRole => ({ cast_role_id: id, requested_presentation: p, voice_id: v, approved: true, use_case: 'test' });

function ctxFor(voices: CatalogVoice[], roles: CastRole[], owner: Record<string, string | null> = {}): CastingContext {
  const casting = new Map<string, CastingRow>();
  for (const j of jobs) {
    const segs = normalizeSegments(j.audio_id, j.segments);
    const names = [...new Set(segs.map((s) => s.role).filter((r): r is string => !!r))];
    const proposals = names.length ? names.map(proposeRoleCasting) : [proposeNarratorCasting(j.text_el ?? '')];
    const cast = castRolesForJob(proposals);
    for (const p of proposals) {
      const key = `${j.audio_id}|${p.speaker_role}`;
      const ownerPick = owner[key];
      // Owner casting replaces the proposal; the requirement then comes from the chosen cast role (as in the API).
      const pickedRole = ownerPick ? roles.find((r) => r.cast_role_id === ownerPick) : undefined;
      casting.set(key, { audio_id: j.audio_id, speaker_role: p.speaker_role, cast_role_id: ownerPick !== undefined ? ownerPick : cast.get(p.speaker_role) ?? null, required_presentation: ownerPick !== undefined ? pickedRole?.requested_presentation ?? null : p.required_presentation, source: ownerPick !== undefined ? 'owner' : p.source, approved: true });
    }
  }
  return { casting, castRoles: new Map(roles.map((r) => [r.cast_role_id, r])), voices: new Map(voices.map((v) => [v.voice_id, v])) };
}

const FULL = ctxFor(
  [voice('F1', 'female'), voice('F2', 'female'), voice('M1', 'male'), voice('M2', 'male')],
  [role('NARRATOR_F', 'female', 'F1'), role('ROLE_CAFE_F', 'female', 'F2'), role('NARRATOR_M', 'male', 'M1'), role('ROLE_CAFE_M', 'male', 'M2')],
);
const job = (id: string) => { const j = jobs.find((x) => x.audio_id === id)!; return { ...j, script_hash: j.script_version_hash }; };

describe('casting proposals use textual evidence only', () => {
  it('role nouns with gendered morphology are proposals; names and common-gender nouns need the owner', () => {
    expect(proposeRoleCasting('Συντονίστρια')).toMatchObject({ required_presentation: 'female', source: 'grammatical_gender_proposal' });
    expect(proposeRoleCasting('Πελάτης')).toMatchObject({ required_presentation: 'male', source: 'grammatical_gender_proposal' });
    expect(proposeRoleCasting('Άννα')).toMatchObject({ required_presentation: null, source: 'needs_casting' });
    expect(proposeRoleCasting('Υπάλληλος')).toMatchObject({ required_presentation: null, source: 'needs_casting' });
    expect(proposeRoleCasting('Α')).toMatchObject({ source: 'needs_casting' });
    expect(proposeNarratorCasting('Καλησπέρα σας. Είμαι η συντονίστρια του προγράμματος.')).toMatchObject({ required_presentation: 'female', source: 'self_reference_proposal' });
    expect(proposeNarratorCasting('Λίγα λόγια για την πόλη.')).toMatchObject({ required_presentation: 'any', source: 'narrator_default_proposal' });
  });
});

describe('all 142 queued jobs are accounted for (no silent omission)', () => {
  it('every job yields a deterministic plan or an explicit block with a reason', () => {
    expect(jobs.length).toBe(142);
    const keys = new Set<string>();
    let ok = 0;
    for (const j of jobs) {
      const a = planJob({ ...j, script_hash: j.script_version_hash }, FULL);
      const b = planJob({ ...j, script_hash: j.script_version_hash }, FULL);
      if (a.ok && b.ok) {
        ok++;
        expect(a.plan.plan_hash).toBe(b.plan.plan_hash);
        expect(a.plan.segments.every((s) => s.text.trim() && s.text.length <= 1200)).toBe(true);
        keys.add(a.plan.idempotency_key);
      } else {
        expect(a.ok ? '' : a.reason.length).toBeTruthy();
      }
    }
    expect(keys.size).toBe(ok);
    expect(ok).toBeGreaterThan(0);
  });

  it('dialogues with personal names stay blocked until the owner casts them', () => {
    const r = planJob(job('U-A1-001-AUD01'), FULL);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe('BLOCKED_MISSING_VOICE_METADATA');
  });

  it('owner casting enables a dialogue with distinct voices per character', () => {
    const ctx = ctxFor([voice('F1', 'female'), voice('M1', 'male')], [role('NARRATOR_F', 'female', 'F1'), role('NARRATOR_M', 'male', 'M1')], { 'U-A1-001-AUD01|Υπάλληλος': 'NARRATOR_F', 'U-A1-001-AUD01|Μαθητής': 'NARRATOR_M' });
    const r = planJob(job('U-A1-001-AUD01'), ctx);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(new Set(Object.values(r.plan.voice_map))).toEqual(new Set(['F1', 'M1']));
      expect(r.plan.segments.find((s) => s.role === 'Μαθητής')!.voice_id).toBe('M1');
    }
  });

  it('a male role is never voiced by a female voice (no pitch tricks): blocked instead', () => {
    const femaleOnly = ctxFor([voice('F1', 'female')], [role('NARRATOR_F', 'female', 'F1'), role('NARRATOR_M', 'male', 'F1')]);
    const male = jobs.find((j) => normalizeSegments(j.audio_id, j.segments).some((s) => s.role === 'Πωλητής'));
    if (male) {
      const r = planJob({ ...male, script_hash: male.script_version_hash }, femaleOnly);
      expect(r.ok).toBe(false);
    }
  });

  it('two characters may not share one voice', () => {
    const one = ctxFor([voice('F1', 'female')], [role('NARRATOR_F', 'female', 'F1'), role('ROLE_CAFE_F', 'female', 'F1')], { 'U-A1-001-AUD01|Υπάλληλος': 'NARRATOR_F', 'U-A1-001-AUD01|Μαθητής': 'ROLE_CAFE_F' });
    const r = planJob(job('U-A1-001-AUD01'), one);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/различимых голосов/);
  });

  it('U-B1-021 AUD01 and AUD02 (same words, different focus) are never merged', () => {
    const a = planJob(job('U-B1-021-AUD01'), FULL);
    const b = planJob(job('U-B1-021-AUD02'), FULL);
    if (a.ok && b.ok) expect(a.plan.idempotency_key).not.toBe(b.plan.idempotency_key);
  });

  it('exam cue segments (cue_id/speaker/text) are normalised', () => {
    const exam = jobs.find((j) => Array.isArray(j.segments) && (j.segments as Array<Record<string, unknown>>).some((s) => 'cue_id' in s));
    if (exam) expect(normalizeSegments(exam.audio_id, exam.segments).length).toBeGreaterThan(0);
  });
});

describe('round-trip screening signals', async () => {
  const { alignmentDiff, syllableCount, segmentSignals } = await import('@/lib/audio/roundtrip');
  const { buildWav } = await import('@/lib/audio/wav');
  it('reports missing, inserted and stuttered words without claiming a definitive error', () => {
    const d = alignmentDiff('Θα πάμε αύριο στη Θεσσαλονίκη.', 'Θα πάμε πάμε στη Θεσαλονίκη');
    expect(d.missing).toContain('αυριο');
    expect(d.repeated).toContain('παμε');
    expect(alignmentDiff('Καλημέρα σας.', 'καλημέρα σας')).toEqual({ missing: [], inserted: [], repeated: [] });
  });
  it('estimates syllables and flags an abrupt (cut-off) ending from real samples', () => {
    expect(syllableCount('Καλημέρα σας')).toBe(5);
    const tone = new Int16Array(16000).map((_, i) => Math.round(8000 * Math.sin(i / 3)));
    const faded = tone.map((v, i) => (i > 14000 ? 0 : v));
    const pcmOf = (b: Uint8Array) => ({ samples: new Int16Array(b.buffer, b.byteOffset + 44, (b.byteLength - 44) / 2), rate: 16000 });
    const [cut, ok] = segmentSignals(['Καλημέρα σας', 'Καλημέρα σας'], [buildWav(tone, 16000), buildWav(faded, 16000)], pcmOf);
    expect(cut.truncated_end).toBe(true);
    expect(ok.truncated_end).toBe(false);
  });
});

describe('round-trip numeral normalisation', async () => {
  const { roundTrip, normalizeNumerals, tokens } = await import('@/lib/audio/roundtrip');
  it('number words and digits compare equal; articles stay words', () => {
    expect(roundTrip('Το λεωφορείο δώδεκα φεύγει στις τρεις.', 'Το λεωφορείο 12 φεύγει στις 3.').wer).toBe(0);
    expect(normalizeNumerals(tokens('είκοσι πέντε ευρώ'))).toEqual(['25', 'ευρώ']);
    expect(normalizeNumerals(tokens('θέλω ένα καφέ'))).toEqual(['θέλω', 'ένα', 'καφέ']);
    expect(normalizeNumerals(tokens('δεκαπέντε Μαρτίου'))).toEqual(['15', 'μαρτίου']);
    expect(roundTrip('στις δέκα', 'στις έντεκα').wer).toBeGreaterThan(0);
  });
});
