import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createServerClient } from "@supabase/ssr";
import { test as base, devices, expect, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { fixtureId, sql } from "./db.mjs";

const envPath = process.env.NOREON_E2E_ENV!;
export const env = JSON.parse(readFileSync(envPath, "utf8")) as { site: string; api: string; anon: string; service: string };
export const accounts = JSON.parse(readFileSync(join(dirname(envPath), "accounts.json"), "utf8")) as Record<string, { id: string; email: string; password: string; phone?: string }>;
export { fixtureId, sql };
export { expect };
const blocked: string[] = [];
/** Open pages keep polling and hold connections, so nothing outlives its test. Any refused request fails the test. */
export const test = base.extend<{ closeContexts: void }>({
  closeContexts: [async ({ browser }, use) => {
    blocked.length = 0;
    await use();
    await Promise.all(browser.contexts().map((c) => c.close()));
    expect(blocked, "browser requests that left this machine").toEqual([]);
  }, { auto: true }],
});
export const SIGNUP_PHONE = "99000201";
export const SIGNUP_CODE = "246810";

export const phone = { ...devices["iPhone 13"], defaultBrowserType: undefined };
export const desktop = { viewport: { width: 1440, height: 900 } };

/** Controlled inputs can lose text entered before React attaches their event handlers. */
export const hydrated = (locator: Locator) => expect.poll(() => locator.evaluate((el) => Object.keys(el).some((key) => key.startsWith("__reactProps")))).toBe(true);

/** Everything outside this machine is refused and recorded; the test fails on it. */
export async function isolated(context: BrowserContext) {
  await context.route((url) => !["127.0.0.1", "localhost"].includes(url.hostname), (route) => { blocked.push(route.request().url()); return route.abort(); });
}

export async function asPerson(browser: Browser, who: string, options: Parameters<Browser["newContext"]>[0] = phone) {
  const account = accounts[who];
  const jar = new Map<string, { name: string; value: string }>();
  const client = createServerClient(env.api, env.anon, {
    cookies: { getAll: () => [...jar.values()], setAll: (items) => { for (const item of items) jar.set(item.name, item); } },
  });
  const { error } = await client.auth.signInWithPassword({ email: account.email, password: account.password });
  if (error) throw error;
  const context = await browser.newContext(options);
  await isolated(context);
  await context.addCookies([...jar.values()].filter((c) => c.value).map((c) => ({ name: c.name, value: c.value, url: env.site, sameSite: "Lax" as const })));
  return { context, page: await context.newPage() };
}

/** Real staff sign-in at the shared sign-in page. */
export async function staffSignIn(browser: Browser, who: string, locale = "en", options: Parameters<Browser["newContext"]>[0] = desktop) {
  const context = await browser.newContext(options);
  await isolated(context);
  const page = await context.newPage();
  const account = accounts[who];
  await page.goto(`${env.site}/staff/real/login?locale=${locale}`);
  // Typing before React has hydrated the form can lose the password, and sign-in then fails for no visible reason.
  await expect.poll(() => page.locator('input[type="email"]').evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactProps")))).toBe(true);
  await page.locator('input[type="email"]').fill(account.email);
  await page.locator('input[type="password"]').fill(account.password);
  await page.locator("form button").first().click();
  // The web suite enables the doctor's chat home. Other roles and suites retain Members.
  // Require the actual destination: leaving /login alone could mean an error page.
  // Use the configured navigation window, including a first dev-server compile.
  const doctorHome = process.env.NOREON_E2E_SUITE === "web" && ["doctor", "otherDoctor"].includes(who);
  // With the new nurse chat on, a nurse lands in it at the original address (nurse-home.spec.ts).
  const nurseHome = process.env.NOREON_E2E_NURSE_CHAT === "true" && who === "nurse";
  const destination = `${env.site}/staff/real/${doctorHome ? "doctor-workspace" : nurseHome ? "nurse-chat" : "members"}`;
  await page.waitForURL(destination);
  await expect(page).toHaveURL(destination);
  return { context, page };
}

export async function open(page: Page, path: string) {
  const response = await page.goto(env.site + path);
  expect(response?.status(), `${path} should load`).toBeLessThan(400);
}

/** Tapping before React has hydrated the chat box does nothing, for a test and for a very fast member. */
export async function openZoe(page: Page) {
  await open(page, "/patient/zoe");
  await expect.poll(() => page.locator("textarea").last().evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactProps")))).toBe(true);
}
