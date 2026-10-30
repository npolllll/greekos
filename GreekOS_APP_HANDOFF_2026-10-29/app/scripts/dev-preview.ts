/**
 * DEV-PREVIEW helper for local acceptance (the same service functions as Админ → DEV-PREVIEW).
 *   npx tsx --conditions=react-server scripts/dev-preview.ts create-tester --owner owner@x --email t@x --name "Имя" [--days 14]
 *   npx tsx --conditions=react-server scripts/dev-preview.ts grant --owner owner@x --user-email t@x [--days 14]
 *   npx tsx --conditions=react-server scripts/dev-preview.ts revoke --owner owner@x --user-email t@x --reason "..."
 * Refused unless APP_ENV is local or test. Every action is written to the admin audit log as the owner.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

if (existsSync(resolve('.env.local'))) {
  for (const line of readFileSync(resolve('.env.local'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
const { adminClient } = await import('../src/lib/supabase/admin.ts');
const { loadSessionUser } = await import('../src/lib/session-user.ts');
const { createTester, grantDevPreview, revokeDevPreview } = await import('../src/lib/admin/dev-preview.ts');

const [cmd, ...rest] = process.argv.slice(2);
const arg = (k: string) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : undefined; };
const db = adminClient();
async function userIdByEmail(email: string) {
  const { data } = await db.from('profiles').select('user_id').eq('email', email).maybeSingle();
  if (!data) throw new Error(`no profile for ${email}`);
  return data.user_id as string;
}
const owner = await loadSessionUser(await userIdByEmail(arg('--owner')!));
if (!owner?.isOwner) throw new Error('--owner must be an active owner_admin');
const days = Number(arg('--days') ?? '14');
if (cmd === 'create-tester') console.log(JSON.stringify(await createTester(owner, { display_name: arg('--name') ?? 'Тестовый ученик', email: arg('--email')!, days }), null, 2));
else if (cmd === 'grant') console.log(JSON.stringify(await grantDevPreview(owner, await userIdByEmail(arg('--user-email')!), days, arg('--note'))));
else if (cmd === 'revoke') console.log(JSON.stringify(await revokeDevPreview(owner, await userIdByEmail(arg('--user-email')!), arg('--reason') ?? 'отзыв')));
else { console.error('usage: create-tester | grant | revoke'); process.exit(2); }
