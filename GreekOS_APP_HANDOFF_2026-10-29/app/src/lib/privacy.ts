import 'server-only';
import { adminClient } from './supabase/admin.ts';

export const LEARNER_TABLES = [
  'profiles', 'enrollments', 'preferences', 'learning_routes', 'route_changes', 'lesson_sessions', 'attempts', 'assessments',
  'mastery_events', 'competency_state', 'spaced_reviews', 'error_evidence', 'appeals', 'feedback_events',
  'context_transfer_attempts', 'placement_sessions', 'placement_axis_results', 'learner_events', 'activity_days',
  'consents', 'speaking_sessions', 'speaking_turns', 'voice_artifacts', 'exam_attempts',
] as const;

/** Full export of one learner's own data (JSON). Content keys/editor material are not learner data. */
export async function exportLearnerData(userId: string) {
  const db = adminClient();
  const out: Record<string, unknown> = { exported_at: new Date().toISOString(), user_id: userId, format: 'greekos-learner-export/1' };
  for (const t of LEARNER_TABLES) {
    const { data, error } = await db.from(t).select('*').eq('user_id', userId).limit(50_000);
    out[t] = error ? { error: error.message } : data;
  }
  return out;
}

/** Deletes stored voice artifacts, then the auth user; FK cascades remove all learner rows. */
export async function deleteLearnerAccount(userId: string) {
  const db = adminClient();
  const { data: files } = await db.storage.from('voice-review').list(userId, { limit: 1000 });
  for (const folder of files ?? []) {
    const { data: inner } = await db.storage.from('voice-review').list(`${userId}/${folder.name}`, { limit: 1000 });
    const paths = (inner ?? []).map((f) => `${userId}/${folder.name}/${f.name}`);
    if (paths.length) await db.storage.from('voice-review').remove(paths);
  }
  await db.rpc('admin_revoke_user_sessions', { target: userId });
  const { error } = await db.auth.admin.deleteUser(userId);
  if (error) throw new Error(`delete failed: ${error.message}`);
}
