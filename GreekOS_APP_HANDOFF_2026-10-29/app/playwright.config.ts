import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

// Live voice E2E: Chromium's fake capture device plays a synthetic Greek clip (made by the local
// macOS voice in global setup) as the microphone. It is labelled synthetic_test_clip in metrics.
export const VOICE_CLIP = fileURLToPath(new URL('./test-results/voice-e2e-clip.wav', import.meta.url));

export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: { baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3210', trace: 'retain-on-failure', screenshot: 'only-on-failure', locale: 'ru-RU', timezoneId: 'Europe/Athens' },
  projects: [
    { name: 'desktop-1440', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } }, testIgnore: /voice-stream/ },
    { name: 'tablet-768', use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 } }, testMatch: /responsive/ },
    {
      name: 'voice-stream', testMatch: /voice-stream/,
      use: {
        ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, permissions: ['microphone'],
        launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${VOICE_CLIP}`, '--autoplay-policy=no-user-gesture-required'] },
      },
    },
    { name: 'mobile-390', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } }, testMatch: /responsive|journey/ },
    { name: 'mobile-320', use: { ...devices['Pixel 7'], viewport: { width: 320, height: 640 } }, testMatch: /responsive/ },
  ],
});
