/**
 * The course's own vetted Greek (unit examples and texts, scenario lines and example answers, item
 * answers, stimuli and model responses — error-correction items excluded) as an index of sentences and
 * word trigrams. A model "correction" of a fragment the course itself uses verbatim contradicts the
 * course material and is dropped. Loaded lazily, refreshed every 10 minutes.
 */
import { adminClient, selectAll } from '../supabase/admin.ts';

const INTENTIONAL = /исправ|ошибк|лишн|найдите неверн|ударени|поставьте знак/i;
const fold = (t: string) => t.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{M}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const greek = (s: unknown): string[] => {
  if (typeof s === 'string') return /\p{Script=Greek}{2,}/u.test(s) ? [s] : [];
  if (Array.isArray(s)) return s.flatMap(greek);
  if (s && typeof s === 'object') return Object.values(s).flatMap(greek);
  return [];
};

export interface VettedIndex { sentences: Set<string>; trigrams: Set<string> }
let cache: { at: number; idx: Promise<VettedIndex> } | null = null;

async function build(): Promise<VettedIndex> {
  const db = adminClient();
  const texts: string[] = [];
  const { data: units } = await db.from('units').select('teaching');
  for (const u of units ?? []) {
    const t = (u.teaching ?? {}) as Record<string, unknown>;
    for (const k of ['examples_el', 'reading_text_el', 'reading_texts_el', 'vocabulary_items']) texts.push(...greek(t[k]));
  }
  const { data: scen } = await db.from('speaking_scenarios').select('payload');
  for (const s of scen ?? []) for (const n of (s.payload as { nodes?: Array<{ assistant_el?: string; acceptable_examples_el?: string[] }> }).nodes ?? []) texts.push(...greek([n.assistant_el, n.acceptable_examples_el]));
  const items = await selectAll<{ envelope: Record<string, unknown> }>((f, t) => db.from('items').select('envelope').order('item_id').range(f, t));
  for (const { envelope: e } of items) {
    if (INTENTIONAL.test(String(e.prompt ?? '')) || /error|correct/i.test(String(e.type ?? ''))) continue;
    texts.push(...greek([e.answer, e.accepted_alternatives, e.model_response, e.stimulus]));
  }
  const sentences = new Set<string>();
  const trigrams = new Set<string>();
  for (const t of texts) for (const raw of t.split(/(?<=[.!?;])\s+|\n+/u)) {
    const s = fold(raw.replace(/^[^:\n]{1,20}:\s*/u, '')); // dialogue lines: drop the speaker label
    if (!s) continue;
    sentences.add(s);
    const w = s.split(' ');
    for (let i = 0; i + 2 < w.length; i++) trigrams.add(`${w[i]} ${w[i + 1]} ${w[i + 2]}`);
  }
  return { sentences, trigrams };
}

export function vettedIndex(): Promise<VettedIndex> {
  if (!cache || Date.now() - cache.at > 600_000) {
    const idx = build();
    cache = { at: Date.now(), idx };
    idx.catch(() => { cache = null; });
  }
  return cache.idx;
}

/** Whether the course itself uses this fragment verbatim (a sentence, or a run of ≥ 3 words). */
export function attested(fragment: string, idx: VettedIndex): boolean {
  const s = fold(fragment);
  if (!s) return false;
  if (idx.sentences.has(s)) return true;
  const w = s.split(' ');
  if (w.length < 3) return false;
  for (let i = 0; i + 2 < w.length; i++) if (!idx.trigrams.has(`${w[i]} ${w[i + 1]} ${w[i + 2]}`)) return false;
  return true;
}
