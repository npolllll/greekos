import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, createUser, deleteUser, type TestUser } from './helpers';
import { setOwnerRole } from '@/lib/admin/learners';

/** Co-owner role management: confirmation, self-protection, audit. (The last-owner guard is not exercised here: it would demote the real local owners.) */
let owner: TestUser;
let learner: TestUser;

beforeAll(async () => {
  owner = await createUser({ owner: true });
  learner = await createUser();
});
afterAll(async () => {
  for (const u of [learner, owner]) if (u) await deleteUser(u);
});

const roles = async (id: string) => ((await admin.from('role_assignments').select('role').eq('user_id', id)).data ?? []).map((r) => r.role).sort();

describe('owner role management', () => {
  it('granting needs the account e-mail typed back; then the account is a co-owner', async () => {
    await expect(setOwnerRole(owner.session, learner.id, { grant: true, confirm_email: 'wrong@x.test', reason: 'test' })).rejects.toMatchObject({ code: 'CONFIRM' });
    expect(await roles(learner.id)).toEqual(['learner']);
    await setOwnerRole(owner.session, learner.id, { grant: true, confirm_email: learner.email.toUpperCase(), reason: 'co-owner for tests' });
    expect(await roles(learner.id)).toEqual(['learner', 'owner_admin']);
    const { data: log } = await admin.from('admin_audit_log').select('action, meta').eq('target_user_id', learner.id).eq('action', 'role.owner_granted');
    expect(log?.length).toBe(1);
  });

  it('nobody changes their own role, and removal keeps the learner role', async () => {
    await expect(setOwnerRole(owner.session, owner.id, { grant: false, reason: 'self' })).rejects.toMatchObject({ code: 'SELF_TARGET' });
    await setOwnerRole(owner.session, learner.id, { grant: false, reason: 'back to learner' });
    expect(await roles(learner.id)).toEqual(['learner']);
  });
});
