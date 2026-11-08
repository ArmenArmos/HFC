import type { Locator, Page } from "@playwright/test";
import { expect, test, accounts, asPerson, desktop, openZoe, phone, sql } from "../fixtures";

const card = (page: Page, kind: string) => page.locator(`[data-zoe-card="${kind}"]`).last();
const messages = (who: string, like: string) => sql(`select count(*) from public.conversation_messages m join public.conversations c on c.id=m.conversation_id where c.member_id='${accounts[who].id}' and m.author_id='${accounts[who].id}' and m.body like '%${like}%'`);
const readings = (who: string) => sql(`select coalesce(string_agg(systolic||'/'||diastolic,',' order by created_at),'') from public.patient_measurements where user_id='${accounts[who].id}'`);

/** Two taps inside one browser task, before React can disable the button: the worst real double tap. */
const doubleTap = (button: Locator) => button.evaluate((el: HTMLElement) => { el.click(); el.click(); });

async function fillBp(page: Page, systolic: string, diastolic: string, review: string | null) {
  const bp = card(page, "bp");
  const prefix = (await bp.locator('input[inputmode="numeric"]').first().getAttribute("id"))!.replace(/systolic$/, "");
  await page.locator(`[id="${prefix}systolic"]`).fill(systolic);
  await page.locator(`[id="${prefix}diastolic"]`).fill(diastolic);
  if (review) await bp.getByRole("button", { name: review }).click();
}

test("Armenian phone: a double tap on the message card stores one message", async ({ browser }) => {
  const { page } = await asPerson(browser, "zoeHy", phone);
  await openZoe(page);
  await page.locator('[data-zoe-card-chip="message"]').click();
  const message = card(page, "message");
  await message.locator("textarea").fill("Հարց իմ հաջորդ այցի մասին կրկնակի");
  await message.getByRole("button", { name: "Ստուգել" }).click();
  await doubleTap(message.getByRole("button", { name: "Այո, ուղարկել" }));
  await expect.poll(() => messages("zoeHy", "կրկնակի")).toBe("1");
  await expect(message).toHaveAttribute("data-state", "done");
  // Later sends and the server's own retries must not add a second copy.
  await page.waitForTimeout(3000);
  expect(messages("zoeHy", "կրկնակի")).toBe("1");
  await page.reload();
  await expect(page.getByText("Հարց իմ հաջորդ այցի մասին կրկնակի")).toHaveCount(1);
});

test("Armenian phone: a double tap on the BP card stores one reading", async ({ browser }) => {
  const { page } = await asPerson(browser, "zoeHy", phone);
  await openZoe(page);
  await page.locator('[data-zoe-card-chip="bp"]').click();
  await fillBp(page, "128", "82", null);
  expect(readings("zoeHy"), "nothing is stored until the member presses").toBe("");
  // One press saves (#483 removed the extra confirm step).
  await doubleTap(card(page, "bp").getByRole("button", { name: "Պահել չափումը" }));
  await expect(card(page, "bp").locator("[data-zoe-bp-saved]")).toBeVisible();
  await page.waitForTimeout(2000);
  expect(readings("zoeHy")).toBe("128/82");
  await page.reload();
  await expect(card(page, "bp").locator("[data-zoe-bp-saved]")).toContainText("128/82");
  expect(readings("zoeHy")).toBe("128/82");
});

test("English desktop: a lost response keeps the draft and the retry adds no second message", async ({ browser }) => {
  const { page } = await asPerson(browser, "zoeEn", desktop);
  await openZoe(page);
  await page.locator('[data-zoe-card-chip="message"]').click();
  const message = card(page, "message");
  await message.locator("textarea").fill("Lost response question");
  await message.getByRole("button", { name: "Check before sending" }).click();
  // The cards poll would show the stored result and finish the card before the retry.
  await page.route("**/api/patient/zoe/cards", (route) => route.abort());
  // The server does the work; the phone never hears back.
  let dropped = 0;
  await page.route("**/patient/zoe", async (route) => {
    if (route.request().method() === "POST" && dropped === 0) { dropped++; await route.fetch(); return route.abort("connectionfailed"); }
    return route.fallback();
  });
  await message.getByRole("button", { name: "Yes, send it" }).click();
  await expect.poll(() => dropped).toBe(1);
  await expect.poll(() => messages("zoeEn", "Lost response")).toBe("1");
  await expect(message.getByText("Lost response question")).toBeVisible();
  await message.getByRole("button", { name: "Yes, send it" }).click();
  await expect(message).toHaveAttribute("data-state", "done");
  expect(messages("zoeEn", "Lost response")).toBe("1");
});

test("the chat box: a double tap on send stores one message", async ({ browser }) => {
  const { page } = await asPerson(browser, "zoeEn", phone);
  await openZoe(page);
  await page.locator("textarea").last().fill("Composer double tap question");
  await doubleTap(page.locator('button[type="submit"]').last());
  await expect.poll(() => messages("zoeEn", "Composer double tap")).toBe("1");
  await page.waitForTimeout(3000);
  expect(messages("zoeEn", "Composer double tap")).toBe("1");
});
