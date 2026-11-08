import type { Browser } from "@playwright/test";
import { env, expect, test, accounts, asPerson, openZoe, phone, sql } from "../fixtures";

const TOLD = "We have told the Noreon care team";
const NOT_TOLD = "has not been notified";
const alerts = (who: string) => sql(`select count(*) from public.care_alerts where member_id='${accounts[who].id}'`);
const newestRequest = (who: string) => sql(`select m.request_id from public.conversation_messages m join public.conversations c on c.id=m.conversation_id where c.member_id='${accounts[who].id}' order by m.seq desc limit 1`);
const alertsSwitch = (on: boolean) => sql(`insert into public.care_alert_settings(enabled) values(${on}) on conflict(singleton) do update set enabled=${on}`);

async function typeUrgentWords(browser: Browser, who: string) {
  const { page } = await asPerson(browser, who, phone);
  // The dev server compiles the 103 screen on first use (25 s in CI), longer than the redirect wait below.
  await page.request.get(`${env.site}/patient/zoe/urgent`, { timeout: 180_000 });
  await openZoe(page);
  await page.locator("textarea").last().fill("I have crushing chest pain right now");
  await page.locator('button[type="submit"]').last().click();
  await expect(page).toHaveURL(/\/patient\/zoe\/urgent/, { timeout: 30_000 });
  return page;
}

test.describe.configure({ mode: "serial" });
test.afterAll(() => { alertsSwitch(false); });

test("alert raised: the 103 screen says the care team was told, and never that nobody was", async ({ browser }) => {
  alertsSwitch(true);
  const before = alerts("zoeEn");
  const page = await typeUrgentWords(browser, "zoeEn");
  await expect(page.getByRole("link", { name: "Call 103 now" })).toBeVisible();
  await expect(page.getByText(NOT_TOLD)).toHaveCount(0);
  await expect(page.getByText(TOLD)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(NOT_TOLD)).toHaveCount(0);
  expect(Number(alerts("zoeEn"))).toBeGreaterThan(Number(before));
  await page.reload();
  await expect(page.getByText(TOLD)).toBeVisible();
});

test("an alerted message's id reused with other urgent text: the 103 screen opens with no line, never told", async ({ browser }) => {
  alertsSwitch(true);
  const alerted = newestRequest("zoeEn");
  expect(alerted).toMatch(/^[0-9a-f-]{36}$/);
  const { page } = await asPerson(browser, "zoeEn", phone);
  await openZoe(page);
  await page.route("**/patient/zoe", (route) => {
    const body = route.request().postData();
    const replaced = body?.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/, alerted);
    return route.continue(route.request().headers()["next-action"] && replaced ? { postData: replaced } : undefined);
  });
  await page.locator("textarea").last().fill("My chest pain is crushing and worse");
  await page.locator('button[type="submit"]').last().click();
  await expect(page).toHaveURL(/\/patient\/zoe\/urgent$/, { timeout: 30_000 });
  await expect(page.getByRole("link", { name: "Call 103 now" })).toBeVisible();
  await page.waitForTimeout(4000);
  await expect(page.getByText(TOLD)).toHaveCount(0);
  await expect(page.getByText(NOT_TOLD)).toHaveCount(0);
});

test("alerts off: the 103 screen opens with no line, because work can resume when they are back on", async ({ browser }) => {
  alertsSwitch(false);
  const before = alerts("otherMember");
  const page = await typeUrgentWords(browser, "otherMember");
  await expect(page.getByRole("link", { name: "Call 103 now" })).toBeVisible();
  await page.waitForTimeout(4000);
  await expect(page.getByText(TOLD)).toHaveCount(0);
  await expect(page.getByText(NOT_TOLD)).toHaveCount(0);
  expect(alerts("otherMember")).toBe(before);
});

test("settled with no alert: the 103 screen says nobody was notified, and never that the team was told", async ({ browser }) => {
  alertsSwitch(true);
  const { page } = await asPerson(browser, "zoeHy", phone);
  await openZoe(page);
  await page.locator("textarea").last().fill("Harmless question for the settled case");
  await page.locator('button[type="submit"]').last().click();
  await expect.poll(() => sql(`select count(*) from public.conversation_messages where body='Harmless question for the settled case'`)).toBe("1");
  const request = newestRequest("zoeHy");
  // What the sweeps leave behind for a message with no urgent words.
  sql(`insert into public.care_alert_screenings(source,source_ref,member_id,outcome,reason_code,rule_id,rule_version)
    select 'message',m.id::text,m.author_id,'recorded','no_listed_urgent_words','care_alert.urgent_lexicon','e2e' from public.conversation_messages m where m.request_id='${request}' on conflict do nothing;
   insert into public.zoe_runs(conversation_id,member_id,message_seq,context_version,draft_epoch,spend_day,state,outcome,reason_code,finished_at)
    select m.conversation_id,m.author_id,m.seq,c.version,c.draft_epoch,current_date,'finished','skipped','e2e_settled',now() from public.conversation_messages m join public.conversations c on c.id=m.conversation_id where m.request_id='${request}'
    on conflict(conversation_id,message_seq) do update set state='finished',outcome='skipped',reason_code='e2e_settled',finished_at=now()`);
  await page.goto(`${env.site}/patient/zoe/urgent?request=${request}`);
  await expect(page.getByText("չեն ծանուցվել")).toBeVisible();
  await expect(page.getByText("տեղեկացրել ենք")).toHaveCount(0);
});
