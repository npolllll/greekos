import { describe, expect, it } from 'vitest';
import { admin } from './helpers';
import { route } from '@/lib/api';
import { HttpError } from '@/lib/auth';

/** Unexpected server errors reach the owner's log (route, method, class, short message); expected
 * refusals (validation, 4xx) do not; the learner sees a neutral message, never the internals. */
describe('server error log', () => {
  it('records an unexpected 500 and not a deliberate refusal', async () => {
    const path = `/api/test-observability-${Date.now()}`;
    const boom = route(async () => { throw new TypeError('cannot read properties of undefined (reading "x")'); });
    const res = await boom(new Request(`http://local${path}`, { method: 'POST' }), {});
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'INTERNAL', message: 'Внутренняя ошибка. Данные не изменены.' });
    const refused = route(async () => { throw new HttpError(403, 'FORBIDDEN', 'Нет доступа'); });
    expect((await refused(new Request(`http://local${path}/refused`, { method: 'GET' }), {})).status).toBe(403);
    let rows: Array<{ path: string; kind: string; method: string }> = [];
    for (let i = 0; i < 20 && !rows.length; i++) {
      rows = (await admin.from('server_errors').select('path, kind, method').like('path', `${path}%`)).data ?? [];
      if (!rows.length) await new Promise((r) => setTimeout(r, 100));
    }
    expect(rows).toEqual([{ path, kind: 'TypeError', method: 'POST' }]);
    await admin.from('server_errors').delete().like('path', `${path}%`);
  });
});
