import { readFileSync } from "node:fs";
import { accounts, asPerson, expect, open, sql, staffSignIn, test } from "../fixtures";

// The real doctor journey with the rebuilt chat on: NOREON_E2E_DOCTOR_CHAT=true node e2e/run.mjs web doctor-chat-journey.
test.skip(process.env.NOREON_E2E_DOCTOR_CHAT !== "true", "Needs the doctor chat switches");
const memberId = accounts.regimenMember.id;
const name = "Fictional RegimenMember";
const fixture = JSON.parse(readFileSync("scripts/fixtures/patient-answers.json", "utf8"));
for (const [id, value] of Object.entries({ "q5.diagnosed": "no", "q5.last_reading.systolic": 118, "q5.last_reading.diastolic": 76, "q2.waist": 80, "q2.weight": 70 })) fixture[id].value = value;
const ANSWERS = JSON.stringify(fixture).replaceAll("'", "''");
const inDays = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const switches = (on: boolean) => sql(`update public.multi_medicine_capabilities set enabled=${on};update public.doctor_completion_capabilities set enabled=${on};`);
const links = (plan: string) => sql(`select string_agg(m.name||' '||m.dose,', ' order by m.name) from public.patient_care_plan_medications l join public.patient_care_medications m on m.id=l.medication_id where l.plan_id='${plan}'`);
const activePlan = () => sql(`select id from public.patient_care_plans where user_id='${memberId}' and active`);
const versions = () => sql(`select count(*) from public.patient_care_plan_regimens where user_id='${memberId}'`);

test.beforeAll(() => {
  switches(true);
  sql(`update public.patient_assessments set answers='${ANSWERS}'::jsonb where user_id='${memberId}'`);
  const reviewed = JSON.stringify({ reportDate: inDays(-1), laboratory: "Fictional Lab", personName: null, summary: "Fictional source", warnings: [], rows: [{ name: "LDL-C", literal: "2.1", unit: "mmol/L", reference: "< 3.0", uncertain: false, page: 1, snippet: "LDL-C 2.1 mmol/L" }] }).replaceAll("'", "''");
  sql(`insert into public.patient_reports(user_id,object_path,file_name,mime,size_bytes,state,consent_version,confirmed_at,reviewed,revision) values('${memberId}','e2e-fixture-regimen','fictional.pdf','application/pdf',1,'confirmed','e2e',now(),'${reviewed}',1)`);
});
test.afterAll(() => switches(false));


test("a doctor lands in the chat, can reach the old workspace, and publishes a saved plan from the chat", async ({ browser }) => {
  const { page: doctor } = await staffSignIn(browser, "doctor", "en");
  const { page: member } = await asPerson(browser, "regimenMember");
  const caseLoaded = () => expect.poll(() => doctor.locator('form:has(input[name="token"]) input[name="revision"]').first().inputValue()).toBe(sql(`select revision from public.patient_clinical_cases where user_id='${memberId}'`));

  await test.step("sign-in lands on the original address, in the new chat", async () => {
    await expect(doctor).toHaveURL(/\/staff\/real\/doctor-workspace$/);
    await expect(doctor.locator("[data-doctor-chat-v2]")).toBeVisible();
    await open(doctor, "/staff/real/doctor-chat-v2");
    await expect(doctor).toHaveURL(/\/staff\/real\/doctor-workspace$/);
    await expect(doctor.locator("[data-doctor-chat-v2]")).toBeVisible();
  });

  await test.step("the menu reaches the old workspace, and its brand comes back", async () => {
    await doctor.getByRole("button", { name: "Open menu" }).click();
    await doctor.getByRole("button", { name: "Old workspace" }).click();
    await expect(doctor).toHaveURL(/\/staff\/real\/doctor-workspace\/classic/);
    await expect(doctor.locator("[data-doctor-chat-v2]")).toHaveCount(0);
    await expect(doctor.locator(".doctor-chat-shell")).toBeVisible();
    await doctor.getByRole("link", { name: "Noreon", exact: true }).click();
    await expect(doctor.locator("[data-doctor-chat-v2]")).toBeVisible();
  });

  await test.step("a saved plan is prepared the existing way", async () => {
    await open(doctor, `/staff/real/members/${memberId}?locale=en`);
    const section = (s: string) => doctor.getByRole("navigation", { name: "Case sections" }).getByRole("button", { name: s }).click();
    await section("Evidence");
    await doctor.getByRole("button", { name: "Prepare clinical requirements" }).click();
    await expect(doctor.getByRole("button", { name: "Approve checked source" })).toBeVisible();
    await caseLoaded();
    await doctor.locator("form", { has: doctor.getByRole("button", { name: "Approve checked source" }) }).getByRole("checkbox").check();
    await doctor.getByRole("button", { name: "Approve checked source" }).click();
    const receipt = doctor.locator("form", { has: doctor.getByRole("button", { name: "Record checked result" }) });
    await expect(receipt).toBeVisible();
    await caseLoaded();
    await receipt.locator('input[name="rows"]').fill("1");
    await receipt.locator('textarea[name="note"]').fill("The LDL row satisfies the lipid panel in this fictional journey.");
    await receipt.getByRole("checkbox").check();
    await receipt.getByRole("button", { name: "Record checked result" }).click();
    await expect.poll(() => sql(`select review#>'{receipts,lipid-panel}' is not null from public.patient_clinical_cases where user_id='${memberId}'`)).toBe("t");
    await section("Treatment plan");
    const choice = doctor.getByRole("combobox", { name: /Decision/ });
    await caseLoaded();
    await choice.click();
    await doctor.getByRole("option", { name: "Consultation not required" }).click();
    const decision = doctor.locator("form", { has: doctor.getByRole("button", { name: "Save consultation decision" }) });
    await decision.locator("textarea").first().fill("Routine fictional result.");
    await decision.getByRole("button", { name: "Save consultation decision" }).click();
    await expect.poll(() => sql(`select review->'consultation'->>'decision' from public.patient_clinical_cases where user_id='${memberId}'`)).toBe("not-required");
    await doctor.reload();
    await section("Treatment plan");
    await caseLoaded();
    const time = sql(`select to_char(now() at time zone 'Asia/Yerevan','HH24:MI')`);
    await doctor.locator('textarea[name="explanation"]').fill("Fictional explanation of this plan.");
    await doctor.getByRole("textbox", { name: "Care instructions" }).fill("Keep walking every day.");
    await doctor.getByRole("button", { name: "Add a medicine" }).click();
    const row = doctor.getByRole("group", { name: "Medicine 1" });
    await row.getByRole("combobox", { name: "Medicine name" }).fill("Fictional statin");
    await row.getByRole("textbox", { name: "Dose" }).fill("20 mg");
    await row.getByRole("textbox", { name: "Times, separated by commas" }).fill(time);
    await doctor.getByRole("button", { name: "Save private draft" }).click();
    await expect.poll(() => sql(`select count(*) from public.patient_clinical_cases where user_id='${memberId}' and draft_saved_at is not null`)).toBe("1");
    await expect(doctor.getByRole("button", { name: "Save private draft" })).toBeDisabled();
    await doctor.waitForLoadState("networkidle");
  });

  await test.step("the doctor opens the member in the chat and publishes", async () => {
    await open(doctor, "/staff/real/doctor-workspace?locale=en");
    const url = doctor.url();
    const box = doctor.getByRole("textbox", { name: "Your message" });
    await box.fill(name);
    await doctor.getByRole("button", { name: "Send" }).click();
    await expect(doctor.getByRole("heading", { name })).toBeVisible();
    await doctor.getByRole("button", { name: "Care plan" }).click();
    await expect(doctor.getByText(`Review ${name}'s plan`)).toBeVisible();
    const plan = doctor.locator(`[data-plan-member="${memberId}"]`);
    await expect(plan).toContainText("Fictional statin");
    await expect(plan.getByRole("button", { name: "Approve and publish this plan" })).toBeDisabled();
    await plan.getByRole("checkbox").last().check();
    await plan.getByRole("button", { name: "Approve and publish this plan" }).click();
    await expect.poll(versions).toBe("1");
    await expect(doctor.getByText("Plan approved and published")).toBeVisible();
    await expect(doctor.locator('[data-decision="regimen"]')).toHaveCount(0);
    await expect(doctor.getByRole("button", { name: "Check again" })).toHaveCount(0);
    expect(doctor.url()).toBe(url);
    await doctor.screenshot({ path: "e2e/.state/doctor-chat-plan-published.png" });
  });

  await test.step("the member sees the published plan", async () => {
    await open(member, "/patient/care");
    await expect(member.locator("main")).toContainText("Fictional statin");
  });
});
