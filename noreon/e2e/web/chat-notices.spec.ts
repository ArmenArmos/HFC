import { test, expect, type Page } from '@playwright/test';
import { noticeHistory, startChatFixture } from '../chat-v2/server.mjs';

// Real member view, scroll and seen observer in WebKit, with synthetic stored notice text and IO.
// No Next server, database, credentials or external requests.
// Run: pnpm exec playwright test -c e2e/playwright.config.ts chat-notices --project=webkit
let fixture: Awaited<ReturnType<typeof startChatFixture>>;
const notices = noticeHistory();
const firstUnseen = notices[4];
test.use({ viewport: { width: 402, height: 714 }, isMobile: true, hasTouch: true });
test.beforeEach(async ({ page }) => {
  fixture = await startChatFixture({ notices: true, firstUnseenNotice: firstUnseen.id });
  await page.route('**/*', route => {
    if (new URL(route.request().url()).hostname !== '127.0.0.1') return route.abort();
    return route.fulfill(fixture.respond(route.request().url(), route.request().method(), route.request().postData() ?? ''));
  });
});
test.afterEach(async () => { await fixture?.close(); });
const bottom = (page: Page) => page.locator('.cv2-thread').evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop);
const savedState = () => JSON.parse(fixture.respond(fixture.url + '/fixture/seen').body) as {
  seenThrough: number; seenPosts: string[]; firstUnseenNotice: string | null;
};

test('a lost seen receipt goes again on return, so reopening does not land on read notices', async ({ page }) => {
  let failures = 2;
  await page.route('**/api/patient/zoe/notices/seen', route => failures-- > 0 ? (failures ? route.abort() : route.fulfill({ status: 503, body: '{}' })) : route.fallback());
  await page.goto(fixture.url + '/patient/chat');
  await expect(page.locator(`[data-notice="${firstUnseen.id}"]`)).toBeVisible();
  await expect.poll(() => failures).toBe(1);
  expect(savedState().seenPosts).toEqual([]);
  await page.waitForTimeout(100);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect.poll(() => failures).toBe(0);
  await page.waitForTimeout(100);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect.poll(() => savedState().seenThrough).toBeGreaterThanOrEqual(4);
});

// One fixture intentionally has many items after the first unseen notice: an initial bottom jump
// would pass a short-history test while skipping the notice the member came here to read.
test('first open starts at the first unseen notice; reading through persists seen and reopening starts newest', async ({ page }) => {
  await page.goto(fixture.url + '/patient/chat');
  const target = page.locator(`[data-notice="${firstUnseen.id}"]`);
  await expect(target).toBeVisible();
  await expect.poll(async () => target.evaluate(el => {
    const scroller = document.querySelector('.cv2-thread')!;
    return el.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  })).toBeGreaterThanOrEqual(0);
  expect(await target.evaluate(el => el.getBoundingClientRect().top - document.querySelector('.cv2-thread')!.getBoundingClientRect().top)).toBeLessThan(100);
  expect(await bottom(page)).toBeGreaterThan(500);
  await expect(page.getByRole('button', { name: 'New message', exact: true })).toBeVisible();
  await expect.poll(() => savedState().seenThrough).toBeGreaterThanOrEqual(4);
  // Only observed notices may move the watermark; the unseen tail has not been acknowledged.
  expect(savedState().firstUnseenNotice).not.toBeNull();
  expect(savedState().seenPosts).not.toContain(notices.at(-1)!.id);
  await page.getByRole('button', { name: 'New message', exact: true }).click();
  await expect.poll(() => bottom(page)).toBeLessThan(2);
  await expect.poll(() => savedState().firstUnseenNotice).toBeNull();
  await expect.poll(() => savedState().seenPosts.includes(notices.at(-1)!.id)).toBe(true);
  // Page navigation retains the fixture's server-side watermark; no test-side "mark all seen".
  await page.reload();
  await expect(page.getByText(/Recorded doctor reply 99/)).toBeVisible();
  await expect.poll(() => bottom(page)).toBeLessThan(2);
});

test('saved Telegram notices appear once among replies in chronological order with no leaving links', async ({ page }) => {
  await page.goto(fixture.url + '/patient/chat');
  await expect(page.locator('[data-notice]')).toHaveCount(notices.length);
  for (const notice of notices) {
    const item = page.locator(`[data-notice="${notice.id}"]`);
    await expect(item).toHaveCount(1);
    await expect(item.locator('.cv2-say')).toHaveText(notice.text);
    await expect(page.locator(`[data-message-key="N${notice.id}"]`)).toHaveCount(1);
  }
  const actualOrder = await page.locator('[data-message-key]').evaluateAll(elements => elements.map(el => el.getAttribute('data-message-key')));
  const expectedOrder = [
    ...notices.map(n => ({ key: `N${n.id}`, at: n.at })),
    ...Array.from({ length: 100 }, (_, i) => ({ key: `r00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, at: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString() })),
  ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).map(item => item.key);
  expect(actualOrder.filter(key => key?.startsWith('N') || key?.startsWith('r'))).toEqual(expectedOrder);
  expect(await page.locator('a[href]').evaluateAll(links => links.map(link => link.getAttribute('href')).filter(href => href !== '/patient/chat'))).toEqual([]);
  await expect(page).toHaveURL(fixture.url + '/patient/chat');
});

test('a new notice leaves a scrolled reader in place until New message is pressed', async ({ page }) => {
  await page.goto(fixture.url + '/patient/chat');
  await expect(page.locator(`[data-notice="${firstUnseen.id}"]`)).toBeVisible();
  await page.locator('.cv2-thread').evaluate(el => {
    el.dispatchEvent(new Event('touchstart'));
    el.scrollTop = 700;
  });
  const top = await page.locator('.cv2-thread').evaluate(el => el.scrollTop);
  const notice = JSON.parse(fixture.respond(fixture.url + '/fixture/notice', 'POST').body) as { id: string; text: string };
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator(`[data-notice="${notice.id}"]`)).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'New message', exact: true })).toBeVisible();
  expect(await page.locator('.cv2-thread').evaluate(el => el.scrollTop)).toBe(top);
  expect(savedState().seenPosts).not.toContain(notice.id);
  await page.getByRole('button', { name: 'New message', exact: true }).click();
  await expect.poll(() => bottom(page)).toBeLessThan(2);
  await expect(page.locator(`[data-notice="${notice.id}"]`)).toContainText(notice.text);
  await expect.poll(() => savedState().seenPosts.includes(notice.id)).toBe(true);
});

for (const v3 of [false, true]) test(`V3 ${v3 ? 'on' : 'off'}: notices render in time order and stay seen-tracked`, async ({ page }) => {
  await page.goto(fixture.url + `/patient/chat${v3 ? '?v3' : ''}`);
  await expect(page.locator(`[data-notice="${firstUnseen.id}"]`)).toBeVisible();
  await expect(page.locator('[data-notice]')).toHaveCount(notices.length);
  await expect(page.locator('[data-zoe-card]')).toHaveCount(0);
  if (!v3) return;
  await page.locator('.cv2-composer textarea').fill('148/93');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.locator('[data-zoe-card="bp"]').getByRole('button', { name: 'Save reading', exact: true }).click();
  await expect(page.locator('[data-turn-reply]')).toBeVisible();
  await expect(page.locator('[data-notice]')).toHaveCount(notices.length);
});
