import type { Page } from "@playwright/test";
import { expect, test, accounts, fixtureId, asPerson, desktop, open, phone, sql, staffSignIn } from "../fixtures";

const memberId = accounts.ldlMember.id;
const released = "1.9";
const unreleased = "2.8";
const goalCard = (page: Page) => page.locator("[data-ldl-goal]");

test("no LDL number reaches the member until the doctor confirms the goal", async ({ browser }) => {
  const { page: member } = await asPerson(browser, "ldlMember", phone);
  const { page: doctor } = await staffSignIn(browser, "doctor", "en", desktop);

  // A released LDL the member may compare against, and a newer one the doctor has not released, which must never reach them.
  sql(`insert into public.patient_care_plans(id,user_id,clinician,instructions) values('${fixtureId(31)}','${memberId}','Dr Fictional Hayk','Fictional plan.');
    insert into public.patient_care_results(user_id,marker,value,unit,collected_at,received_at,source,source_label,reviewed_at,reviewed_by,publication_plan_id) values('${memberId}','LDL-C',${released},'mmol/L',now()-interval '5 days',now(),'clinic','Fictional lab',now(),'${accounts.doctor.id}','${fixtureId(31)}')`);
  sql(`insert into public.patient_care_results(user_id,marker,value,unit,collected_at,received_at,source,source_label) values('${memberId}','LDL-C',${unreleased},'mmol/L',now()-interval '1 day',now(),'clinic','Fictional lab')`);

  await test.step("nothing shows before the doctor starts the LDL record", async () => {
    await open(member, "/patient/dashboard");
    await expect(member.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(goalCard(member)).toHaveCount(0);
  });

  await test.step("event recorded: the member sees the holding message and no number", async () => {
    await open(doctor, `/staff/real/members/${memberId}?locale=en`);
    await doctor.getByRole("button", { name: "Record event" }).click();
    await expect(doctor.getByText("Heart attack / acute coronary syndrome ·")).toBeVisible();
    await open(member, "/patient/dashboard");
    await expect(goalCard(member)).toContainText("Ձեր բժիշկը սահմանում է ձեր նպատակը");
    expect(await goalCard(member).innerText()).not.toMatch(/\d/);
    await open(member, "/patient/progress");
    await expect(goalCard(member)).toContainText("Ձեր բժիշկը սահմանում է ձեր նպատակը");
    expect(await goalCard(member).innerText()).not.toMatch(/\d/);
    // The doctor's draft is not stored as a goal either.
    expect(sql(`select count(*) from public.ldl_goals where member_id='${memberId}'`)).toBe("0");
  });

  await test.step("doctor confirms: the member sees the exact goal", async () => {
    await doctor.reload();
    await doctor.getByRole("radio", { name: "Documented, before lipid-lowering treatment" }).check();
    await doctor.locator('input[name="baselineMmol"]').fill("3.8");
    await doctor.locator('input[name="baselineOn"]').fill("2026-09-01");
    await doctor.getByRole("button", { name: "Confirm goal and show it to the member" }).click();
    await expect(doctor.getByText("Goal not yet set")).toHaveCount(0);
    await open(member, "/patient/dashboard");
    await expect(goalCard(member)).toContainText("1.4");
    await expect(goalCard(member)).not.toContainText("Ձեր բժիշկը սահմանում է ձեր նպատակը");
    await expect(goalCard(member)).toContainText("Dr Fictional Hayk");
    await expect(goalCard(member)).toContainText(released);
    await expect(goalCard(member)).toContainText("Բուժումից առաջվանից 50%-ով ցածր");
    await expect(goalCard(member)).toContainText("Ձեր նպատակից բարձր է");
    expect(sql(`select version,threshold_mmol,reduction_rule,reduction_pct,baseline_kind,baseline_mmol,baseline_on from public.ldl_goals where member_id='${memberId}'`)).toBe("1|1.4|t|50|pre_treatment|3.80|2026-09-01");
    await expect(goalCard(member)).not.toContainText(unreleased);
    await goalCard(member).getByRole("link").first().click();
    await expect(member).toHaveURL(/patient\/progress/);
    await expect(goalCard(member)).toContainText("1.4");
    await expect(goalCard(member)).toContainText(released);
    await expect(member.locator("main")).not.toContainText(unreleased);
    await doctor.reload();
    await expect(doctor.locator("main")).toContainText(unreleased);
  });
});
