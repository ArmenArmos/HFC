import { accounts, asPerson, desktop, expect, openZoe, phone, sql, test } from "../fixtures";
import type { Locator, Page } from "@playwright/test";

const cards = (page: Page) => page.locator('[data-zoe-card="bp"]');
const readings = (who: string) => sql(`select coalesce(string_agg(systolic||'/'||diastolic,',' order by measured_at),'') from public.patient_measurements where user_id='${accounts[who].id}'`);
const doubleTap = (button: Locator) => button.evaluate((el: HTMLElement) => { el.click(); el.click(); });
const clear = (who: string) => sql(`delete from public.patient_measurements where user_id='${accounts[who].id}'; delete from public.zoe_chat_cards where member_id='${accounts[who].id}'`);
// Other specs count this member's readings from nothing.
test.afterEach(() => { clear("zoeHy"); clear("zoeEn"); });

test("Armenian phone: a reading saves once in the chat, and current stays in the chat", async ({ browser }) => {
  clear("zoeHy");
  const { page } = await asPerson(browser, "zoeHy", phone);
  await openZoe(page);
  await page.locator('[data-zoe-card-chip="bp"]').click();
  const first = cards(page).last();
  await expect(first.locator("input").first()).toBeVisible();
  await expect(first.locator('a[href="/patient/measurements"]'), "no link to the page").toHaveCount(0);
  // A member with no reading has nothing to show yet: the button comes with the first saved reading.
  await expect(first.locator("[data-zoe-show-current]")).toHaveCount(0);
  await first.locator('input[id$="-systolic"]').fill("150");
  await first.locator('input[id$="-diastolic"]').fill("95");
  expect(readings("zoeHy"), "nothing is stored while the member is still typing").toBe("");
  // One press saves (#483 removed the extra confirm step).
  await doubleTap(first.getByRole("button", { name: "Պահել չափումը" }));
  await expect(first.locator("[data-zoe-bp-saved]")).toBeVisible();
  await expect(first.locator("[data-zoe-show-current]")).toBeVisible();
  await page.waitForTimeout(1500);
  expect(readings("zoeHy")).toBe("150/95");

  await first.locator("[data-zoe-show-current]").click();
  await expect(cards(page)).toHaveCount(2);
  const fresh = cards(page).last();
  await expect(fresh.locator("[data-zoe-bp-latest]")).toContainText("150/95");
  await expect(fresh.getByRole("heading")).toBeFocused();
  await page.reload();
  await expect(cards(page)).toHaveCount(2);
  expect(readings("zoeHy"), "a fresh card writes nothing").toBe("150/95");
});

test("English desktop: the saved card says nobody is told, and the fresh card shows the record", async ({ browser }) => {
  clear("zoeEn");
  const { page } = await asPerson(browser, "zoeEn", desktop);
  await openZoe(page);
  await page.locator('[data-zoe-card-chip="bp"]').click();
  const shown = cards(page).last();
  await shown.locator('input[id$="-systolic"]').fill("138");
  await shown.locator('input[id$="-diastolic"]').fill("86");
  await shown.locator('input[id$="-pulse"]').fill("72");
  await shown.getByRole("button", { name: "Save reading" }).click();
  await expect(shown.locator("[data-zoe-bp-saved]")).toContainText("138/86, pulse 72");
  await expect(shown).toContainText("does not automatically notify a doctor");
  await page.reload();
  await expect(cards(page).last().locator("[data-zoe-bp-saved]")).toContainText("138/86");
  expect(readings("zoeEn")).toBe("138/86");
});
