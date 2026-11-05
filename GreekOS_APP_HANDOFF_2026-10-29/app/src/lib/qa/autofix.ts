/**
 * Deterministic digital-QA corrections that need no linguistic judgement: a word typed with letters
 * of two alphabets (a Greek Κ inside a Russian word, a Cyrillic к inside a Greek word) is rewritten in
 * the alphabet of its majority, but only when every foreign letter has an unambiguous look-alike there.
 * Each fix is a new revision through the normal patch path (history, release revocation, re-run QA),
 * recorded with the system actor below — never as an owner's or reviewer's decision.
 */
import { adminClient } from '../supabase/admin.ts';
import { patchItem, patchUnit } from './release.ts';

export const AUTOFIX_ACTOR = 'digital-qa-autofix/1.0';

// Look-alike letters (same glyph shape) between Greek, Cyrillic and Latin.
const GREEK_OF: Record<string, string> = {
  А: 'Α', В: 'Β', Е: 'Ε', К: 'Κ', М: 'Μ', Н: 'Η', О: 'Ο', Р: 'Ρ', С: 'Ϲ', Т: 'Τ', Х: 'Χ', а: 'α', е: 'ε', к: 'κ', о: 'ο', р: 'ρ', х: 'χ', у: 'γ',
  A: 'Α', B: 'Β', E: 'Ε', H: 'Η', I: 'Ι', K: 'Κ', M: 'Μ', N: 'Ν', O: 'Ο', P: 'Ρ', T: 'Τ', X: 'Χ', Y: 'Υ', Z: 'Ζ', o: 'ο', v: 'ν',
};
const CYRILLIC_OF: Record<string, string> = {
  Α: 'А', Β: 'В', Ε: 'Е', Κ: 'К', Μ: 'М', Η: 'Н', Ο: 'О', Ρ: 'Р', Τ: 'Т', Χ: 'Х', α: 'а', ε: 'е', κ: 'к', ο: 'о', ρ: 'р', χ: 'х',
  A: 'А', B: 'В', E: 'Е', H: 'Н', K: 'К', M: 'М', O: 'О', P: 'Р', T: 'Т', X: 'Х', a: 'а', e: 'е', o: 'о', p: 'р', c: 'с', x: 'х', y: 'у',
};

const script = (ch: string) => (/\p{Script=Greek}/u.test(ch) ? 'greek' : /\p{Script=Cyrillic}/u.test(ch) ? 'cyrillic' : /\p{Script=Latin}/u.test(ch) ? 'latin' : null);

/** Returns the word rewritten in its majority alphabet, or null if it is not mixed or not safely fixable. */
export function fixMixedWord(word: string): string | null {
  const letters = [...word].filter((c) => script(c));
  const counts = { greek: 0, cyrillic: 0, latin: 0 };
  for (const c of letters) counts[script(c)!] += 1;
  const used = Object.entries(counts).filter(([, n]) => n > 0);
  if (used.length < 2) return null;
  const major = used.sort((a, b) => b[1] - a[1])[0][0] as 'greek' | 'cyrillic' | 'latin';
  if (major === 'latin') return null;
  const table = major === 'greek' ? GREEK_OF : CYRILLIC_OF;
  let out = '';
  for (const c of word) {
    const s = script(c);
    if (!s || s === major) { out += c; continue; }
    const to = table[c];
    if (!to) return null; // a foreign letter with no look-alike: needs a person
    out += to;
  }
  return out;
}

/** Fixes every mixed-alphabet word in a text; returns the new text and the replacements made. */
export function fixMixedText(text: string): { text: string; fixes: Array<{ before: string; after: string }> } {
  const fixes: Array<{ before: string; after: string }> = [];
  const out = text.replace(/[\p{L}\p{M}]+/gu, (w) => {
    const f = fixMixedWord(w);
    if (!f || f === w) return w;
    fixes.push({ before: w, after: f });
    return f;
  });
  return { text: out, fixes };
}

/** Applies mixed-alphabet fixes for all open `ortho.mixed_script` issues of the corpus. */
export async function autofixMixedScript(): Promise<Array<{ kind: string; id: string; field: string; fixes: Array<{ before: string; after: string }>; new_hash?: string; skipped?: string }>> {
  const db = adminClient();
  const { data: issues } = await db.from('qa_issues').select('id, content_kind, content_id, field').eq('check_id', 'ortho.mixed_script').eq('status', 'open');
  const done: Array<{ kind: string; id: string; field: string; fixes: Array<{ before: string; after: string }>; new_hash?: string; skipped?: string }> = [];
  for (const issue of issues ?? []) {
    if (issue.content_kind === 'unit' && (issue.field === 'theory_ru' || issue.field === 'learning_outcome')) {
      const { data: u } = await db.from('units').select('unit_id, teaching, current_hash').eq('unit_id', issue.content_id).single();
      const before = String((u!.teaching as Record<string, unknown>)[issue.field] ?? '');
      const fixed = fixMixedText(before);
      if (!fixed.fixes.length) { done.push({ kind: 'unit', id: issue.content_id, field: issue.field, fixes: [], skipped: 'NOT_SAFELY_FIXABLE' }); continue; }
      const r = await patchUnit({ system: AUTOFIX_ACTOR }, {
        unit_id: u!.unit_id, base_hash: u!.current_hash, field: issue.field, text: fixed.text, issue_id: issue.id,
        reason: `Цифровой QA: слово набрано буквами двух алфавитов, заменены буквы-двойники (${fixed.fixes.map((f) => `«${f.before}» → «${f.after}»`).join(', ')})`,
      });
      done.push({ kind: 'unit', id: issue.content_id, field: issue.field, fixes: fixed.fixes, new_hash: r.new_hash });
    } else if (issue.content_kind === 'item' && issue.field === 'prompt') {
      const { data: it } = await db.from('items').select('item_id, envelope, current_hash').eq('item_id', issue.content_id).single();
      const fixed = fixMixedText(String((it!.envelope as { prompt?: string }).prompt ?? ''));
      if (!fixed.fixes.length) { done.push({ kind: 'item', id: issue.content_id, field: 'prompt', fixes: [], skipped: 'NOT_SAFELY_FIXABLE' }); continue; }
      const r = await patchItem({ system: AUTOFIX_ACTOR }, {
        item_id: it!.item_id, base_hash: it!.current_hash, changes: { prompt: fixed.text }, issue_id: issue.id,
        reason: `Цифровой QA: смешение алфавитов, заменены буквы-двойники (${fixed.fixes.map((f) => `«${f.before}» → «${f.after}»`).join(', ')})`,
      });
      done.push({ kind: 'item', id: issue.content_id, field: 'prompt', fixes: fixed.fixes, new_hash: r.new_hash });
    } else {
      done.push({ kind: issue.content_kind, id: issue.content_id, field: issue.field ?? '', fixes: [], skipped: 'FIELD_NOT_SUPPORTED' });
    }
  }
  return done;
}
