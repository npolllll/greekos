import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { contentHash } from '@/lib/content/stable-json';
import type { ItemEnvelope } from '@/lib/content/types';
import type { SessionUser } from '@/lib/auth';

// Load local env (.env.local) for the disposable local Supabase stack.
for (const line of readFileSync(new URL('../../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
if (!/127\.0\.0\.1|localhost/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')) throw new Error('integration tests run only against a local Supabase stack');

export const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
export const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
export const admin: SupabaseClient = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
export const anon = () => createClient(URL_, ANON, { auth: { persistSession: false } });

export interface TestUser { id: string; email: string; client: SupabaseClient; session: SessionUser }

/** Creates an explicitly synthetic learner with a random password (never a real account). */
export async function createUser(opts: { owner?: boolean; tz?: string } = {}): Promise<TestUser> {
  const email = `synthetic-${randomUUID().slice(0, 8)}@greekos.test`;
  const password = randomBytes(18).toString('base64url');
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const id = data.user.id;
  const tz = opts.tz ?? 'Europe/Athens';
  await admin.from('profiles').insert({ user_id: id, display_name: 'Synthetic', email, timezone: tz, active: true, lifecycle_state: 'studying', entry_path: 'from_zero' });
  await admin.from('role_assignments').insert({ user_id: id, role: opts.owner ? 'owner_admin' : 'learner' });
  await admin.from('enrollments').insert({ user_id: id, start_date: '2026-10-01', timezone: tz });
  const client = anon();
  const s = await client.auth.signInWithPassword({ email, password });
  if (s.error) throw s.error;
  return {
    id, email, client,
    session: { userId: id, email, isOwner: !!opts.owner, devPreview: false, profile: { user_id: id, display_name: 'Synthetic', email, timezone: tz, active: true, entry_path: 'from_zero', lifecycle_state: 'studying', invited_at: null, activated_at: null } },
  };
}

export async function deleteUser(u: TestUser) {
  await admin.auth.admin.deleteUser(u.id);
}

/** Synthetic released fixtures (module synthetic_fixture, SYN- ids) — never real course content. */
export function synItem(id: string, over: Partial<ItemEnvelope>): ItemEnvelope {
  return {
    item_id: id, version: '0.0.1', prompt: 'Συμπληρώστε: Η Ρόζα ___ από την Ιταλία.', type: 'short_answer', module: 'synthetic_fixture', unit_id: null, level: 'A1',
    canonical: { path: 'synthetic', sha256: '0'.repeat(64) }, stimulus: null, model_response: null, rubric: null, estimated_effort: null,
    requires_audio: false, original_payload: { synthetic: true }, competency_ids: ['A1-G05'], prerequisite_ids: [], source_claim_ids: [], audio_job_ids: [],
    options: [], answer: ['είναι'], accepted_alternatives: [], criteria: [], error_tags: null,
    scoring: { strategy: 'EXACT_WITH_REVIEW_FALLBACK', policy: { normalization: ['NFC', 'trim', 'casefold', 'collapse_whitespace'], strip_accents: false }, automatic_final_score_allowed: false, unlisted_answer: 'HOLD_FOR_REVIEW_NO_PENALTY' },
    release: { state: 'CONTENT_GATED', learner_access: false, automatic_mastery: false, review_required: true },
    ...over,
  } as ItemEnvelope;
}

export async function upsertSynItem(env: ItemEnvelope, opts: { release?: boolean; pool?: string | null; section?: string | null } = {}) {
  const hash = contentHash(env);
  let { data: rev } = await admin.from('content_revisions').select('id').eq('content_kind', 'item').eq('content_id', env.item_id).eq('content_hash', hash).maybeSingle();
  if (!rev) ({ data: rev } = await admin.from('content_revisions').insert({ content_kind: 'item', content_id: env.item_id, content_hash: hash, module: 'synthetic_fixture', payload_private: env }).select('id').single());
  await admin.from('items').upsert({
    item_id: env.item_id, module: 'synthetic_fixture', unit_id: null, item_type: env.type, level: env.level, pool: opts.pool ?? 'course_practice', section: opts.section ?? 'guided_practice',
    requires_audio: env.requires_audio, scoring_strategy: env.scoring.strategy, competency_ids: env.competency_ids, prerequisite_ids: [], audio_job_ids: env.audio_job_ids,
    error_tags: env.error_tags, envelope: env, current_hash: hash, revision_id: rev!.id,
  });
  if (opts.release) {
    await admin.from('content_releases').insert({ content_kind: 'item', content_id: env.item_id, content_hash: hash, review_type: 'SYNTHETIC_TEST_FIXTURE', reviewer_identity: 'automated test', method: 'synthetic fixture', scope: 'learner_practice', decision: 'APPROVED', rights_scope: 'test only' });
  }
  return hash;
}
