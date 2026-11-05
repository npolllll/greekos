import 'server-only';
import { adminClient } from '../supabase/admin.ts';
import { releaseMap, type Viewer } from '../content/repo.ts';

/**
 * Course glossary for deterministic speaking help: vocabulary entries authored in the units the viewer
 * may open. Used instead of generated help when the AI model is not validated for Greek, so a learner
 * never gets an invented translation. Matching is accent-, case- and final-sigma-insensitive.
 */
export interface GlossEntry { lemma: string; meaning_ru: string; example: string | null; unit_id: string; unit_title: string }

const fold = (x: string) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/ς/g, 'σ');
const GREEK_WORD = /[\p{Script=Greek}]+/gu;
const RU_WORD = /[\p{Script=Cyrillic}]{3,}/gu;
const RU_STOP = new Set(['как', 'сказать', 'что', 'это', 'мне', 'для', 'или', 'по-гречески', 'греческий', 'значит', 'пожалуйста']);

export async function courseGlossary(viewer: Viewer & { isOwner?: boolean }): Promise<GlossEntry[]> {
  const db = adminClient();
  const { data: units } = await db.from('units').select('unit_id, title_ru, current_hash, teaching');
  const rel = await releaseMap('unit', (units ?? []).map((u) => ({ id: u.unit_id, hash: u.current_hash })), viewer);
  const out: GlossEntry[] = [];
  for (const u of units ?? []) {
    if (!rel.has(u.unit_id) && !viewer.isOwner) continue;
    const t = (u.teaching ?? {}) as { vocabulary_items?: Array<{ lemma?: string; meaning_ru?: string; example?: string }> };
    for (const v of t.vocabulary_items ?? []) if (v.lemma && v.meaning_ru) out.push({ lemma: v.lemma, meaning_ru: v.meaning_ru, example: v.example ?? null, unit_id: u.unit_id, unit_title: u.title_ru });
  }
  return out;
}

/** Entries whose lemma (or each word of a multi-word lemma) occurs in the Greek text. Stem match tolerates inflection of 4+ letter stems. */
export function glossGreek(text: string, glossary: GlossEntry[], limit = 6): GlossEntry[] {
  const words = [...text.matchAll(GREEK_WORD)].map((m) => fold(m[0]));
  const hit = (lemma: string) => fold(lemma).split(/\s+/).every((lw) => words.some((w) => w === lw || (lw.length >= 5 && w.length >= 5 && w.slice(0, lw.length - 2) === lw.slice(0, lw.length - 2))));
  const seen = new Set<string>();
  return glossary.filter((g) => { const k = fold(g.lemma); if (seen.has(k) || !hit(g.lemma)) return false; seen.add(k); return true; }).slice(0, limit);
}

/** Reverse lookup for «Как сказать?»: entries whose Russian meaning shares a content word with the question. */
export function glossRussian(question: string, glossary: GlossEntry[], limit = 5): GlossEntry[] {
  const words = [...question.toLowerCase().matchAll(RU_WORD)].map((m) => m[0]).filter((w) => !RU_STOP.has(w));
  if (!words.length) return [];
  const stem = (w: string) => w.slice(0, Math.max(3, w.length - 2));
  const scored = glossary.map((g) => ({ g, s: words.filter((w) => g.meaning_ru.toLowerCase().includes(stem(w))).length })).filter((x) => x.s > 0);
  const seen = new Set<string>();
  return scored.sort((a, b) => b.s - a.s).map((x) => x.g).filter((g) => { const k = fold(g.lemma); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, limit);
}
