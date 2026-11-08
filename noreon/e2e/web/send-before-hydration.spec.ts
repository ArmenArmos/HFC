import type { Page } from "@playwright/test";
import { asPerson, env, expect, phone, test } from "../fixtures";

// Run with NOREON_E2E_CHAT_V2=true to cover /patient/chat as well.
const WORDS = "I have crushing chest pain right now";
// Sends here count against the message limit, so these members are not the ones zoe-urgent.spec.ts uses.
const MEMBER = "evidenceIphone", OTHER = "evidenceGalaxy";
const paths = ["/patient/zoe", ...(process.env.NOREON_E2E_CHAT_V2 === "true" ? ["/patient/chat"] : [])];

/** A slow phone: the page has painted and scripts have not arrived. */
const holdScripts = async (page: Page) => {
  let release = () => {};
  const held = new Promise<void>((done) => { release = done; });
  await page.route(/\/_next\/static\/.*\.js/, async (route) => { await held; await route.continue().catch(() => {}); });
  return release;
};
const composer = (page: Page) => page.locator("textarea").last();
const send = (page: Page) => page.locator('button[type="submit"]').last();
const isHydrated = (page: Page) => composer(page).evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactProps")));

/** Opens with scripts held back, so everything after this runs before hydration. */
async function openUnhydrated(page: Page, path: string, load: "first load" | "reload") {
  if (load === "reload") {
    await page.goto(env.site + path);
    await expect.poll(() => isHydrated(page)).toBe(true);
  }
  const release = await holdScripts(page);
  if (load === "reload") await page.reload({ waitUntil: "commit" });
  else await page.goto(env.site + path, { waitUntil: "commit" });
  await composer(page).waitFor();
  expect(await isHydrated(page)).toBe(false);
  return release;
}

for (const path of paths) {
  for (const load of ["first load", "reload"] as const) test(`${path} ${load}: send before hydration keeps the words and the urgent path`, async ({ browser }) => {
    test.setTimeout(240_000);
    const { page } = await asPerson(browser, MEMBER, phone);
    const mismatches: string[] = [];
    page.on("console", (message) => { if (message.type() === "error" && /hydrat/i.test(message.text())) mismatches.push(message.text()); });
    const release = await openUnhydrated(page, path, load);
    await composer(page).click();
    await page.keyboard.type(WORDS);
    await send(page).click({ force: true });
    await expect(page.getByText("Getting the chat ready. Your message stays here.")).toBeVisible();
    await expect(composer(page)).toHaveValue(WORDS);
    expect(new URL(page.url()).search).toBe("");
    release();
    await expect(send(page)).toBeEnabled({ timeout: 30_000 });
    await expect(composer(page)).toHaveValue(WORDS);
    expect(mismatches).toEqual([]);
    await send(page).click();
    // The urgent screen is compiled by the dev server on its first use, which in a run that starts here can take longer than 30 s.
    await expect(page).toHaveURL(/\/patient\/zoe\/urgent/, { timeout: 120_000 });
    await expect(page).not.toHaveURL(/chest/);
  });

  test(`${path}: text typed before hydration wins over an old saved draft`, async ({ browser }) => {
    test.setTimeout(240_000);
    const { page } = await asPerson(browser, OTHER, phone);
    await page.goto(env.site + path);
    await expect.poll(() => isHydrated(page)).toBe(true);
    await composer(page).fill("An older unsent note");
    await expect.poll(() => page.evaluate(() => Object.keys(sessionStorage).some((key) => (sessionStorage.getItem(key) ?? "").includes("An older unsent note")))).toBe(true);
    const release = await openUnhydrated(page, path, "first load");
    await composer(page).click();
    await page.keyboard.type(WORDS);
    release();
    await expect(send(page)).toBeEnabled({ timeout: 30_000 });
    await expect(composer(page)).toHaveValue(WORDS);
    await send(page).click();
    // The urgent screen is compiled by the dev server on its first use, which in a run that starts here can take longer than 30 s.
    await expect(page).toHaveURL(/\/patient\/zoe\/urgent/, { timeout: 120_000 });
  });

  test(`${path}: the same text typed over a saved draft keeps its request id`, async ({ browser }) => {
    test.setTimeout(240_000);
    const { page } = await asPerson(browser, OTHER, phone);
    // A send that may have gone: the draft keeps its id, so sending again can never store it twice.
    const words = `${WORDS} ${Date.now()}`;
    await page.goto(env.site + path);
    await expect.poll(() => isHydrated(page)).toBe(true);
    await composer(page).fill(words);
    await expect.poll(() => page.evaluate((text) => Object.keys(sessionStorage).some((key) => (sessionStorage.getItem(key) ?? "").includes(text)), words)).toBe(true);
    const request = await page.evaluate((text) => {
      const id = crypto.randomUUID();
      const key = Object.keys(sessionStorage).find((name) => (sessionStorage.getItem(name) ?? "").includes(text))!;
      const saved = JSON.parse(sessionStorage.getItem(key)!);
      sessionStorage.setItem(key, JSON.stringify({ ...saved, value: JSON.stringify({ text, requestId: id }) }));
      return id;
    }, words);
    const release = await openUnhydrated(page, path, "first load");
    await composer(page).click();
    await page.keyboard.type(words);
    release();
    await expect(send(page)).toBeEnabled({ timeout: 30_000 });
    await expect(composer(page)).toHaveValue(words);
    await send(page).click();
    await expect(page).toHaveURL(new RegExp(`/patient/zoe/urgent\\?request=${request}`), { timeout: 30_000 });
  });

  test(`${path}: 103 is a working call before hydration`, async ({ browser }) => {
    test.setTimeout(240_000);
    const { page } = await asPerson(browser, MEMBER, phone);
    const release = await openUnhydrated(page, path, "first load");
    await expect(page.locator('a[href="tel:103"]').first()).toBeVisible();
    release();
  });
}
