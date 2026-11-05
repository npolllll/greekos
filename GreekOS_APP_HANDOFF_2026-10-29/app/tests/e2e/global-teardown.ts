import { admin, readState } from './fixtures';

/** Removes synthetic e2e users and SYN- fixtures so the local database stays clean. */
export default async function globalTeardown() {
  const db = admin();
  const s = readState();
  for (const u of [s.owner, s.learner, s.learner2]) await db.auth.admin.deleteUser(u.id);
  await db.from('content_releases').delete().like('content_id', 'SYN-%');
  await db.from('items').delete().like('item_id', 'SYN-E2E-%');
  await db.from('units').delete().eq('unit_id', 'SYN-UNIT-A1');
}
