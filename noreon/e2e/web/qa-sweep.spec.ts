import type { Page } from "@playwright/test";
import { expect, test, accounts, asPerson, hydrated, isolated, open, phone, sql } from "../fixtures";

// The QA sweep of 30 Oct 2026: what only a real browser and a real session can show.

/** A tap before React has hydrated does nothing, for a test and for a very fast member. */
async function openAddForm(page: Page) {
  const add = page.getByRole("button", { name: /add a medicine/i });
  await hydrated(add);
  await add.click();
  await expect(page.getByLabel("Name, as on the box", { exact: true })).toBeVisible();
}

test("a stale tab cannot write to the member who signed in after it", async ({ browser }) => {
  const name = `Fictional stale tab ${Date.now()}`;
  const count = (who: string) => sql(`select count(*) from public.member_medicines where name='${name}' and user_id='${accounts[who].id}'`);
  const { context, page } = await asPerson(browser, "otherMember");
  await open(page, "/patient/medicines");
  await openAddForm(page);
  await page.getByLabel("Name, as on the box", { exact: true }).fill(name);
  await page.getByLabel("Time 1", { exact: true }).fill("07:30");

  // Another member signs in on the same browser: the session cookie is replaced under the open page.
  const other = await asPerson(browser, "previewEn");
  await context.addCookies(await other.context.cookies());
  await other.context.close();

  await page.getByRole("button", { name: /save to my list/i }).click();
  const refusal = page.getByRole("alertdialog");
  await expect(refusal).toContainText("Nothing from this page was saved");
  await expect(refusal.getByRole("link", { name: /103/ })).toHaveAttribute("href", "tel:103");
  expect(count("otherMember")).toBe("0");
  expect(count("previewEn")).toBe("0");

  // Reload continues as the member signed in now, and that member's own save works.
  await refusal.getByRole("button", { name: /reload/i }).click();
  await openAddForm(page);
  await page.getByLabel("Name, as on the box", { exact: true }).fill(name);
  await page.getByLabel("Time 1", { exact: true }).fill("07:30");
  await page.getByRole("button", { name: /save to my list/i }).click();
  await expect.poll(() => count("previewEn")).toBe("1");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  expect(count("otherMember")).toBe("0");
});

test("a tab that does not know its account has its writes refused under any session", async ({ browser }) => {
  const session = await (await asPerson(browser, "previewEn")).context.cookies();
  // The layout renders with no account, as it does when auth is down while a page that needs none opens.
  const context = await browser.newContext(phone);
  await isolated(context);
  const page = await context.newPage();
  await open(page, "/patient/help?locale=en");
  // Establish the signed-out client before replacing its session. An evaluate()
  // immediately after goto can run before the account-binding module loads.
  await expect.poll(() => page.getByRole("link", { name: "Back to sign in", exact: true }).evaluate((el) => Object.keys(el).some((key) => key.startsWith("__reactProps")))).toBe(true);
  await context.addCookies(session);
  const refused = page.waitForResponse((r) => r.request().method() === "POST" && r.status() === 409 && !!r.headers()["x-noreon-account-changed"]);
  await page.evaluate(() => { void fetch("/patient/medicines", { method: "POST", headers: { "next-action": "synthetic-action-id" }, body: "[]" }); });
  const response = await refused;
  expect(await response.request().headerValue("x-noreon-member-page")).toBe("none");
  await expect(page.getByRole("alertdialog")).toContainText("Nothing from this page was saved");
});

test("a tab that opened without an account binds with a full load when it moves into the app", async ({ browser }) => {
  const name = `Fictional late binding ${Date.now()}`;
  const signedIn = await asPerson(browser, "otherMember");
  const session = await signedIn.context.cookies();
  const context = await browser.newContext(phone);
  await isolated(context);
  const page = await context.newPage();
  await open(page, "/patient/help?locale=en");
  // Next exposes its debug router before hydration. Establish the signed-out page first,
  // then replace the session underneath it; the full-load assertion below still has to pass.
  await expect.poll(() => page.getByRole("link", { name: "Back to sign in", exact: true }).evaluate((el) => Object.keys(el).some((key) => key.startsWith("__reactProps")))).toBe(true);
  await context.addCookies(session);
  const loaded = page.waitForRequest((request) => request.isNavigationRequest() && new URL(request.url()).pathname === "/patient/medicines");
  await page.evaluate(() => (window as unknown as { next: { router: { push: (href: string) => void } } }).next.router.push("/patient/medicines"));
  await loaded;
  await openAddForm(page);
  await page.getByLabel("Name, as on the box", { exact: true }).fill(name);
  await page.getByLabel("Time 1", { exact: true }).fill("07:30");
  await page.getByRole("button", { name: /save to my list/i }).click();
  await expect.poll(() => sql(`select count(*) from public.member_medicines where name='${name}' and user_id='${accounts.otherMember.id}'`)).toBe("1");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
});

test("signing in binds the tab straight away", async ({ browser }) => {
  const name = `Fictional first write ${Date.now()}`;
  const context = await browser.newContext(phone);
  await isolated(context);
  const page = await context.newPage();
  await open(page, "/patient?locale=en");
  await page.locator("input").first().fill(accounts.previewEn.phone!.slice(3));
  await page.getByRole("button", { name: /send/i }).click();
  await page.locator("input").first().fill("246810");
  await expect(page).toHaveURL(/patient\/dashboard/);
  await open(page, "/patient/medicines");
  await openAddForm(page);
  await page.getByLabel("Name, as on the box", { exact: true }).fill(name);
  await page.getByLabel("Time 1", { exact: true }).fill("07:30");
  await page.getByRole("button", { name: /save to my list/i }).click();
  await expect.poll(() => sql(`select count(*) from public.member_medicines where name='${name}'`)).toBe("1");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
});

test("two tabs of one member are not told about another account", async ({ browser }) => {
  const name = `Fictional two tabs ${Date.now()}`;
  const { context, page } = await asPerson(browser, "otherMember");
  await open(page, "/patient/medicines");
  const second = await context.newPage();
  await open(second, "/patient/dashboard");
  await openAddForm(page);
  await page.getByLabel("Name, as on the box", { exact: true }).fill(name);
  await page.getByLabel("Time 1", { exact: true }).fill("07:30");
  await page.getByRole("button", { name: /save to my list/i }).click();
  await expect.poll(() => sql(`select count(*) from public.member_medicines where name='${name}'`)).toBe("1");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
});

test("member pages do not scroll sideways at 200% browser text", async ({ browser }) => {
  const { page } = await asPerson(browser, "zoeHy", { ...phone, viewport: { width: 390, height: 844 } });
  for (const path of ["/patient/dashboard", "/patient/account", "/patient/profile", "/patient/care", "/patient/zoe"]) {
    await open(page, path);
    await page.addStyleTag({ content: "html{font-size:200% !important}" });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth), { message: path }).toBeLessThanOrEqual(390);
    await expect(page.locator(".journey-help")).toBeInViewport();
  }
});

