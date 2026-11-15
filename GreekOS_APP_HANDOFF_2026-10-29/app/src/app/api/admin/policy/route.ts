import { z } from 'zod';
import { route, jsonBody } from '@/lib/api';
import { apiOwner, audit, HttpError } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';
import { POLICY_RISKS, POLICY_STATEMENT } from '@/lib/admin/labels';
import { activePolicy } from '@/lib/admin/releases';
import { delegationRecord, editorialRelease, editorialAudioRelease } from '@/lib/qa/editorial';

const Body = z.object({ acknowledged: z.array(z.string()).min(1), confirm_text: z.literal('ПРИНИМАЮ РИСК'), delegate_editorial: z.boolean().optional() }).strict();

/**
 * Signs the owner's digital-only publication policy; every listed risk must be acknowledged. With
 * `delegate_editorial` the owner also delegates the sample review and batch release of PASS material
 * (and of checked audio once the owner records the provider's terms) to the AI editor; the release
 * then runs at once if everything it needs is ready, and is recorded as the AI editor's.
 */
export const maxDuration = 120;

export const POST = route(async (req) => {
  const owner = await apiOwner();
  const b = Body.parse(await jsonBody(req));
  const missing = POLICY_RISKS.filter((r) => !b.acknowledged.includes(r.id));
  if (missing.length) throw new HttpError(400, 'RISKS_NOT_ACKNOWLEDGED', 'Нужно подтвердить каждый пункт риска.');
  if (await activePolicy()) throw new HttpError(409, 'POLICY_ACTIVE', 'Политика уже действует. Сначала отзовите текущую.');
  const { data, error } = await adminClient().from('publication_policies').insert({
    kind: 'DIGITAL_ONLY_RISK_ACCEPTED', version: b.delegate_editorial ? '2.0' : '1.0', statement_ru: POLICY_STATEMENT,
    risks_acknowledged: POLICY_RISKS.map((r) => ({ ...r, acknowledged: true })), signed_by: owner.userId,
    delegation: b.delegate_editorial ? delegationRecord() : null,
  }).select('id').single();
  if (error) throw new Error(error.message);
  await audit(owner.userId, 'policy.signed', { id: data.id }, { kind: 'DIGITAL_ONLY_RISK_ACCEPTED', version: b.delegate_editorial ? '2.0' : '1.0', delegated: !!b.delegate_editorial });
  if (!b.delegate_editorial) return { ok: true, policy_id: data.id };
  const content = await editorialRelease().catch((e: Error) => ({ status: 'pending' as const, reason: e.message }));
  const audio = await editorialAudioRelease().catch((e: Error) => ({ status: 'pending' as const, reason: e.message }));
  return { ok: true, policy_id: data.id, editorial: { content, audio } };
});
