import { accounts, asPerson, desktop, expect, openZoe, sql, test } from "../fixtures";

const id = accounts.zoeEn.id, plan = "e2e00000-0000-4000-8000-00000000e001";
const clear = () => sql(`delete from public.patient_care_results where user_id='${id}'; delete from public.zoe_chat_cards where member_id='${id}'; delete from public.patient_care_plans where id='${plan}'`);
test.afterEach(clear);

test("English desktop: results stay in the chat, with LDL on the first card and more as a fresh card", async ({ browser }) => {
  clear();
  sql(`insert into public.patient_care_plans(id,user_id,clinician,instructions,published_at) values('${plan}','${id}','Fictional doctor','Fictional only',now()-interval '2 days');
   set session_replication_role=replica;
   insert into public.patient_care_results(user_id,marker,value,unit,collected_at,received_at,source,source_label,reviewed_at,reviewed_by,publication_plan_id)
   select '${id}',case when n=14 then 'LDL cholesterol' else 'Marker '||n end,n,'mmol/L',now()-make_interval(hours=>n),now(),'laboratory','Fictional',now(),'Fictional doctor','${plan}' from generate_series(1,14) n;
   set session_replication_role=origin;`);
  const { page } = await asPerson(browser, "zoeEn", desktop);
  await openZoe(page);
  await page.locator('[data-zoe-card-chip="results"]').click();
  const cards = page.locator('[data-zoe-card="results"]');
  const first = cards.last();
  await expect(first.locator("dt").first()).toContainText("LDL cholesterol");
  await expect(first.locator("dt")).toHaveCount(12);
  await expect(first.locator('a[href="/patient/results"]'), "no link to the page").toHaveCount(0);
  await first.getByRole("button", { name: "Show 2 more" }).click();
  await expect(cards).toHaveCount(2);
  await expect(cards.last().locator("dt")).toHaveCount(2);
  await expect(cards.last().getByRole("button", { name: "Show" })).toHaveCount(0); // Nothing more to page through.
  await expect(cards.last().getByRole("button", { name: "Refresh" })).toHaveCount(1); // Only the refresh is left.
  await page.reload();
  await expect(cards).toHaveCount(2);
});
