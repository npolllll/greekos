import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { admin, readState } from './fixtures';
import { login } from './helpers';
import { VOICE_CLIP } from '../../playwright.config';

/**
 * Full browser path of the live conversation: fake microphone (synthetic Melina clip) →
 * AudioWorklet 16 kHz → WebSocket gateway → local Whisper → dialogue → streamed persona voice →
 * scheduled playback with "started"/"ended" reports. Requires `npm run voice:gateway` and the
 * local ASR service. Labelled synthetic_test_clip; not evidence of live learner recognition.
 */
async function gatewayUp() {
  try { return (await fetch('http://127.0.0.1:3311/health')).ok; } catch { return false; }
}

test('live streaming conversation in the browser', async ({ page }) => {
  test.skip(!existsSync(VOICE_CLIP), 'нет синтетического клипа (нужен macOS say)');
  test.skip(!(await gatewayUp()), 'голосовой шлюз не запущен');
  const { owner } = readState();
  await page.addInitScript(() => localStorage.setItem('greekos.inputSource', 'synthetic_test_clip'));
  await login(page, owner);
  await page.goto('/speaking');
  await expect(page.getByRole('radio', { name: 'Живой разговор (потоковый)' })).toHaveAttribute('aria-checked', 'true');
  const row = page.locator('.scenario', { hasText: 'SC01' });
  await row.getByRole('button', { name: 'Голосом' }).click();
  await page.waitForURL(/\/speaking\/[0-9a-f-]{36}$/);
  const sessionId = page.url().split('/').pop()!;
  await expect(page.getByText('Живой разговор (потоковый)')).toBeVisible();
  await page.getByRole('button', { name: 'Начать разговор' }).click();
  const status = page.locator('.voice-stage .status-live');
  await expect(status).toHaveText(/Слушаю|Говорю|Распознаю|Думаю/, { timeout: 15_000 });

  // The looping clip answers the opening line; a recognised learner turn and a new reply appear.
  const learnerBubble = page.locator('.bubble.my:not(.draft)').first();
  const confirm = page.getByRole('button', { name: 'Да, отправить' });
  await expect(learnerBubble.or(confirm)).toBeVisible({ timeout: 45_000 });
  if (await confirm.isVisible()) await confirm.click();
  await expect(learnerBubble).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => page.locator('.bubble.greek').count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(2);

  // Indicator follows the measured level (style variable set from real audio, not a CSS loop).
  await expect.poll(async () => Number(await page.locator('.voice-orb.live').evaluate((e) => getComputedStyle(e).getPropertyValue('--lvl') || '0')), { timeout: 20_000 }).toBeGreaterThan(0);

  // Browser reported actual playback; the gateway stored a latency row for the learner turn.
  await expect.poll(async () => {
    const { data } = await admin().from('speaking_turn_metrics').select('turn_seq, playback_start_ms, input_source, asr_final_ms').eq('session_id', sessionId).gt('turn_seq', 0);
    return (data ?? []).filter((r) => r.playback_start_ms != null && r.input_source === 'synthetic_test_clip').length;
  }, { timeout: 30_000 }).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Остановить' }).click();
  await expect(status).toHaveText('Готово к началу');
});
