import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Where unit tests read canonical corpus files: CORPUS_ROOT, else the original corpus folder next to
 * the app, else the snapshot rebuilt from the database (`npx tsx scripts/export-corpus-snapshot.ts`).
 */
const ORIGINAL = resolve('../spec/GreekOS_CLAUDE_UPLOAD_READY');
export const CORPUS = resolve(process.env.CORPUS_ROOT ?? (existsSync(resolve(ORIGINAL, 'HANDOFF_IMPORT/items.json')) ? ORIGINAL : '.corpus-snapshot'));

export const hasCorpusFile = (rel: string) => existsSync(resolve(CORPUS, rel));

export function corpusJson<T = unknown>(rel: string): T {
  const p = resolve(CORPUS, rel);
  if (!existsSync(p)) throw new Error(`Corpus file missing: ${p}. Set CORPUS_ROOT or run: npx tsx scripts/export-corpus-snapshot.ts`);
  return JSON.parse(readFileSync(p, 'utf8')) as T;
}
