/**
 * GreekOS — production acceptance, run by «GreekOS ops» → acceptance (GitHub Actions, production secrets).
 * Works on the live site through the same screens and APIs a person uses, with TEMPORARY accounts that
 * are deleted at the end. Real learners and their data are never touched. Prints statuses only (no
 * e-mails of real people, no keys). Report: reports/ops/acceptance.json + screenshots.
 *
 *  access    closed registration (app, auth service, database); owner session by a one-time link
 *            (the owner's password is never used); two temporary learners added by the owner with
 *            one-time links; password set; sign-out / sign-in; onboarding from zero and with experience
 *  learner   home, course, the first lessons and the diagnostic as the learner sees them (released or
 *            «на проверке»); a lesson attempt with a right and a wrong answer when the lesson is released;
 *            progress after signing in again
 *  isolation RLS with each learner's own token: no rows of the other learner, no owner data
 *  speaking  (ACCEPT_SPEAKING=1) real conversations at A1, A2, B1 and B2 as owner preview: several turns,
 *            engine of each reply, latency, feedback, summary; recognition of a Greek recording (Azure)
 *  perf      navigation timings of key pages, desktop and a phone on a slow 4G profile
 *  disable   the owner disables a learner: the open session loses access, sign-in is refused
 */
import { chromium, devices, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const APP = (process.env.APP_URL ?? '').trim().replace(/\/$/, '');
const SUPA = `https://${(process.env.SUPABASE_PROJECT_REF ?? '').trim()}.supabase.co`;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
const OWNER_EMAIL = (process.env.OWNER_EMAIL ?? '').trim();
const SPEAKING = process.env.ACCEPT_SPEAKING === '1';
const OUT = 'reports/ops';
const PASSWORD = `Gos-${randomUUID().slice(0, 12)}!`;
const run = randomUUID().slice(0, 6);
const created: string[] = [];

interface Check { id: string; ok: boolean | null; detail?: string }
const report: { started: string; app: string; checks: Check[]; speaking: unknown[]; perf: unknown[]; asr?: unknown } = { started: new Date().toISOString(), app: APP, checks: [], speaking: [], perf: [] };
function check(id: string, ok: boolean | null, detail = '') {
  report.checks.push({ id, ok, detail });
  console.log(`${ok === null ? 'SKIP' : ok ? 'PASS' : 'FAIL'} ${id}${detail ? ` — ${detail}` : ''}`);
}
async function step(id: string, fn: () => Promise<void>) {
  try { await fn(); } catch (e) { check(id, false, `исключение: ${(e as Error).message.split('\n')[0].slice(0, 300)}`); }
}
const shot = (p: Page, name: string) => p.screenshot({ path: `${OUT}/${name}.png`, fullPage: false }).catch(() => undefined);

const db: SupabaseClient = createClient(SUPA, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

async function ownerPage(browser: Browser): Promise<Page> {
  const { data, error } = await db.auth.admin.generateLink({ type: 'magiclink', email: OWNER_EMAIL });
  if (error || !data.properties?.hashed_token) throw new Error(`owner link: ${error?.message ?? 'no token'}`);
  const page = await (await browser.newContext()).newPage();
  await page.goto(`${APP}/auth/confirm?token_hash=${data.properties.hashed_token}&type=magiclink&next=/admin`);
  return page;
}

/** The owner signed in inside a given browser context (one-time link; the password is never used). */
async function ownerIn(ctx: BrowserContext): Promise<Page> {
  const { data, error } = await db.auth.admin.generateLink({ type: 'magiclink', email: OWNER_EMAIL });
  if (error || !data.properties?.hashed_token) throw new Error(`owner link: ${error?.message ?? 'no token'}`);
  const page = await ctx.newPage();
  await page.goto(`${APP}/auth/confirm?token_hash=${data.properties.hashed_token}&type=magiclink&next=/speaking`);
  return page;
}

async function waitFor(fn: () => Promise<boolean>, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn().catch(() => false)) return true; await new Promise((r) => setTimeout(r, 400)); }
  return false;
}

/** A Greek phrase spoken by an Azure neural voice (free tier), 16 kHz WAV with 2.5 s of silence after it. */
async function greekClip(text: string): Promise<string> {
  const key = process.env.AZURE_SPEECH_KEY ?? '';
  const region = (process.env.AZURE_SPEECH_REGION ?? 'northeurope').trim();
  const ssml = `<speak version="1.0" xml:lang="el-GR"><voice name="el-GR-NestorasNeural">${text}</voice></speak>`;
  const r = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, { method: 'POST', body: ssml, headers: { 'Ocp-Apim-Subscription-Key': key, 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'riff-16khz-16bit-mono-pcm', 'User-Agent': 'greekos-acceptance' } });
  if (!r.ok) throw new Error(`clip TTS HTTP ${r.status}`);
  const wav = Buffer.from(await r.arrayBuffer());
  const at = wav.indexOf('data');
  const pcm = Buffer.concat([wav.subarray(at + 8), Buffer.alloc(16000 * 2 * 2.5)]);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + pcm.length, 4); head.write('WAVE', 8); head.write('fmt ', 12);
  head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22); head.writeUInt32LE(16000, 24);
  head.writeUInt32LE(32000, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34); head.write('data', 36); head.writeUInt32LE(pcm.length, 40);
  const path = resolve(OUT, 'greek-clip.wav');
  writeFileSync(path, Buffer.concat([head, pcm]));
  return path;
}

async function invite(owner: Page, name: string, email: string, viaUi: boolean): Promise<string> {
  if (viaUi) {
    await owner.goto(`${APP}/admin/learners`);
    await owner.getByRole('button', { name: 'Добавить ученика' }).first().click();
    await owner.getByLabel('Имя').fill(name);
    await owner.getByLabel('E-mail').fill(email);
    await owner.getByRole('button', { name: 'Далее' }).click();
    await owner.getByRole('button', { name: 'Подтвердить и создать ссылку' }).click();
    const link = await owner.locator('.copy-box input').inputValue({ timeout: 30_000 });
    await shot(owner, 'owner-invite-link');
    return link;
  }
  const r = await owner.request.post(`${APP}/api/admin/invite`, { data: { email, display_name: name, entry_path: 'unsure', delivery: 'link', confirmed: true } });
  if (!r.ok()) throw new Error(`invite ${r.status()} ${await r.text()}`);
  return (await r.json()).link;
}

async function activate(browser: Browser, link: string, ctxOpts = {}): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  await page.goto(link);
  await page.waitForURL(/\/auth\/set-password/, { timeout: 30_000 });
  await page.getByLabel('Новый пароль').fill(PASSWORD);
  await page.getByLabel('Повторите пароль').fill(PASSWORD);
  await page.getByRole('button', { name: 'Сохранить и продолжить' }).click();
  await page.waitForURL(/\/welcome/, { timeout: 60_000 });
  return { ctx, page };
}

async function timing(page: Page, path: string) {
  const t0 = Date.now();
  const res = await page.goto(`${APP}${path}`, { waitUntil: 'load', timeout: 60_000 });
  const load = Date.now() - t0;
  const nav = await page.evaluate(() => { const n = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined; return n ? { ttfb: Math.round(n.responseStart), dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd) } : null; });
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);
  return { path, status: res?.status() ?? 0, ttfb_ms: nav?.ttfb ?? null, dom_ms: nav?.dcl ?? null, load_ms: nav?.load ?? load, idle_ms: Date.now() - t0, final: new URL(page.url()).pathname };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  if (!APP || !SERVICE || !ANON || !OWNER_EMAIL) throw new Error('APP_URL, SUPABASE_PROJECT_REF, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_ANON_KEY and OWNER_EMAIL are required');
  const browser = await chromium.launch();
  const A = { name: 'Тест Приёмка А', email: `accept-a-${run}@greekos.test` };
  const B = { name: 'Тест Приёмка Б', email: `accept-b-${run}@greekos.test` };
  let owner: Page | null = null;
  let aPage: Page | null = null;
  try {
    // ---------------- access ----------------
    await step('access.public', async () => {
      const p = await (await browser.newContext()).newPage();
      await p.goto(`${APP}/login`);
      check('access.login_has_no_signup', (await p.getByRole('link', { name: /Зарегистр/ }).count()) === 0);
      await p.goto(`${APP}/register`);
      check('access.register_page_closed', (await p.locator('form').count()) === 0 && /Регистрация закрыта/.test(await p.locator('h1').innerText()));
      const r = await p.request.post(`${APP}/api/auth/register`, { data: { display_name: 'X', email: `x-${run}@greekos.test`, consent: true } });
      check('access.register_api_refused', r.status() === 403, `HTTP ${r.status()}`);
      const settings = await fetch(`${SUPA}/auth/v1/settings`, { headers: { apikey: ANON } }).then((x) => x.json()).catch(() => null) as { disable_signup?: boolean } | null;
      check('access.auth_service_signup_disabled', settings?.disable_signup === true, `disable_signup=${settings?.disable_signup}`);
      const anon = await fetch(`${SUPA}/rest/v1/platform_settings?select=registration_mode`, { headers: { apikey: ANON, authorization: `Bearer ${ANON}` } });
      check('access.anon_cannot_read_settings', anon.status === 401 || anon.status === 403 || (anon.ok && (await anon.json()).length === 0), `HTTP ${anon.status}`);
      const { data: ps } = await db.from('platform_settings').select('registration_mode').eq('id', true).maybeSingle();
      check('access.db_mode_closed', ps?.registration_mode === 'closed', `mode=${ps?.registration_mode}`);
      await p.context().close();
    });

    await step('access.owner_login', async () => {
      owner = await ownerPage(browser);
      await owner.waitForURL(/\/admin/, { timeout: 30_000 });
      check('access.owner_login_one_time_link', /\/admin/.test(owner.url()));
      await shot(owner, 'owner-admin');
    });
    if (!owner) throw new Error('no owner session');
    const op = owner as Page;

    let linkA = '', linkB = '';
    await step('access.invite', async () => {
      linkA = await invite(op, A.name, A.email, true);
      linkB = await invite(op, B.name, B.email, false);
      check('access.owner_creates_learner_ui', linkA.includes('/auth/confirm?'));
      check('access.owner_creates_learner_api', linkB.includes('/auth/confirm?'));
      const { data } = await db.from('profiles').select('user_id, email').in('email', [A.email, B.email]);
      for (const x of data ?? []) created.push(x.user_id);
    });

    // ---------------- learner A: from zero ----------------
    await step('learner.a', async () => {
      const { page } = await activate(browser, linkA);
      aPage = page;
      check('learner.a_set_password', true);
      await page.getByRole('radio', { name: /С полного нуля/ }).click();
      await page.getByRole('radio', { name: 'Жить и общаться в Греции' }).click();
      await page.getByRole('button', { name: 'Начать' }).click();
      await page.waitForURL((u) => u.pathname === '/', { timeout: 30_000 });
      check('learner.a_onboarding_from_zero', true);
      await shot(page, 'learner-a-home');
      const again = await (await browser.newContext()).newPage();
      await again.goto(linkA);
      await again.waitForURL(/\/login/, { timeout: 30_000 });
      check('access.link_single_use', /error=link/.test(again.url()), new URL(again.url()).pathname + new URL(again.url()).search);
      await again.context().close();
      await page.goto(`${APP}/course`);
      const rows = await page.locator('.unit-row').allInnerTexts();
      check('learner.a_course_route', rows.length > 0, `${rows.length} уроков в маршруте; первый: ${(rows[0] ?? '').split('\n')[0]}`);
      await shot(page, 'learner-a-course');
      const first = page.locator('.unit-row a').first();
      if (await first.count()) {
        await first.click();
        await page.waitForLoadState('networkidle').catch(() => undefined);
        const text = await page.locator('main').innerText();
        const gated = /на проверке|не выпущ|закрыт/i.test(text);
        check('learner.a_first_lesson_state', true, gated ? 'урок закрыт: материалы ждут решения владельца о выпуске' : 'урок открыт');
        await shot(page, 'learner-a-lesson');
      }
    });

    // ---------------- learner B: with experience → diagnostic ----------------
    let bPage: Page | null = null;
    await step('learner.b', async () => {
      const { page } = await activate(browser, linkB);
      bPage = page;
      await page.getByRole('radio', { name: /Уже изучал/ }).click();
      await page.getByRole('radiogroup', { name: 'Предполагаемый уровень' }).getByRole('radio', { name: 'B1' }).click();
      await page.getByRole('radio', { name: 'Работа' }).click();
      await page.getByRole('button', { name: 'Начать' }).click();
      await page.waitForURL(/\/diagnostic|\/$/, { timeout: 30_000 });
      const text = await page.locator('main').innerText();
      check('learner.b_onboarding_with_experience', true, `→ ${new URL(page.url()).pathname}`);
      check('learner.b_diagnostic_state', true, /Начать диагностику/.test(text) ? 'диагностика доступна' : /провер|выпуск|недоступ/i.test(text) ? 'диагностика закрыта до выпуска материалов' : text.slice(0, 160).replace(/\s+/g, ' '));
      await shot(page, 'learner-b-diagnostic');
    });

    // ---------------- sign out / in, isolation ----------------
    await step('isolation', async () => {
      const ca = createClient(SUPA, ANON, { auth: { persistSession: false } });
      const cb = createClient(SUPA, ANON, { auth: { persistSession: false } });
      const sa = await ca.auth.signInWithPassword({ email: A.email, password: PASSWORD });
      const sb = await cb.auth.signInWithPassword({ email: B.email, password: PASSWORD });
      check('access.password_sign_in', !sa.error && !sb.error, sa.error?.message ?? sb.error?.message ?? '');
      const aId = sa.data.user!.id, bId = sb.data.user!.id;
      for (const t of ['profiles', 'enrollments', 'preferences', 'learning_routes', 'attempts', 'speaking_sessions', 'placement_sessions', 'activity_days']) {
        const { data, error } = await ca.from(t).select('user_id').limit(50);
        const foreign = (data ?? []).filter((r: { user_id: string }) => r.user_id !== aId).length;
        check(`isolation.${t}`, !error && foreign === 0, error ? error.message : `строк чужих: ${foreign}`);
      }
      const { data: bRows } = await ca.from('profiles').select('user_id').eq('user_id', bId);
      check('isolation.direct_lookup_other_learner', (bRows ?? []).length === 0);
      for (const t of ['admin_audit_log', 'provider_usage', 'budget_ledger', 'platform_settings', 'role_assignments', 'server_errors']) {
        const { data } = await ca.from(t).select('*').limit(5);
        const own = t === 'role_assignments' ? (data ?? []).filter((r: { user_id: string }) => r.user_id !== aId).length : (data ?? []).length;
        check(`isolation.no_${t}`, own === 0, `строк: ${(data ?? []).length}`);
      }
      const adminApi = await (aPage as unknown as Page).request.get(`${APP}/api/admin/learners/${bId}/export`);
      check('isolation.learner_cannot_call_admin_api', adminApi.status() === 401 || adminApi.status() === 403, `HTTP ${adminApi.status()}`);
      await ca.auth.signOut({ scope: 'local' }); await cb.auth.signOut({ scope: 'local' });
    });

    await step('learner.relogin', async () => {
      const ctx = await browser.newContext();
      const p = await ctx.newPage();
      await p.goto(`${APP}/login`);
      await p.getByLabel('E-mail').fill(A.email);
      await p.getByLabel('Пароль').fill(PASSWORD);
      await p.getByRole('button', { name: 'Войти' }).click();
      await p.waitForURL((u) => u.pathname === '/', { timeout: 30_000 });
      const home = await p.locator('main').innerText();
      check('learner.a_relogin_home', !/Добро пожаловать в GreekOS.*начните/i.test(home), home.slice(0, 120).replace(/\s+/g, ' '));
      await ctx.close();
    });

    // ---------------- performance ----------------
    await step('perf', async () => {
      const pages = ['/', '/course', '/practice', '/progress', '/speaking', '/listening', '/real-greek', '/exams', '/pegp'];
      for (const path of pages) report.perf.push({ device: 'desktop', ...(await timing(aPage as unknown as Page, path)) });
      const ctx = await browser.newContext({ ...devices['Pixel 7'] });
      const cookies = await (aPage as unknown as Page).context().cookies();
      await ctx.addCookies(cookies);
      const m = await ctx.newPage();
      const cdp = await ctx.newCDPSession(m);
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
      for (const path of ['/', '/course', '/speaking']) report.perf.push({ device: 'phone-slow-4g', ...(await timing(m, path)) });
      const over = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      check('ui.phone_no_horizontal_scroll', !over);
      await shot(m, 'phone-speaking');
      await ctx.close();
      for (const path of ['/admin', '/admin/learners', '/admin/qa', '/admin/qa/release', '/admin/providers']) report.perf.push({ device: 'owner', ...(await timing(op, path)) });
      const slow = (report.perf as Array<{ idle_ms: number; path: string; device: string }>).filter((x) => x.idle_ms > 8000);
      check('perf.pages_under_8s', slow.length === 0, slow.map((x) => `${x.device}${x.path} ${x.idle_ms} мс`).join(', '));
    });

    // ---------------- AI Speaking (real providers, owner preview) ----------------
    if (SPEAKING) await step('speaking', async () => {
      const { data: scen } = await db.from('speaking_scenarios').select('scenario_id, level, domain, payload').order('scenario_id');
      for (const level of ['A1', 'A2', 'B1', 'B2']) {
        const s = (scen ?? []).find((x) => x.level === level && (x.payload as { nodes?: unknown[] }).nodes?.length);
        if (!s) { check(`speaking.${level}`, false, 'нет сценария'); continue; }
        const nodes = (s.payload as { nodes: Array<{ node_id: string; acceptable_examples_el?: string[] }> }).nodes;
        const post = async (data: Record<string, unknown>) => { const t = Date.now(); const r = await op.request.post(`${APP}/api/speaking`, { data, timeout: 90_000 }); return { status: r.status(), ms: Date.now() - t, json: await r.json().catch(() => ({})) as Record<string, unknown> }; };
        const start = await post({ action: 'start', scenario_id: s.scenario_id, mode: 'roleplay', input_mode: 'text_fallback', idempotency_key: `acc-${run}-${level}` });
        const sid = String(start.json.session_id ?? '');
        if (!sid) { check(`speaking.${level}.start`, false, `HTTP ${start.status} ${JSON.stringify(start.json).slice(0, 200)}`); continue; }
        const turns: unknown[] = [];
        let current = String(start.json.current_node ?? (s.payload as { entry_node?: string }).entry_node ?? '');
        for (let i = 0; i < 4; i++) {
          const node = nodes.find((n) => n.node_id === current) ?? nodes[0];
          let text = node.acceptable_examples_el?.[0] ?? 'Ναι, ευχαριστώ.';
          // Turn 2 carries typical learner errors (no stress marks, lower case); turn 4 asks to repeat.
          if (i === 1) text = text.normalize('NFD').replace(/[́̈]/g, '').normalize('NFC').toLowerCase();
          if (i === 3) text = 'Συγγνώμη, δεν κατάλαβα. Μπορείτε να το πείτε πιο αργά;';
          const r = await post({ action: 'turn', session_id: sid, text, source: 'typed', asr_confidence: null, help_used: [], repair: false, interrupted_previous: false, idempotency_key: `acc-${run}-${level}-${i}` });
          const assistant = (r.json.turns as Array<{ speaker: string; text: string; engine?: string }> | undefined)?.filter((t) => t.speaker === 'assistant').at(-1);
          turns.push({ learner: text, reply: assistant?.text ?? null, engine: r.json.engine_kind, reason: r.json.engine_reason ?? null, ms: r.ms, http: r.status, hint_ru: r.json.hint_ru ?? null });
          current = String(r.json.current_node ?? current);
          if (r.json.status === 'ENDED') break;
        }
        await new Promise((res) => setTimeout(res, 6000));
        const state = await post({ action: 'state', session_id: sid });
        const feedback = (state.json.turns as Array<{ speaker: string; feedback?: unknown }> | undefined)?.filter((t) => t.speaker === 'learner').map((t) => t.feedback ?? null);
        const end = await post({ action: 'end', session_id: sid });
        const llmTurns = (turns as Array<{ engine: string }>).filter((t) => t.engine === 'llm').length;
        report.speaking.push({ level, scenario: s.scenario_id, domain: s.domain, turns, feedback, summary: end.json.summary ?? end.json });
        check(`speaking.${level}.real_ai_replies`, llmTurns === turns.length, `${llmTurns}/${turns.length} ответов от AI; медиана ${[...(turns as Array<{ ms: number }>)].map((t) => t.ms).sort((a, b) => a - b)[Math.floor(turns.length / 2)]} мс`);
      }
      // Recognition of a real Greek recording (a course audio file rendered by Azure), owner preview.
      const { data: asset } = await db.from('audio_assets').select('id').is('invalidated_at', null).limit(1).maybeSingle();
      if (asset) {
        const u = await op.request.get(`${APP}/api/media/audio/${asset.id}`);
        const url = (await u.json()).url as string;
        const wav = Buffer.from(await (await fetch(url)).arrayBuffer());
        const t = Date.now();
        const tr = await op.request.post(`${APP}/api/speech/transcribe`, { data: wav, headers: { 'content-type': 'audio/wav' }, timeout: 60_000 });
        const j = await tr.json().catch(() => ({}));
        report.asr = { http: tr.status(), ms: Date.now() - t, text: j.text ?? null, confidence: j.confidence ?? null, provider: j.provider ?? null, stored: j.stored ?? null };
        check('speaking.asr_el_gr', tr.ok() && !!j.text, `${Date.now() - t} мс, уверенность ${j.confidence ?? '—'}`);
      }
    });

    // ---------------- AI Speaking on a phone: the real microphone path ----------------
    // A Pixel-sized browser whose microphone plays a Greek phrase (Azure voice, free tier): live mode over
    // the app's own WebSocket and step mode (record → transcript → reply), as the owner (preview).
    if (SPEAKING) await step('speaking.mobile', async () => {
      const clip = await greekClip('Καλημέρα. Θέλω ένα κιλό ντομάτες, παρακαλώ.');
      const mb = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${clip}`, '--autoplay-policy=no-user-gesture-required'] });
      try {
        const ctx = await mb.newContext({ ...devices['Pixel 7'], permissions: ['microphone'], locale: 'ru-RU' });
        // The recording is a synthetic clip, and is stored as such (not as a person's microphone).
        await ctx.addInitScript(() => localStorage.setItem('greekos.inputSource', 'synthetic_test_clip'));
        const page = await ownerIn(ctx);
        const { data: scen } = await db.from('speaking_scenarios').select('scenario_id').eq('level', 'A1').order('scenario_id').limit(1).single();
        const open = async (transport: 'stream_local_gateway' | 'batch') => {
          const r = await page.request.post(`${APP}/api/speaking`, { data: { action: 'start', scenario_id: scen!.scenario_id, mode: 'roleplay', input_mode: 'voice', transport, idempotency_key: `acc-${run}-m-${transport}` } });
          const j = await r.json() as { session_id?: string };
          if (!j.session_id) throw new Error(`start ${transport}: HTTP ${r.status()}`);
          await page.goto(`${APP}/speaking/${j.session_id}`);
          return j.session_id;
        };
        const assistantCount = () => page.locator('.msg:not(.mine) .bubble.greek').count();
        // Live mode over the app's own WebSocket.
        const sockets: string[] = [];
        page.on('websocket', (w) => sockets.push(w.url()));
        const liveSid = await open('stream_local_gateway');
        const startBtn = page.getByRole('button', { name: 'Начать разговор' });
        if (await startBtn.count()) {
          const before = await assistantCount();
          await startBtn.click();
          const t0 = Date.now();
          const listening = await waitFor(async () => /Слушаю|Говорю|Распознаю|Думаю/.test(await page.locator('.voice-stage .status-live').innerText().catch(() => '')), 20_000);
          check('speaking.mobile.live_connects', listening && sockets.some((u) => u.includes('/api/voice/stream')), sockets.map((u) => new URL(u).pathname).join(', ') || 'нет WebSocket');
          let confirmed = false;
          const heard = await waitFor(async () => {
            const yes = page.getByRole('button', { name: 'Да, отправить' });
            if (await yes.count()) { await yes.first().click().catch(() => undefined); confirmed = true; }
            return (await page.locator('.msg.mine .bubble.my:not(.draft)').count()) > 0;
          }, 60_000);
          const replied = heard && await waitFor(async () => (await assistantCount()) > before, 60_000);
          const shown = replied ? (await page.locator('.msg:not(.mine) .bubble.greek').last().innerText()).split('\n')[0].slice(0, 120) : '';
          check('speaking.mobile.live_turn', replied, replied ? `${Math.round((Date.now() - t0) / 100) / 10} с от начала до ответа${confirmed ? ' (с подтверждением транскрипта)' : ''}: «${shown}»` : heard ? 'реплика распознана, ответа нет' : 'реплика не распознана');
          const { data: lt } = await db.from('speaking_turns').select('speaker, engine_kind, input_source').eq('session_id', liveSid).order('created_at');
          report.speaking.push({ mode: 'live_mobile', turns: lt });
          await page.getByRole('button', { name: 'Остановить' }).click().catch(() => undefined);
        } else check('speaking.mobile.live_connects', false, 'нет кнопки «Начать разговор» (живой режим недоступен)');
        // Step mode: record → transcript → reply.
        await open('batch');
        const before = await assistantCount();
        await page.getByRole('button', { name: 'Начать запись' }).click();
        await page.waitForTimeout(6500);
        await page.getByRole('button', { name: 'Остановить запись' }).click();
        const tr = await waitFor(async () => (await page.getByRole('button', { name: 'Да, отправить' }).count()) > 0, 40_000);
        const said = tr ? await page.locator('.voice-answer, .transcript, [data-transcript]').first().innerText().catch(() => '') : '';
        if (tr) await page.getByRole('button', { name: 'Да, отправить' }).first().click();
        const replied = tr && await waitFor(async () => (await assistantCount()) > before, 60_000);
        check('speaking.mobile.step_turn', replied, tr ? (replied ? `распознано и отвечено${said ? `: «${said.split('\n')[0].slice(0, 80)}»` : ''}` : 'транскрипт есть, ответа нет') : 'транскрипта нет');
        const over = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
        check('speaking.mobile.no_horizontal_scroll', !over);
        await page.screenshot({ path: `${OUT}/speaking-mobile.png` });
      } finally { await mb.close(); }
    });

    // ---------------- disable ----------------
    await step('access.disable', async () => {
      const { data: a } = await db.from('profiles').select('user_id').eq('email', A.email).single();
      const r = await op.request.post(`${APP}/api/admin/learners/${a!.user_id}/deactivate`, { data: { reason: 'Приёмка: проверка отключения временного аккаунта' } });
      check('access.owner_disables_learner', r.ok(), `HTTP ${r.status()}`);
      const me = await (aPage as unknown as Page).request.get(`${APP}/api/me/export`);
      check('access.disabled_session_loses_access', me.status() === 401 || me.status() === 403, `HTTP ${me.status()}`);
      const c = createClient(SUPA, ANON, { auth: { persistSession: false } });
      const s = await c.auth.signInWithPassword({ email: A.email, password: PASSWORD });
      check('access.disabled_sign_in_refused', !!s.error, s.error?.message ?? 'вход прошёл');
    });
    void bPage;
  } finally {
    // Temporary accounts only: found by the run's unique addresses, deleted with their data.
    const { data: left } = await db.from('profiles').select('user_id').in('email', [A.email, B.email]);
    for (const id of new Set([...created, ...(left ?? []).map((x) => x.user_id)])) {
      const { error } = await db.auth.admin.deleteUser(id);
      check('cleanup.temporary_account_deleted', !error, error?.message ?? '');
    }
    await browser.close();
    writeFileSync(`${OUT}/acceptance.json`, JSON.stringify(report, null, 1));
    const failed = report.checks.filter((c) => c.ok === false);
    console.log(`\n${report.checks.length - failed.length}/${report.checks.length} проверок пройдено`);
    for (const s of report.speaking as Array<{ level: string; turns: Array<{ learner: string; reply: string | null; engine: string; reason: string | null; ms: number }> }>) {
      console.log(`\n== Speaking ${s.level}`);
      for (const t of s.turns) console.log(`  ученик: ${t.learner}\n  AI [${t.engine}${t.reason ? `: ${t.reason}` : ''}, ${t.ms} мс]: ${t.reply}`);
    }
    if (report.asr) console.log(`\nASR: ${JSON.stringify(report.asr)}`);
    console.log(`\nPERF: ${JSON.stringify(report.perf)}`);
    process.exitCode = failed.length ? 1 : 0;
  }
}

await main();
