import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ItemEnvelope } from '@/lib/content/types';
import { buildItemDTO, assertNoLeak } from '@/lib/content/dto';
import { autosaveDecision, componentDurationMinutes, displayComponentId, formatClock, isExpired, sanitizeAnswers } from '@/lib/exams/core';
import { scoreExamDeterministic, summarize } from '@/lib/exams/score';
import { attestationLabel, groupCatalog, pegpSourceRefs, pegpTopicOfItem, prosodyLabel, riskWarnings, type RgPayload } from '@/lib/modules/display';

const corpus = resolve(process.env.CORPUS_ROOT ?? '../spec/GreekOS_CLAUDE_UPLOAD_READY');
const items: ItemEnvelope[] = JSON.parse(readFileSync(resolve(corpus, 'HANDOFF_IMPORT/items.json'), 'utf8'));
const byId = new Map(items.map((i) => [i.item_id, i]));
const adj = JSON.parse(readFileSync(resolve(corpus, 'GreekOS_B2_Exam_Bank/U01_JOINT_ADJUDICATION.json'), 'utf8'));
const exams = JSON.parse(readFileSync(resolve(corpus, 'HANDOFF_IMPORT/exams.json'), 'utf8'));
const component = (id: string) => exams.forms.flatMap((f: { components: Array<{ form_id: string; item_ids: string[] }> }) => f.components).find((c: { form_id: string }) => c.form_id === id);

describe('exam timing and autosave rules', () => {
  it('derives declared minutes without inventing zero', () => {
    expect(componentDurationMinutes(30, {}).minutes).toBe(30);
    expect(componentDurationMinutes(null, { duration: 45 }).minutes).toBe(45);
    expect(componentDurationMinutes(null, { minutes: 85 }).minutes).toBe(85);
    expect(componentDurationMinutes(null, { author_timing_minutes: 45 }).minutes).toBe(45);
    expect(componentDurationMinutes(null, { sections: [{ minutes: 20 }, { minutes: 25 }] }).minutes).toBe(45);
    expect(componentDurationMinutes(null, { sections: [{ minutes_approx: 15 } as never] }).minutes).toBeNull();
    expect(componentDurationMinutes(null, null).minutes).toBeNull();
  });

  it('accepts only strictly increasing autosaves on live attempts', () => {
    const live = { status: 'IN_PROGRESS', autosave_seq: 3, server_expires_at: new Date(Date.now() + 60_000).toISOString() };
    expect(autosaveDecision(live, 4)).toEqual({ ok: true });
    expect(autosaveDecision(live, 3)).toEqual({ ok: false, code: 'STALE' });
    expect(autosaveDecision({ ...live, status: 'SUBMITTED' }, 9)).toEqual({ ok: false, code: 'SUBMITTED' });
    expect(autosaveDecision({ ...live, server_expires_at: new Date(Date.now() - 60_000).toISOString() }, 9)).toEqual({ ok: false, code: 'EXPIRED' });
    expect(autosaveDecision({ ...live, server_expires_at: null }, 9)).toEqual({ ok: true });
    expect(isExpired(new Date(Date.now() - 5_000).toISOString())).toBe(false); // within grace window
  });

  it('sanitises answers to this component only', () => {
    const clean = sanitizeAnswers({ A: { choice: '1', extra: 'x' }, B: { text: '' }, FOREIGN: { text: 'x' }, C: { text: 'y'.repeat(7000) } }, ['A', 'B', 'C']);
    expect(Object.keys(clean).sort()).toEqual(['A', 'C']);
    expect(clean.A).toEqual({ choice: '1' });
    expect(clean.C.text!.length).toBe(6000);
  });

  it('keeps canonical KEG-B2-P01 while displaying logical W01', () => {
    expect(displayComponentId('KEG-B2-P01', 'KEG-B2-W01')).toBe('KEG-B2-W01');
    expect(displayComponentId('KEG-B2-R01', 'KEG-B2-R01')).toBe('KEG-B2-R01');
    expect(formatClock(3_725_000)).toBe('1:02:05');
  });
});

describe('exam scoring', () => {
  const u01 = component('KEG-B2-U01').item_ids.map((id: string) => byId.get(id)!);
  const cItems = u01.filter((i: ItemEnvelope) => i.scoring.strategy === 'JOINT_BANK_REVIEW');

  it('U01 C1–C7 judged as one vector: canonical provisional, unlisted held, never per-gap', () => {
    const ordered = [...cItems].sort((a, b) => Number((a.stimulus as { gap: number }).gap) - Number((b.stimulus as { gap: number }).gap));
    const canonical = Object.fromEntries(ordered.map((i, k) => [i.item_id, { text: adj.canonical_solution[k] }]));
    const r1 = scoreExamDeterministic(cItems, canonical, adj);
    expect(r1.every((r) => r.verdict === 'CORRECT' && !r.reliable && r.scorer === 'joint_bank')).toBe(true);
    const swapped = { ...canonical, [ordered[0].item_id]: { text: 'δηλαδή' } };
    const r2 = scoreExamDeterministic(cItems, swapped, adj);
    expect(r2.every((r) => r.verdict === 'PENDING_REVIEW')).toBe(true);
    expect(scoreExamDeterministic(cItems, canonical, null).every((r) => r.verdict === 'PENDING_REVIEW')).toBe(true);
  });

  it('keyed reading items are reliable; writing needs rubric review; blanks are not assessed', () => {
    const g01 = byId.get('KEG-B2-R01-G01')!;
    const keyIdx = (g01.options as string[]).indexOf(String(g01.answer[0]));
    const wrongIdx = keyIdx === 0 ? 1 : 0;
    const w = byId.get('KEG-B2-P01-W01')!;
    const res = scoreExamDeterministic([g01, byId.get('KEG-B2-R01-G02')!, w], { [g01.item_id]: { choice: String(keyIdx) }, [w.item_id]: { text: 'Αγαπητέ φίλε, ...' } }, adj);
    expect(res[0]).toMatchObject({ verdict: 'CORRECT', reliable: true, keyed: true });
    expect(res[1]).toMatchObject({ verdict: 'NOT_ASSESSED', answered: false });
    expect(res[2]).toMatchObject({ verdict: 'PENDING_REVIEW', needs_ai: true, keyed: false });
    const wrong = scoreExamDeterministic([g01], { [g01.item_id]: { choice: String(wrongIdx) } }, adj);
    expect(wrong[0]).toMatchObject({ verdict: 'INCORRECT_CONFIRMED', reliable: true });
    const s = summarize(res);
    expect(s).toMatchObject({ total: 3, answered: 2, unanswered: 1, keyed_total: 2, keyed_correct_reliable: 1, held_for_review: 1 });
  });

  it('candidate DTOs for all 213 exam items leak no keys and hide criteria', () => {
    const keg = items.filter((i) => i.module === 'keg_b2');
    expect(keg.length).toBe(213);
    for (const i of keg) {
      const dto = buildItemDTO({ item: i, contentHash: 'a'.repeat(64), examMode: true });
      assertNoLeak(dto);
      expect(dto.criteria_ru).toEqual([]);
      if (i.requires_audio && (i.stimulus as { asset_id?: string } | null)?.asset_id) expect(dto.stimulus?.text).toBeUndefined();
    }
  });
});

describe('ΠΕΓΠ and Real Greek helpers', () => {
  it('maps all 103 ΠΕΓΠ items to P01–P06', () => {
    const pegp = items.filter((i) => i.module === 'pegp');
    expect(pegp.length).toBe(103);
    const counts: Record<string, number> = {};
    for (const i of pegp) counts[pegpTopicOfItem(i.item_id)] = (counts[pegpTopicOfItem(i.item_id)] ?? 0) + 1;
    expect(Object.keys(counts).sort()).toEqual(['P01', 'P02', 'P03', 'P04', 'P05', 'P06']);
    expect(counts.P01).toBe(12);
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(103);
  });

  it('exposes only whitelisted ΠΕΓΠ source metadata', () => {
    const refs = pegpSourceRefs(byId.get('PEGP-P04-GEO-002')!.original_payload);
    expect(refs[0]).toMatchObject({ bank_version: '2026/11', pdf_page: 15, checked_on: '2026-10-17' });
    expect(Object.keys(refs[0])).not.toContain('sha256');
    expect(groupCatalog([{ title: 'Κατανόηση Προφορικού Λόγου - Θέμα 16', coverage: 'NO_DIRECT_ITEM_LINK_FOUND' }, { title: 'Κατανόηση Προφορικού Λόγου - Θέμα 17', coverage: 'X' }])[0]).toEqual({ family: 'Κατανόηση Προφορικού Λόγου', total: 2, pending: 1, linked: 1 });
  });

  it('Real Greek: unknown attestation stays unknown, missing audio blocks prosody claims, risks shown', () => {
    const rg = JSON.parse(readFileSync(resolve(corpus, 'GreekOS_Real_Greek/expressions/RG-0003.json'), 'utf8')) as RgPayload;
    expect(prosodyLabel(rg)).toMatchObject({ available: false, text: 'Интонация без звука не проверяется' });
    expect(riskWarnings(rg).length).toBeGreaterThan(0);
    expect(attestationLabel({ id: 'X', expression: 'x' })).toBe('неизвестно');
    expect(attestationLabel(rg)).not.toBe('неизвестно');
  });
});
