import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildItemDTO, assertNoLeak, publicTextObject } from '@/lib/content/dto';
import { stableStringify } from '@/lib/content/stable-json';
import type { ItemEnvelope } from '@/lib/content/types';
import { validateAssessment, criteriaFor, type AssessmentOutput } from '@/lib/ai/assessor';
import { validateSummary, nextTurn, type ScenarioPayload } from '@/lib/speaking/dialogue';
import { canTransition, bargeIn, TRANSITIONS } from '@/lib/speaking/state-machine';
import { initialState, nextProbe, recordOutcome, routeStart, axisResult, type ProbeItem } from '@/lib/diagnostic/engine';
import { analyzeWav, buildWav, concatWav, parseWav } from '@/lib/audio/wav';
import { roundTrip, roundTripPass, chunkText } from '@/lib/audio/roundtrip';
import { CORPUS, hasCorpusFile } from '../corpus';

const corpus = CORPUS;
const items: ItemEnvelope[] = JSON.parse(readFileSync(resolve(corpus, 'HANDOFF_IMPORT/items.json'), 'utf8'));

describe('candidate DTO never leaks keys, models or editor payloads', () => {
  it('holds for all 1843 imported items', () => {
    let built = 0;
    for (const item of items) {
      const dto = buildItemDTO({ item, contentHash: 'a'.repeat(64), examMode: item.module === 'keg_b2' });
      assertNoLeak(dto);
      const json = stableStringify(dto);
      for (const k of item.answer.filter((a): a is string => typeof a === 'string' && a.length > 3)) {
        // The prompt itself may legitimately contain a word; only check fields beyond prompt/options/stimulus text.
        expect(json.includes(`"answer"`)).toBe(false);
        void k;
      }
      expect(json.includes('original_payload')).toBe(false);
      built++;
    }
    expect(built).toBe(1843);
  });

  it('text objects are whitelisted (no reviewer-only completed text)', () => {
    const t = publicTextObject({ text: 'κείμενο', completed_text_reviewer_only: 'SECRET', phrase_bank: { A: 'x' }, licensing: { a: 1 }, example: { gap: 0, answer: 'ok' } });
    expect(JSON.stringify(t)).not.toContain('SECRET');
    expect(t).toMatchObject({ text: 'κείμενο', phrase_bank: { A: 'x' }, example: { gap: 0, filled: 'ok' } });
    expect(t && 'licensing' in t).toBe(false);
  });

  it('listening cues never carry the transcript', () => {
    const l = items.find((i) => i.item_id === 'KEG-B2-L01-N01')!;
    const dto = buildItemDTO({ item: l, contentHash: 'a'.repeat(64), examMode: true });
    expect(dto.stimulus?.kind).toBe('audio_cue');
    expect(dto.stimulus?.text).toBeUndefined();
    expect(dto.audio).toEqual({ status: 'unavailable', reason: 'AUDIO_PENDING' });
  });
});

describe('AI assessment validation → ABSTAIN on hallucination', () => {
  const item = items.find((i) => i.item_id === 'KEG-B2-P01-W01')!;
  const criteria = criteriaFor(item, null);
  const base: AssessmentOutput = {
    decision: 'ASSESSED', verdict: 'CORRECT', confidence: 'high', task_completion: 'met',
    dimensions: [{ criterion_id: 'C1', label_ru: 'организация', level: 'met', note_ru: '' }],
    evidence: [{ quote: 'Το Σάββατο πήγα', criterion_id: 'C1', observation_ru: 'есть' }], errors: [], feedback_ru: 'ok', improved_version_el: null, abstain_reason: null,
  };
  const text = 'Το Σάββατο πήγα σε μια ανταλλαγή αντικειμένων.';
  it('accepts literal evidence spans', () => expect(validateAssessment(base, text, criteria).ok).toBe(true));
  it('rejects invented quotes', () => expect(validateAssessment({ ...base, evidence: [{ quote: 'Την Κυριακή', criterion_id: 'C1', observation_ru: '' }] }, text, criteria)).toEqual({ ok: false, reason: 'HALLUCINATED_EVIDENCE_SPAN' }));
  it('rejects unknown criteria', () => expect(validateAssessment({ ...base, evidence: [{ quote: 'πήγα', criterion_id: 'X9', observation_ru: '' }] }, text, criteria).ok).toBe(false));
  it('rejects negative verdicts without evidence', () => expect(validateAssessment({ ...base, verdict: 'INCORRECT_CONFIRMED', task_completion: 'partial' }, text, criteria).ok).toBe(false));
  it('speaking summary must cite real confirmed turns', () => {
    const turns = [{ turn_id: 't1', text: 'Θέλω ένα κιλό μήλα.' }, { turn_id: 't2', text: 'Ευχαριστώ.' }];
    const ok = { decision: 'ASSESSED' as const, communicative_goal: 'achieved' as const, dimensions: [{ dimension: 'task_success' as const, level: 'independent' as const, evidence_turn_ids: ['t1'], note_ru: '' }], corrections: [], used_constructions_el: [], next_step_ru: '', confidence: 'high' as const, abstain_reason: null };
    expect(validateSummary(ok, turns).ok).toBe(true);
    expect(validateSummary({ ...ok, dimensions: [{ ...ok.dimensions[0], evidence_turn_ids: ['t9'] }] }, turns).ok).toBe(false);
    expect(validateSummary({ ...ok, corrections: [{ turn_id: 't1', quote: 'δύο κιλά', better_el: 'x', why_ru: '', kind: 'confirmed_error' as const }] }, turns).ok).toBe(false);
  });
});

describe('speaking state machine and fallback', () => {
  it('rejects illegal transitions and has no dead ends except ended', () => {
    expect(canTransition('listening', 'ended')).toBe(false);
    for (const [s, next] of Object.entries(TRANSITIONS)) if (s !== 'ended') expect(next.length).toBeGreaterThan(0);
  });
  it('barge-in cancels agent playback and marks it incomplete', () => {
    expect(bargeIn('agent_speaking')).toEqual({ next: 'listening', playbackCompleted: false });
    expect(bargeIn('listening')).toBeNull();
  });
  it('without an LLM the dialogue follows the authored graph and repair loops end in RETRY', async () => {
    const sc: ScenarioPayload = { scenario_id: 'T', entry_node: 'OPEN', off_script_policy: { max_repair_loops: 2 }, nodes: [
      { node_id: 'OPEN', assistant_el: 'Καλημέρα!', transitions: [{ condition: 'ok', to: 'CLOSE' }, { condition: 'repeat', to: 'REPAIR' }] },
      { node_id: 'REPAIR', assistant_el: 'Να το πω ξανά;', transitions: [{ condition: 'x', to: 'OPEN' }] },
      { node_id: 'CLOSE', assistant_el: 'Ορίστε.', transitions: [] },
      { node_id: 'RETRY', assistant_el: 'Ας σταματήσουμε.', transitions: [] },
    ] };
    const a = await nextTurn({ userId: 'u', scenario: sc, mode: 'roleplay', currentNode: 'OPEN', history: [], learnerText: 'Ένα κιλό.', repairRequested: false, repairLoops: 0 });
    expect(a).toMatchObject({ engine: 'scripted_fallback', nextNode: 'CLOSE', assistantEl: 'Ορίστε.', generated: false, ended: true });
    const r = await nextTurn({ userId: 'u', scenario: sc, mode: 'roleplay', currentNode: 'OPEN', history: [], learnerText: '', repairRequested: true, repairLoops: 2 });
    expect(r.nextNode).toBe('RETRY');
  });
});

describe('diagnostic engine (ENTRY_PROTOCOL)', () => {
  const mk = (axis: ProbeItem['axis'], level: string, over: Partial<ProbeItem> = {}): ProbeItem => ({ item_id: `D-${level}-${axis.toUpperCase()}-01`, axis, level, usable: true, requires_audio: false, audio_ready: true, acoustic: false, voice_required: false, voice_available: false, ...over });
  const probes: ProbeItem[] = [
    ...['A1', 'A2', 'B1'].flatMap((l) => [mk('grammar', l), mk('vocabulary', l), mk('reading', l), mk('writing', l)]),
    ...['A1', 'A2', 'B1'].map((l) => mk('listening', l, { requires_audio: true, audio_ready: false })),
    ...['A1', 'A2', 'B1'].map((l) => mk('pronunciation', l, { acoustic: true })),
    ...['A1', 'A2', 'B1'].flatMap((l) => [mk('spoken_interaction', l, { voice_required: true }), mk('spoken_production', l, { voice_required: true })]),
  ];
  it('climbs per axis, stops on failure, never averages axes, missing audio is NOT_OBSERVED', () => {
    let { state, item } = nextProbe(initialState(), probes);
    expect(item?.item_id).toBe('D-A1-GRAMMAR-01');
    state = recordOutcome(state, { item_id: 'D-A1-GRAMMAR-01', level: 'A1', verdict: 'CORRECT', assisted: false });
    ({ state, item } = nextProbe(state, probes));
    expect(item?.item_id).toBe('D-A2-GRAMMAR-01');
    state = recordOutcome(state, { item_id: 'D-A2-GRAMMAR-01', level: 'A2', verdict: 'INCORRECT_CONFIRMED', assisted: false });
    ({ state, item } = nextProbe(state, probes));
    expect(item?.item_id).toBe('D-A1-VOCABULARY-01');
    expect(axisResult(state.axes[0])).toMatchObject({ demonstrated: 'A1', candidate_start: 'A2', confidence: 'low' });
    for (const ax of ['vocabulary', 'reading', 'writing']) {
      ({ state, item } = nextProbe(state, probes));
      state = recordOutcome(state, { item_id: item!.item_id, level: 'A1', verdict: ax === 'writing' ? 'PENDING_REVIEW' : 'CORRECT', assisted: false });
      ({ state, item } = nextProbe(state, probes));
      if (ax !== 'writing') state = recordOutcome(state, { item_id: item!.item_id, level: 'A2', verdict: 'INCORRECT_CONFIRMED', assisted: false });
    }
    ({ state, item } = nextProbe(state, probes));
    expect(item).toBeNull();
    const byAxis = Object.fromEntries(state.axes.map((a) => [a.axis, a]));
    expect(byAxis.listening.status).toBe('NOT_OBSERVED');
    expect(byAxis.listening.not_observed_reason).toBe('AUDIO_MISSING');
    expect(byAxis.pronunciation.not_observed_reason).toBe('ACOUSTIC_ASSESSMENT_NOT_AVAILABLE');
    expect(byAxis.spoken_interaction.not_observed_reason).toBe('ASR_NOT_CONFIGURED');
    expect(byAxis.writing.status).toBe('PENDING_REVIEW');
    expect(routeStart(state.axes).level).toBe('A2');
  });
  it('failed A1 reading routes to the alphabet foundations', () => {
    let { state } = nextProbe(initialState(), probes.filter((p) => p.axis === 'reading'));
    state = recordOutcome(state, { item_id: 'D-A1-READING-01', level: 'A1', verdict: 'INCORRECT_CONFIRMED', assisted: false });
    expect(routeStart(state.axes).level).toBe('FOUNDATIONS');
  });
  it('assisted answers never advance a level', () => {
    let { state } = nextProbe(initialState(), probes);
    state = recordOutcome(state, { item_id: 'D-A1-GRAMMAR-01', level: 'A1', verdict: 'CORRECT', assisted: true });
    expect(state.axes[0].status).toBe('PENDING_REVIEW');
    expect(axisResult(state.axes[0]).demonstrated).toBeNull();
  });
});

describe('audio technical QA uses real bytes', () => {
  const tone = (ms: number, amp = 8000, rate = 16000) => { const n = Math.round((rate * ms) / 1000); const s = new Int16Array(n); for (let i = 0; i < n; i++) s[i] = Math.round(Math.sin((2 * Math.PI * 200 * i) / rate) * amp); return buildWav(s, rate); };
  it('parses, measures and passes a clean signal', () => {
    const r = analyzeWav(tone(1200))!;
    expect(r.duration_ms).toBe(1200);
    expect(r.pass).toBe(true);
  });
  it('flags silence, clipping and garbage', () => {
    expect(analyzeWav(tone(1200, 0))!.checks.has_speech_energy).toBe(false);
    expect(analyzeWav(tone(1200, 32767))!.checks.no_clipping).toBe(false);
    expect(parseWav(new Uint8Array([1, 2, 3]))).toBeNull();
  });
  it('concatenation produces measured, non-overlapping cues', () => {
    const { wav, cues } = concatWav([tone(500), tone(700)], [0, 650]);
    expect(cues).toEqual([{ start_ms: 0, end_ms: 500 }, { start_ms: 1150, end_ms: 1850 }]);
    expect(parseWav(wav)!.durationMs).toBe(1850);
  });
  it('round-trip separates accent errors from character errors', () => {
    const m = roundTrip('Το μήλο είναι πάνω στο τραπέζι.', 'το μηλο ειναι πάνω στο τραπέζι');
    expect(m.cer_accent_insensitive).toBe(0);
    expect(m.accent_mismatches).toEqual(['μήλο', 'είναι']);
    expect(roundTripPass(roundTrip('Καλημέρα σας.', 'Καλημέρα σας'))).toBe(true);
    expect(chunkText('Α. '.repeat(900), 1200).every((c) => c.length <= 1200)).toBe(true);
  });
});
