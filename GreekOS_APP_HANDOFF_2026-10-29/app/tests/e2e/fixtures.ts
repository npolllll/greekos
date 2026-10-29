import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { randomBytes, randomUUID, createHash } from 'node:crypto';

export function loadEnv() {
  for (const line of readFileSync(new URL('../../.env.local', import.meta.url), 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
  if (!/127\.0\.0\.1|localhost/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')) throw new Error('e2e runs only against a local Supabase stack');
}

export const STATE_FILE = new URL('../../test-results/.e2e-users.json', import.meta.url);
export interface E2EUser { id: string; email: string; password: string }
export interface E2EState { owner: E2EUser; learner: E2EUser; learner2: E2EUser }

export function admin() {
  loadEnv();
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
}

export async function makeUser(role: 'learner' | 'owner_admin', enrolled: boolean): Promise<E2EUser> {
  const db = admin();
  const email = `synthetic-e2e-${randomUUID().slice(0, 8)}@greekos.test`;
  const password = randomBytes(18).toString('base64url');
  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const id = data.user.id;
  await db.from('profiles').insert({ user_id: id, display_name: role === 'owner_admin' ? 'E2E Владелец' : 'E2E Ученица', email, timezone: 'Europe/Athens', active: true, lifecycle_state: enrolled ? 'foundations' : 'activated', entry_path: enrolled ? 'from_zero' : null });
  await db.from('role_assignments').insert({ user_id: id, role });
  await db.from('preferences').insert({ user_id: id });
  if (enrolled) {
    await db.from('enrollments').insert({ user_id: id, start_date: new Date().toISOString().slice(0, 10), timezone: 'Europe/Athens', daily_minutes: 60 });
    await db.from('learning_routes').insert({ user_id: id, route_kind: 'foundations', start_unit_id: 'U-A1-007', reason: 'e2e synthetic' });
  }
  return { id, email, password };
}

const stable = (v: unknown): string => (v === null || typeof v !== 'object' ? JSON.stringify(v) : Array.isArray(v) ? `[${v.map(stable).join(',')}]` : `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`);
const sha = (v: unknown) => createHash('sha256').update(stable(v)).digest('hex');

/** Synthetic released unit with two items (clearly labelled; removed in teardown). */
export async function seedSyntheticUnit() {
  const db = admin();
  const teaching = {
    unit_id: 'SYN-UNIT-A1', cefr_level: 'A1', title_ru: 'Синтетический тестовый урок (e2e)', learning_outcome: 'Тестовая цель: проверка механики приложения, не учебный материал',
    theory_ru: 'Это синтетический урок для автоматических тестов. Глагол είμαι: είμαι, είσαι, είναι.', examples_el: ['Είμαι η Άννα.', 'Ο Νίκος είναι εδώ.'],
    vocabulary_items: [{ lemma: 'είμαι', meaning_ru: 'быть' }], learning_objectives: ['Проверка механики'],
    qa: { status: 'SYNTHETIC_TEST_FIXTURE', human_review: 'NOT_REVIEWED', audio_review: 'MISSING_AUDIO' },
  };
  const uhash = sha(teaching);
  let { data: urev } = await db.from('content_revisions').select('id').eq('content_kind', 'unit').eq('content_id', 'SYN-UNIT-A1').eq('content_hash', uhash).maybeSingle();
  if (!urev) ({ data: urev } = await db.from('content_revisions').insert({ content_kind: 'unit', content_id: 'SYN-UNIT-A1', content_hash: uhash, module: 'synthetic_fixture', payload_private: teaching }).select('id').single());
  await db.from('units').upsert({ unit_id: 'SYN-UNIT-A1', level: 'A1', sort_key: 100, title_ru: teaching.title_ru, teaching, current_hash: uhash, revision_id: urev!.id, competency_ids: ['A1-G05'], primary_competencies: ['A1-G05'] });
  const base = {
    version: '0.0.1', module: 'synthetic_fixture', unit_id: 'SYN-UNIT-A1', level: 'A1', canonical: { path: 'synthetic', sha256: '0'.repeat(64) }, stimulus: null, model_response: null, rubric: null,
    estimated_effort: null, requires_audio: false, original_payload: { synthetic: true }, competency_ids: ['A1-G05'], prerequisite_ids: [], source_claim_ids: [], audio_job_ids: [],
    accepted_alternatives: [], criteria: [], error_tags: null,
    release: { state: 'CONTENT_GATED', learner_access: false, automatic_mastery: false, review_required: true },
  };
  const items = [
    { ...base, item_id: 'SYN-E2E-1', prompt: 'Συμπληρώστε: Η Ρόζα ___ από την Ιταλία.', type: 'short_answer', options: [], answer: ['είναι'], scoring: { strategy: 'EXACT_WITH_REVIEW_FALLBACK', policy: { normalization: ['NFC', 'trim', 'casefold', 'collapse_whitespace'], strip_accents: false }, automatic_final_score_allowed: false, unlisted_answer: 'HOLD_FOR_REVIEW_NO_PENALTY' } },
    { ...base, item_id: 'SYN-E2E-2', prompt: 'Ποια μορφή ταιριάζει: Εγώ ___ φοιτητής;', type: 'mcq', options: ['είμαι', 'είναι', 'είσαι'], answer: ['είμαι'], scoring: { strategy: 'CHOICE_KEY', policy: {}, automatic_final_score_allowed: false, unlisted_answer: 'HOLD_FOR_REVIEW_NO_PENALTY' } },
    { ...base, item_id: 'SYN-E2E-3', prompt: 'Συμπληρώστε: Εσύ ___ ο Μάριος;', type: 'short_answer', options: [], answer: ['είσαι'], scoring: { strategy: 'EXACT_WITH_REVIEW_FALLBACK', policy: { normalization: ['NFC', 'trim', 'casefold', 'collapse_whitespace'], strip_accents: false }, automatic_final_score_allowed: false, unlisted_answer: 'HOLD_FOR_REVIEW_NO_PENALTY' } },
  ];
  for (const it of items) {
    const h = sha(it);
    let { data: rev } = await db.from('content_revisions').select('id').eq('content_kind', 'item').eq('content_id', it.item_id).eq('content_hash', h).maybeSingle();
    if (!rev) ({ data: rev } = await db.from('content_revisions').insert({ content_kind: 'item', content_id: it.item_id, content_hash: h, module: 'synthetic_fixture', payload_private: it }).select('id').single());
    await db.from('items').upsert({ item_id: it.item_id, module: 'synthetic_fixture', unit_id: 'SYN-UNIT-A1', item_type: it.type, level: 'A1', pool: 'course_practice', section: 'guided_practice', requires_audio: false, scoring_strategy: it.scoring.strategy, competency_ids: ['A1-G05'], prerequisite_ids: [], audio_job_ids: [], error_tags: null, envelope: it, current_hash: h, revision_id: rev!.id });
    await db.from('content_releases').insert({ content_kind: 'item', content_id: it.item_id, content_hash: h, review_type: 'SYNTHETIC_TEST_FIXTURE', reviewer_identity: 'e2e', method: 'synthetic', scope: 'learner_practice', decision: 'APPROVED', rights_scope: 'test only' });
  }
  await db.from('content_releases').insert({ content_kind: 'unit', content_id: 'SYN-UNIT-A1', content_hash: uhash, review_type: 'SYNTHETIC_TEST_FIXTURE', reviewer_identity: 'e2e', method: 'synthetic', scope: 'learner_practice', decision: 'APPROVED', rights_scope: 'test only' });
}

export function saveState(s: E2EState) {
  const dir = new URL('../../test-results/', import.meta.url);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(s));
}
export function readState(): E2EState {
  return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
}
