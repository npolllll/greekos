import { NextResponse } from 'next/server';
import { apiUser, handleRouteError, HttpError } from '@/lib/auth';
import { adminClient, selectAll } from '@/lib/supabase/admin';
import { loadItem, releaseMap, type ItemRow } from '@/lib/content/repo';
import { deliverItems } from '@/lib/content/delivery';
import { orderItems } from '@/lib/learning/planner';

export const dynamic = 'force-dynamic';

/**
 * Context card for a learner's own attempt: approved explanation and examples from released
 * canonical units / context library, plus a NEW independent transfer task (never the same item).
 */
export async function GET(_req: Request, ctx: { params: Promise<{ attemptId: string }> }) {
  try {
    const u = await apiUser();
    const { attemptId } = await ctx.params;
    const db = adminClient();
    const { data: attempt } = await db.from('attempts').select('attempt_id, user_id, item_id, preview').eq('attempt_id', attemptId).maybeSingle();
    if (!attempt || attempt.user_id !== u.userId) throw new HttpError(404, 'NOT_FOUND', 'Попытка не найдена');
    const item = await loadItem(attempt.item_id);
    if (!item) throw new HttpError(404, 'NOT_FOUND', 'Задание не найдено');
    const preview = attempt.preview && u.isOwner;
    const viewer = { devPreview: u.devPreview };
    const comps = item.competency_ids;
    const { data: compRows } = await db.from('competencies').select('competency_id, name, level').in('competency_id', comps.length ? comps : ['-']);

    // Explanation source: the item's own unit if released, else released units teaching the competency.
    const { data: units } = await db.from('units').select('unit_id, title_ru, level, current_hash, primary_competencies, competency_ids, teaching');
    const unitRel = await releaseMap('unit', (units ?? []).map((x) => ({ id: x.unit_id, hash: x.current_hash })), viewer);
    const usableUnit = (id: string | null) => (units ?? []).find((x) => x.unit_id === id && (unitRel.has(x.unit_id) || preview));
    const teachingUnit = usableUnit(item.unit_id) ?? (units ?? []).find((x) => (unitRel.has(x.unit_id) || preview) && (x.primary_competencies as string[]).some((c) => comps.includes(c)));
    const t = teachingUnit?.teaching as { theory_ru?: string; examples_el?: string[]; title_ru?: string } | undefined;
    const theory = t?.theory_ru ?? null;
    const paragraphs = theory ? theory.split(/\n\s*\n/).filter(Boolean) : [];
    const examples = (t?.examples_el ?? []).slice(0, 5);
    const dialogue = examples.filter((e) => e.includes('—') || e.includes(' - ')).slice(0, 3);

    // Approved context-library examples (v5.2) bound to the competency and released.
    const { data: lib } = await db.from('content_examples').select('id, competency_id, example_type, approved_text_gr, translation_ru, meaning_notes_ru, register, quality_status, text_hash').in('competency_id', comps.length ? comps : ['-']).in('quality_status', ['DIGITAL_LINGUISTIC_QA', 'HUMAN_VERIFIED']);
    const libRel = await releaseMap('context_example', (lib ?? []).map((x) => ({ id: x.id, hash: x.text_hash })));
    const library = (lib ?? []).filter((x) => libRel.has(x.id) || preview);

    // Transfer: different released item for the same competency, not a holdout, least recently seen.
    let transfer = null;
    if (comps.length) {
      const candidates = await selectAll<ItemRow>((f, to) => db.from('items').select('item_id, module, unit_id, item_type, level, pool, section, requires_audio, scoring_strategy, competency_ids, prerequisite_ids, audio_job_ids, error_tags, envelope, current_hash').overlaps('competency_ids', comps).neq('item_id', item.item_id).eq('module', item.module === 'synthetic_fixture' ? 'synthetic_fixture' : item.module).order('item_id').range(f, to));
      const eligible = candidates.filter((c) => c.pool !== 'diagnostic_holdout' && c.pool !== 'exam_holdout' && c.module !== 'keg_b2');
      const delivered = (await deliverItems(eligible, { viewer })).filter((d) => preview || d.access.learnerUsable);
      const { data: seen } = await db.from('attempts').select('item_id, created_at').eq('user_id', u.userId).order('created_at', { ascending: false }).limit(2000);
      const last = new Map<string, string>();
      for (const s of seen ?? []) if (!last.has(s.item_id)) last.set(s.item_id, s.created_at);
      const ordered = orderItems(delivered.map((d) => ({ item_id: d.dto.item_id, last_seen_at: last.get(d.dto.item_id) ?? null, d })));
      transfer = ordered[0]?.d.dto ?? null;
    }

    return NextResponse.json({
      competencies: compRows ?? [],
      unit: teachingUnit ? { unit_id: teachingUnit.unit_id, title_ru: teachingUnit.title_ru, level: teachingUnit.level } : null,
      situation: paragraphs.slice(0, 2).join('\n\n') || null,
      examples,
      dialogue,
      library: library.map((x) => ({ id: x.id, type: x.example_type, text_el: x.approved_text_gr, translation_ru: x.translation_ru, notes_ru: x.meaning_notes_ru, register: x.register, quality: x.quality_status })),
      pronunciation: { status: 'unavailable', reason: 'Проверенное синтезированное произношение для этого примера пока не выпущено.' },
      media: null,
      transfer,
      provenance: 'Авторский учебный материал GreekOS; не цитата из фильмов или реальных записей.',
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return handleRouteError(e);
  }
}
