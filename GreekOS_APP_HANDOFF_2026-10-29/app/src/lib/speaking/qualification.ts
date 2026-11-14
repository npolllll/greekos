/**
 * Dialogue qualification of the configured LLM. A local model may generate what learners hear only
 * after it passed the GreekOS speaking evaluation (scripts/speaking-eval.ts) on this machine; the
 * evaluation writes local-services/llm/qualification.json. Cloud providers are not evaluated here
 * (no keys at this stage): their generation is allowed by configuration and labelled by provider.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { env } from '../env.ts';
import { isLocalLlm, llmConfigured } from '../providers/llm.ts';

export interface Qualification {
  model: string;
  suite: string;
  evaluated_at: string;
  cases: number;
  passed: boolean;
  metrics: Record<string, number>;
  thresholds: Record<string, number>;
  note_ru?: string;
}

// Read at runtime only (local development); not part of the deployed bundle.
const file = () => resolve(/* turbopackIgnore: true */ process.cwd(), process.env.LLM_QUALIFICATION_FILE ?? 'local-services/llm/qualification.json');

export function qualificationOf(model: string | null | undefined): Qualification | null {
  const FILE = file();
  if (!model || !existsSync(FILE)) return null;
  try {
    const all = JSON.parse(readFileSync(FILE, 'utf8')) as Record<string, Qualification>;
    return all[model] ?? null;
  } catch {
    return null;
  }
}

/** May the configured model generate the persona's Greek (instead of authored lines only)? */
export function generationAllowed(): boolean {
  if (!llmConfigured()) return false;
  // The evaluation itself runs before a model is qualified (local/test only).
  if (process.env.GREEKOS_EVAL_FORCE_GENERATION === '1' && env.localEnginesAllowed) return true;
  if (!isLocalLlm()) return true;
  return !!qualificationOf(env.llmCompatModel)?.passed;
}
