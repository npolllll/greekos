import { z } from 'zod';
import { route, jsonBody } from '@/lib/api';
import { apiOwner, audit, HttpError } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';
import { POLICY_RISKS, POLICY_STATEMENT } from '@/lib/admin/labels';
import { activePolicy } from '@/lib/admin/releases';

const Body = z.object({ acknowledged: z.array(z.string()).min(1), confirm_text: z.literal('ПРИНИМАЮ РИСК') }).strict();

/** Signs the owner's digital-only publication policy; every listed risk must be acknowledged. */
export const POST = route(async (req) => {
  const owner = await apiOwner();
  const b = Body.parse(await jsonBody(req));
  const missing = POLICY_RISKS.filter((r) => !b.acknowledged.includes(r.id));
  if (missing.length) throw new HttpError(400, 'RISKS_NOT_ACKNOWLEDGED', 'Нужно подтвердить каждый пункт риска.');
  if (await activePolicy()) throw new HttpError(409, 'POLICY_ACTIVE', 'Политика уже действует. Сначала отзовите текущую.');
  const { data, error } = await adminClient().from('publication_policies').insert({
    kind: 'DIGITAL_ONLY_RISK_ACCEPTED', version: '1.0', statement_ru: POLICY_STATEMENT,
    risks_acknowledged: POLICY_RISKS.map((r) => ({ ...r, acknowledged: true })), signed_by: owner.userId,
  }).select('id').single();
  if (error) throw new Error(error.message);
  await audit(owner.userId, 'policy.signed', { id: data.id }, { kind: 'DIGITAL_ONLY_RISK_ACCEPTED', version: '1.0' });
  return { ok: true, policy_id: data.id };
});
