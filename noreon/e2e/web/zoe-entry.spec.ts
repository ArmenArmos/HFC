import type { Page } from "@playwright/test";
import { accounts, asPerson, expect, openZoe, phone, sql, test } from "../fixtures";

const id = accounts.zoeHy.id;
const offer = (page: Page) => page.locator("[data-zoe-card-offer]");
const send = async (page: Page, text: string) => {
  await page.locator("textarea").last().fill(text);
  await page.locator('button[type="submit"]').last().click();
  await expect.poll(() => sql(`select count(*) from public.conversation_messages m join public.conversations c on c.id=m.conversation_id where c.member_id='${id}' and m.body='${text}'`)).toBe("1");
};
/** Zoe's run ended this way for the newest message. Real model runs are proved in output/member-cards/REVIEW_5_entry.md. */
const zoeFinished = (reason: string, forward: string) => sql(`insert into public.zoe_runs(conversation_id,member_id,message_seq,context_version,draft_epoch,state,outcome,reason_code,forward,spend_day,finished_at)
 select c.id,c.member_id,(select max(m.seq) from public.conversation_messages m where m.conversation_id=c.id),0,0,'finished','answered','${reason}','${forward}',current_date,clock_timestamp() from public.conversations c where c.member_id='${id}'`);
const clear = () => sql(`delete from public.patient_measurements where user_id='${id}'; delete from public.zoe_chat_cards where member_id='${id}'`);
test.afterEach(clear);

test("Armenian phone: a typed request brings the offer after Zoe's guarded answer, and the card it opens saves", async ({ browser }) => {
  clear();
  const { page } = await asPerson(browser, "zoeHy", phone);
  await openZoe(page);
  await send(page, "Գրանցել ճնշումը խնդրում եմ ճնշում");
  await expect(offer(page), "nothing before Zoe has cleared the message").toHaveCount(0);
  zoeFinished("health_answer_passed_guards", "none");
  await expect(offer(page)).toHaveAttribute("data-zoe-card-offer", "bp", { timeout: 30_000 });
  await offer(page).getByRole("button").click();
  const card = page.locator('[data-zoe-card="bp"]').last();
  await card.locator('input[id$="-systolic"]').fill("131");
  await card.locator('input[id$="-diastolic"]').fill("83");
  await card.getByRole("button", { name: "Պահել չափումը" }).click();
  await expect(card.locator("[data-zoe-bp-saved]")).toContainText("131/83");
  await page.reload();
  await expect(page.locator('[data-zoe-card="bp"]').last().locator("[data-zoe-bp-saved]")).toContainText("131/83");
  await expect(offer(page), "the offer is used").toHaveCount(0);
});

test("Armenian phone: no offer after an answer sent on to the doctor, or after a question with no action words", async ({ browser }) => {
  clear();
  const { page } = await asPerson(browser, "zoeHy", phone);
  await openZoe(page);
  await send(page, "Գրանցել ճնշումը երկրորդ ճնշում");
  zoeFinished("health_answer_passed_guards", "auto");
  await page.waitForTimeout(6000);
  await expect(offer(page)).toHaveCount(0);
  await send(page, "Ինչ է խոլեստերինը");
  zoeFinished("health_answer_passed_guards", "none");
  await page.waitForTimeout(6000);
  await expect(offer(page)).toHaveCount(0);
});
