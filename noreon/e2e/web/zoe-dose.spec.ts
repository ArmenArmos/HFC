import { accounts, asPerson, desktop, expect, openZoe, phone, sql, test } from "../fixtures";
import type { Locator, Page } from "@playwright/test";

const cards = (page: Page) => page.locator('[data-zoe-card="dose"]');
const doses = (who: string) => sql(`select coalesce(string_agg(status||':'||revision,',' order by due_at),'') from public.member_medicine_doses where user_id='${accounts[who].id}'`);
/** Two taps inside one browser task, before React can disable the button: the worst real double tap. */
const doubleTap = (button: Locator) => button.evaluate((el: HTMLElement) => { el.click(); el.click(); });
/**
 * One medicine due five minutes ago, today, for this member only. In the first minutes after midnight (Asia/Yerevan)
 * "five minutes ago" is yesterday's 23:5x, which is a slot of the previous day and reads as upcoming today, so it is due at 00:00.
 */
function dueNow(who: string, name: string) {
  const id = accounts[who].id;
  sql(`delete from public.member_medicine_doses where user_id='${id}'; delete from public.member_medicines where user_id='${id}';
   insert into public.member_medicines(user_id,name,dose,times,started_on) values('${id}','${name}','5 mg',array[
     case when (clock_timestamp() at time zone 'Asia/Yerevan')::time < time '00:10' then time '00:00'
          else to_char((clock_timestamp()-interval '5 minutes') at time zone 'Asia/Yerevan','HH24:MI')::time end],current_date-3);`);
}

test("Armenian phone: a dose from the card saves once, and current stays in the chat", async ({ browser }) => {
  dueNow("zoeHy", "Սինթետիկ դեղ");
  const { page } = await asPerson(browser, "zoeHy", phone);
  await openZoe(page);
  await page.locator('[data-zoe-card-chip="dose"]').click();
  const first = cards(page).last();
  await expect(first).toContainText("Սինթետիկ դեղ");
  await expect(first.locator('a[href="/patient/medicines"]')).toHaveCount(0);
  expect(doses("zoeHy"), "nothing is stored until the member presses").toBe("");
  // One press records the dose (#483 removed the extra confirm step).
  await doubleTap(first.getByRole("button", { name: "Նշել՝ ընդունված" }));
  await expect(first.locator('[data-zoe-dose-logged="taken"]')).toBeVisible();
  await page.waitForTimeout(1500);
  expect(doses("zoeHy")).toBe("taken:1");

  await first.locator("[data-zoe-show-current]").click();
  await expect(cards(page)).toHaveCount(2);
  const fresh = cards(page).last();
  await expect(fresh.locator('[data-zoe-dose-logged="taken"]')).toBeVisible();
  await expect(fresh.getByRole("button", { name: "Նշել՝ ընդունված" })).toHaveCount(0);
  await expect(fresh.getByRole("heading")).toBeFocused();
  await page.reload();
  await expect(cards(page)).toHaveCount(2);
  expect(doses("zoeHy"), "a fresh card writes nothing").toBe("taken:1");
});

test("English desktop: a record changed elsewhere is told in the chat, and the fresh card shows it", async ({ browser }) => {
  dueNow("zoeEn", "Synthetic medicine");
  const { page } = await asPerson(browser, "zoeEn", desktop);
  await openZoe(page);
  await page.locator('[data-zoe-card-chip="dose"]').click();
  const shown = cards(page).last();
  await expect(shown).toContainText("Synthetic medicine");
  // The medicines page, or the same member on Telegram, logged it after this card was shown.
  const id = accounts.zoeEn.id;
  sql(`insert into public.member_medicine_doses(medicine_id,user_id,due_at,status)
   select m.id,m.user_id,public._member_medicine_due((clock_timestamp() at time zone 'Asia/Yerevan')::date,m.times[1]),'skipped' from public.member_medicines m where m.user_id='${id}' and m.stopped_at is null;
   update public.member_medicine_doses set status='skipped',revision=revision+1 where user_id='${id}';`);
  await shown.getByRole("button", { name: "Mark as taken" }).click();
  await expect(shown.getByRole("alert")).toContainText("You can see the current record here in the chat");
  expect(doses("zoeEn"), "the other record stands").toMatch(/^skipped:/);
  await shown.locator("[data-zoe-show-current]").click();
  await expect(cards(page)).toHaveCount(2);
  await expect(cards(page).last().locator('[data-zoe-dose-logged="skipped"]')).toBeVisible();
  // The old card stays as it was shown.
  await expect(cards(page).first().locator('[data-zoe-dose-logged]')).toHaveCount(0);
});
