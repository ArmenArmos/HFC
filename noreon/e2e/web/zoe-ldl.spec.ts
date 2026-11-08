import { accounts, asPerson, expect, openZoe, phone, sql, test } from "../fixtures";

// permissions.spec.ts confirms a goal for otherMember. This journey must start without one.
const id = accounts.zoeLdl.id;
const clear = () => sql(`set session_replication_role=replica; delete from public.ldl_index_events where member_id='${id}'; set session_replication_role=origin; delete from public.zoe_chat_cards where member_id='${id}'`);
test.afterEach(clear);

test("the LDL goal comes into the chat as the goal card, with no number before the doctor sets it", async ({ browser }) => {
  clear();
  expect(sql(`select count(*) from public.ldl_goals where member_id='${id}'`)).toBe("0");
  const { page } = await asPerson(browser, "zoeLdl", phone);
  await openZoe(page);
  await page.locator('[data-zoe-card-chip="ldl"]').click();
  const cards = page.locator('[data-zoe-card="ldl"]');
  await expect(cards.last()).toContainText("has not started");
  await expect(cards.last().locator('a[href="/patient/progress"]'), "no link to the page").toHaveCount(0);
  sql(`insert into public.ldl_index_events(member_id,submission_id,event_type,event_on,source,recorded_by) select '${id}',gen_random_uuid(),'acs_mi',current_date-30,'doctor_entered',assigned_doctor_id from public.patient_clinical_cases where user_id='${id}'`);
  await cards.last().locator("[data-zoe-show-current]").click();
  await expect(cards).toHaveCount(2);
  const fresh = cards.last().locator("[data-ldl-goal]");
  await expect(fresh).toContainText("Your doctor is setting your goal");
  expect(await fresh.innerText()).not.toMatch(/\d/);
  await expect(cards.first(), "the old card stays as it was shown").toContainText("has not started");
});
