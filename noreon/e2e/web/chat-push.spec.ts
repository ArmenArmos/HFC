import { test, expect } from '@playwright/test';
import { noticeHistory, startChatFixture } from '../chat-v2/server.mjs';

// Production view in WebKit; browser permission and push service are mocked.
let fixture: Awaited<ReturnType<typeof startChatFixture>>;
test.use({ viewport: { width: 402, height: 714 }, isMobile: true, hasTouch: true });
test.beforeAll(async () => { fixture = await startChatFixture({notices:true,firstUnseenNotice:null}); });
test.afterAll(async () => { await fixture?.close(); });
test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1'
    ? route.fulfill(fixture.respond(route.request().url(), route.request().method(), route.request().postData() ?? '')) : route.abort());
  await page.addInitScript(() => {
    const state = { permissions: 0, subscriptions: 0, unsubscribes: 0, registrations: [] as string[] };
    Object.assign(window, { pushTest: state, PushManager: class {} });
    Object.defineProperty(window, 'Notification', { configurable: true, value: {
      permission: 'default', requestPermission() { state.permissions++; return Promise.resolve('granted'); },
    } });
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: {
      async register(url: string, options: { scope: string }) {
        state.registrations.push(`${url}:${options.scope}`);
        if (new URLSearchParams(location.search).has('push-delay')) {
          await new Promise<void>(resolve => Object.assign(state, { finishRegistration: resolve }));
        }
        const device = { endpoint: 'https://web.push.apple.com/device', toJSON() { return {endpoint:this.endpoint,keys:{p256dh:'test',auth:'test'}}; }, async unsubscribe() { state.unsubscribes++; return true; } };
        return { active: {}, pushManager: { async getSubscription() { return new URLSearchParams(location.search).has('push-existing') ? device : null; }, async subscribe() {
          state.subscriptions++; return { toJSON() { return {endpoint:'https://push.invalid/device',keys:{p256dh:'test',auth:'test'}}; }, async unsubscribe() { return true; } };
        } } };
      },
    } });
  });
});

test('permission is requested only on tap; dismissal persists without navigation or moving a reader', async ({ page }) => {
  await page.goto(fixture.url + '/patient/chat?push');
  const prompt = page.locator('[data-member-push]');
  await expect(prompt).toHaveCount(1);
  expect(await page.evaluate(() => (window as unknown as {pushTest:{permissions:number}}).pushTest.permissions)).toBe(0);
  await page.locator('.cv2-thread').evaluate(el => { el.dispatchEvent(new Event('touchstart')); el.scrollTop = 600; });
  // Let late content growth settle while reading older replies.
  const before = await page.locator('.cv2-thread').evaluate(el => el.scrollTop);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  expect(await page.locator('.cv2-thread').evaluate(el => el.scrollTop)).toBe(before);
  await page.locator('.cv2-thread').evaluate(el => { el.scrollTop = el.scrollHeight; });
  await page.getByRole('button', { name: 'Not now', exact: true }).click();
  await expect(prompt).toHaveCount(0);
  expect(page.url()).toBe(fixture.url + '/patient/chat?push');
  await page.reload();
  await expect(prompt).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as {pushTest:{permissions:number}}).pushTest.permissions)).toBe(0);
});

test('explicit tap grants permission and saves one subscription', async ({ page }) => {
  await page.goto(fixture.url + '/patient/chat?push');
  await page.getByRole('button', { name: 'Turn on notifications', exact: true }).click();
  await expect(page.locator('[data-member-push]')).toHaveCount(0);
  const state = await page.evaluate(() => (window as unknown as {pushTest:{permissions:number;subscriptions:number;registrations:string[]}}).pushTest);
  expect(state).toEqual({permissions:1,subscriptions:1,unsubscribes:0,registrations:['/patient/sw.js:/patient/']});
});

test('closing the browser permission sheet does not repeat the chat prompt after reload', async ({ page }) => {
  await page.goto(fixture.url + '/patient/chat?push');
  await expect(page.locator('[data-member-push]')).toHaveCount(1);
  await page.evaluate(() => { Notification.requestPermission = async () => 'default'; });
  await page.getByRole('button', { name: 'Turn on notifications', exact: true }).click();
  await expect(page.locator('[data-member-push]')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('[data-member-push]')).toHaveCount(0);
});

test('a late prompt does not move a member reading older replies', async ({ page }) => {
  await page.goto(fixture.url + '/patient/chat?push&push-delay');
  await expect(page.locator('.cv2-msg')).not.toHaveCount(0);
  await page.locator('.cv2-thread').evaluate(el => {
    el.dispatchEvent(new Event('touchstart')); el.scrollTop = 600; el.dispatchEvent(new Event('scroll'));
  });
  const before = await page.locator('.cv2-thread').evaluate(el => el.scrollTop);
  await page.evaluate(() => (window as unknown as { pushTest: { finishRegistration: () => void } }).pushTest.finishRegistration());
  await expect(page.locator('[data-member-push]')).toHaveCount(1);
  expect(await page.locator('.cv2-thread').evaluate(el => el.scrollTop)).toBe(before);
});

test('Safari outside Home Screen explains installation without asking permission', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'userAgent', { value: 'iPhone Safari', configurable: true }));
  await page.goto(fixture.url + '/patient/chat?push');
  await expect(page.getByText(/open Safari’s Share menu/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Turn on notifications', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as {pushTest:{permissions:number}}).pushTest.permissions)).toBe(0);
});


const seedAssessment = (completedAt: string | null) => fixture.respond(fixture.url + '/fixture/assessment', 'POST', JSON.stringify({
  id: '00000000-0000-4000-8000-000000001001', revision: 0, assessmentDate: '2026-11-01', completedAt, urgentRule: null, answers: {}, updatedAt: '2026-11-01T00:00:00.000Z',
}));
test('the prompt shows once the health questions are finished', async ({ page }) => {
  seedAssessment('2026-11-01T00:00:00.000Z');
  await page.goto(fixture.url + '/patient/chat?push&anamnesis');
  await expect(page.locator('[data-member-push]')).toHaveCount(1);
});

test('no prompt under an unfinished health question, but a device that said yes is still saved', async ({ page }) => {
  seedAssessment(null);
  await page.goto(fixture.url + '/patient/chat?push&anamnesis');
  await expect(page.locator('[data-chat-v2]')).toBeVisible();
  await page.waitForTimeout(300);
  await expect(page.locator('[data-member-push]')).toHaveCount(0);
  await page.addInitScript(() => Object.defineProperty(Notification, 'permission', { value: 'granted', configurable: true }));
  await page.reload();
  await expect.poll(() => page.evaluate(() => (window as unknown as {pushTest:{subscriptions:number}}).pushTest.subscriptions)).toBe(1);
  await expect(page.locator('[data-member-push]')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as {pushTest:{permissions:number}}).pushTest.permissions)).toBe(0);
});

test('a failed save keeps the browser subscription, for the next chat open to save', async ({ page }) => {
  let saves = 0;
  await page.route('**/api/patient/push/subscribe', route => { saves++; return route.fulfill({ status: 503, body: '{}' }); });
  await page.addInitScript(() => Object.defineProperty(Notification, 'permission', { value: 'granted', configurable: true }));
  await page.goto(fixture.url + '/patient/chat?push');
  await expect.poll(() => saves).toBe(1);
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => (window as unknown as {pushTest:{unsubscribes:number}}).pushTest.unsubscribes)).toBe(0);
});

test('granted permission reconciles subscription even after Not now, without requesting permission', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('noreon:member-push:not-now', '1');
    Object.defineProperty(Notification, 'permission', { value: 'granted', configurable: true });
  });
  await page.goto(fixture.url + '/patient/chat?push');
  await expect.poll(() => page.evaluate(() => (window as unknown as {pushTest:{subscriptions:number}}).pushTest.subscriptions)).toBe(1);
  await expect(page.locator('[data-member-push]')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as {pushTest:{permissions:number}}).pushTest.permissions)).toBe(0);
});

test('notification opens its saved notice; unknown IDs follow the normal thread position', async ({ page }) => {
  const target = noticeHistory()[3];
  await page.goto(fixture.url + '/patient/chat?notice=' + target.id);
  const bubble = page.locator(`[data-notice="${target.id}"]`);
  await expect(bubble).toBeVisible();
  expect(await bubble.evaluate(el => el.getBoundingClientRect().top - document.querySelector('.cv2-thread')!.getBoundingClientRect().top)).toBeLessThan(100);
  await page.goto(fixture.url + '/patient/chat?notice=unknown');
  await expect.poll(() => page.locator('.cv2-thread').evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThan(2);
});
