import { expect, type Page } from '@playwright/test';
import type { E2EUser } from './fixtures';

export async function login(page: Page, u: E2EUser) {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(u.email);
  await page.getByLabel('Пароль', { exact: true }).fill(u.password);
  await page.getByRole('button', { name: 'Войти' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });
}

export async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `horizontal overflow ${overflow}px on ${page.url()}`).toBeLessThanOrEqual(1);
  // Also catch content that is clipped (not scrollable) beyond the right edge.
  const clipped = await page.evaluate(() => {
    const vw = window.innerWidth;
    const scrollable = (el: Element | null): boolean => {
      for (let e = el?.parentElement ?? null; e && e !== document.body; e = e.parentElement) {
        const ox = getComputedStyle(e).overflowX;
        if (ox === 'auto' || ox === 'scroll') return true;
      }
      return false;
    };
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll('#main *'))) {
      const r = el.getBoundingClientRect();
      if (el.closest('[aria-hidden="true"]')) continue; // decorative art is intentionally cropped
      if (r.width && r.right > vw + 1 && !scrollable(el) && getComputedStyle(el).position !== 'fixed') out.push(`${el.tagName.toLowerCase()}.${(el as HTMLElement).className}`.slice(0, 80));
    }
    return out.slice(0, 5);
  });
  expect(clipped, `content beyond the right edge on ${page.url()}`).toEqual([]);
}
