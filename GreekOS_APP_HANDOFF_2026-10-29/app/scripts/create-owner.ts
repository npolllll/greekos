/**
 * Bootstrap the single owner_admin account (run once per environment, server credentials only).
 *   npx tsx scripts/create-owner.ts --email owner@example.com --name "Имя" [--password-file path]
 * Without --password-file an invitation e-mail (Supabase Auth) is sent instead of setting a password.
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const args = process.argv.slice(2);
const get = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const email = get('--email');
const name = get('--name') ?? 'Владелец';
const pwFile = get('--password-file');
const tz = get('--timezone') ?? 'Europe/Athens';
if (!email) { console.error('--email is required'); process.exit(2); }

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const appUrl = process.env.APP_URL ?? 'http://127.0.0.1:3210';
const db = createClient(url, key, { auth: { persistSession: false } });

let userId: string;
const { data: list } = await db.auth.admin.listUsers({ perPage: 1000 });
const existing = list?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
if (existing) {
  userId = existing.id;
  console.log('User exists:', userId);
} else if (pwFile) {
  const password = readFileSync(pwFile, 'utf8').trim();
  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  userId = data.user.id;
} else {
  const { data, error } = await db.auth.admin.inviteUserByEmail(email, { redirectTo: `${appUrl}/auth/set-password` });
  if (error) throw error;
  userId = data.user.id;
  console.log('Invitation e-mail sent.');
}
await db.from('profiles').upsert({ user_id: userId, display_name: name, email, timezone: tz, active: true, lifecycle_state: pwFile ? 'activated' : 'invited', invited_at: new Date().toISOString() });
await db.from('role_assignments').upsert({ user_id: userId, role: 'owner_admin' });
await db.from('preferences').upsert({ user_id: userId });
await db.from('admin_audit_log').insert({ actor_id: null, action: 'owner.bootstrap', target_user_id: userId, meta: { via: 'scripts/create-owner.ts' } });
console.log('owner_admin ready:', userId);
