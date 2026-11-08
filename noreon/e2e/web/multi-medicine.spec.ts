import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { accounts, asPerson, expect, open, openZoe, sql, staffSignIn, test } from "../fixtures";

const memberId = accounts.regimenMember.id;
// The fixture answers, changed so that the plan is a single lab test (no hypertension, normal waist and weight).
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

// The name field offers the fixed medicine list (a datalist), so it is a combobox, not a plain textbox.
async function addMedicine(doctor: Page, index: number, name: string, dose: string, times: string) {
  await doctor.getByRole("button", { name: "Add a medicine" }).click();
  const row = doctor.getByRole("group", { name: `Medicine ${index}` });
  await row.getByRole("combobox", { name: "Medicine name" }).fill(name);
  await row.getByRole("textbox", { name: "Dose" }).fill(dose);
  await row.getByRole("textbox", { name: "Times, separated by commas" }).fill(times);
}

test("a doctor's regimen from draft to the member, and a new version keeps what it should", async ({ browser }) => {
  const { page: doctor } = await staffSignIn(browser, "doctor", "en");
  const { page: member } = await asPerson(browser, "regimenMember");
  await open(doctor, `/staff/real/members/${memberId}?locale=en`);
  const section = (name: string) => doctor.getByRole("navigation", { name: "Case sections" }).getByRole("button", { name }).click();
  const caseLoaded = () => expect.poll(() => doctor.locator('form:has(input[name="token"]) input[name="revision"]').first().inputValue()).toBe(sql(`select revision from public.patient_clinical_cases where user_id='${memberId}'`));
  const save = async () => {
    const before = sql(`select revision from public.patient_clinical_cases where user_id='${memberId}'`);
    await doctor.getByRole("button", { name: "Save private draft" }).click();
    await expect.poll(() => sql(`select revision from public.patient_clinical_cases where user_id='${memberId}'`)).not.toBe(before);
    await caseLoaded();
  };

  await test.step("doctor reviews the evidence", async () => {
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
    await expect(choice).toContainText("Consultation not required");
    const decision = doctor.locator("form", { has: doctor.getByRole("button", { name: "Save consultation decision" }) });
    await decision.locator("textarea").first().fill("Routine fictional result.");
    await decision.getByRole("button", { name: "Save consultation decision" }).click();
    await expect.poll(() => sql(`select review->'consultation'->>'decision' from public.patient_clinical_cases where user_id='${memberId}'`)).toBe("not-required");
    await doctor.reload();
    await section("Treatment plan");
    await caseLoaded();
  });

  const time = sql(`select to_char(now() at time zone 'Asia/Yerevan','HH24:MI')`);
  await test.step("the editor starts empty and refuses an incomplete medicine", async () => {
    await expect(doctor.getByRole("group", { name: "Medicine 1" })).toHaveCount(0);
    await doctor.locator('textarea[name="explanation"]').fill("Fictional explanation of this plan.");
    await doctor.getByRole("textbox", { name: "Care instructions" }).fill("Keep walking every day.");
    await addMedicine(doctor, 1, "Fictional statin", "", time);
    await doctor.getByRole("button", { name: "Save private draft" }).click();
    await expect(doctor.getByRole("alert").filter({ hasText: "Add the dose of every medicine." })).toBeVisible();
    await doctor.getByRole("group", { name: "Medicine 1" }).getByRole("textbox", { name: "Dose" }).fill("20 mg");
    await save();
    await open(member, "/patient/care");
    await expect(member.locator("main")).not.toContainText("Fictional statin");
  });

  await test.step("publishing asks for the doctor's own approval, and version 1 reaches the member", async () => {
    await open(doctor, `/staff/real/members/${memberId}?locale=en`);
    await section("Treatment plan");
    const approval = doctor.getByRole("region", { name: "Medicines to approve" });
    await expect(approval).toContainText("Fictional statin");
    await expect(approval.getByRole("checkbox")).not.toBeChecked();
    await caseLoaded();
    await approval.getByRole("checkbox").check();
    await doctor.getByRole("button", { name: "Publish reviewed care plan" }).click();
    await expect.poll(versions).toBe("1");
    await open(member, "/patient/care");
    await expect(member.locator("main")).toContainText("Fictional statin");
    await expect(member.getByText("Changes to your medicines")).toHaveCount(0);
  });

  await test.step("adding a medicine keeps the first; the doctor sees the change first", async () => {
    await open(doctor, `/staff/real/members/${memberId}?locale=en`);
    await section("Treatment plan");
    await caseLoaded();
    await expect(doctor.getByRole("group", { name: "Medicine 1" }).getByRole("combobox", { name: "Medicine name" })).toHaveValue("Fictional statin");
    await addMedicine(doctor, 2, "Fictional add-on", "10 mg", time);
    await save();
    const approval = doctor.getByRole("region", { name: "Medicines to approve" });
    await expect(approval.locator('[data-change="started"]')).toHaveText(new RegExp(`Started: Fictional add-on, 10 mg, at ${time}`));
    await expect(approval.locator('[data-change="stopped"]')).toHaveCount(0);
    await approval.getByRole("checkbox").check();
    await doctor.locator('textarea[name="changeSummary"]').fill("Fictional second medicine added.");
    await doctor.getByRole("button", { name: "Publish reviewed care plan" }).click();
    await expect.poll(versions).toBe("2");
    expect(links(activePlan())).toBe("Fictional add-on 10 mg, Fictional statin 20 mg");
  });

  await test.step("the member sees the whole plan and what changed, in the app and the card", async () => {
    await open(member, "/patient/care");
    const main = member.locator("main");
    await expect(main.locator('[data-change="started"]')).toContainText("Fictional add-on");
    await member.getByRole("tab", { name: "Medicines" }).click();
    const list = member.locator("#medicines");
    await expect(list).toContainText("Fictional statin");
    await expect(list).toContainText("Fictional add-on");
    await expect.poll(() => member.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await member.screenshot({ path: test.info().outputPath("member-plan.png"), fullPage: true });
  });

  await test.step("each medicine logs its own dose", async () => {
    // A dose is due after its order took effect; the fixture moves the orders back behind the immutability trigger.
    sql(`set session_replication_role=replica;update public.patient_care_medications set effective_at=now()-interval '1 hour' where user_id='${memberId}';update public.patient_care_plans set published_at=now()-interval '1 day' where user_id='${memberId}' and not active;`);
    await open(member, "/patient/care");
    await member.getByRole("tab", { name: "Medicines" }).click();
    const dose = member.locator("#medicines");
    for (const name of ["Fictional statin", "Fictional add-on"]) {
      const card = dose.locator("article", { hasText: name });
      await card.getByRole("button", { name: "Mark as taken", exact: true }).click();
      await expect(card.getByRole("status").first()).toHaveText("Saved as your report.");
    }
    await expect.poll(() => sql(`select count(distinct medication_id) from public.patient_dose_events where user_id='${memberId}' and status='taken'`)).toBe("2");
  });

  await test.step("the chat cards hold the whole regimen", async () => {
    await openZoe(member);
    await member.locator('[data-zoe-card-chip="plan"]').click();
    const plan = member.locator('[data-zoe-card="plan"]').last();
    await expect(plan).toContainText("Fictional statin");
    await expect(plan).toContainText("Fictional add-on");
    await member.locator('[data-zoe-card-chip="dose"]').click();
    const dose = member.locator('[data-zoe-card="dose"]').last();
    await expect(dose).toContainText("Fictional statin");
    await expect(dose).toContainText("Fictional add-on");
  });

  await test.step("a stale tab cannot approve what it no longer shows", async () => {
    await open(doctor, `/staff/real/members/${memberId}?locale=en`);
    await section("Treatment plan");
    await caseLoaded();
    const stale = await doctor.context().newPage();
    await open(stale, `/staff/real/members/${memberId}?locale=en`);
    await stale.getByRole("navigation", { name: "Case sections" }).getByRole("button", { name: "Treatment plan" }).click();
    await expect(stale.getByRole("region", { name: "Medicines to approve" })).toContainText("Fictional statin");
    await doctor.getByRole("group", { name: "Medicine 1" }).getByRole("textbox", { name: "Dose" }).fill("40 mg");
    await doctor.getByRole("group", { name: "Medicine 2" }).getByRole("button", { name: "Remove this medicine" }).click();
    await save();
    const approval = stale.getByRole("region", { name: "Medicines to approve" });
    await approval.getByRole("checkbox").check();
    await stale.locator('textarea[name="changeSummary"]').fill("Fictional stale approval.");
    await stale.getByRole("button", { name: "Publish reviewed care plan" }).click();
    await expect(stale.getByRole("alert").first()).toBeVisible();
    expect(versions()).toBe("2");
    await stale.close();
  });

  await test.step("a titration step and a stop are shown to the doctor, then to the member; version 2 does not move", async () => {
    const before = activePlan();
    const approval = doctor.getByRole("region", { name: "Medicines to approve" });
    await expect(approval.locator('[data-change="dose_changed"]')).toHaveText("Dose changed: Fictional statin, from 20 mg to 40 mg");
    await expect(approval.locator('[data-change="stopped"]')).toHaveText("Stopped: Fictional add-on, 10 mg");
    await approval.screenshot({ path: test.info().outputPath("doctor-approval.png") });
    await approval.getByRole("checkbox").check();
    await doctor.locator('textarea[name="changeSummary"]').fill("Fictional dose step.");
    await doctor.getByRole("button", { name: "Publish reviewed care plan" }).click();
    await expect.poll(versions).toBe("3");
    expect(links(activePlan())).toBe("Fictional statin 40 mg");
    expect(links(before)).toBe("Fictional add-on 10 mg, Fictional statin 20 mg");
    await open(member, "/patient/care");
    const main = member.locator("main");
    await expect(main.locator('[data-change="dose_changed"]')).toContainText("from 20 mg to 40 mg");
    await expect(main.locator('[data-change="stopped"]')).toContainText("Fictional add-on");
    await open(doctor, `/staff/real/members/${memberId}?locale=en`);
    await section("History");
    await expect(doctor.getByText("Version 3")).toBeVisible();
    await expect(doctor.locator('[data-change="dose_changed"]')).toHaveCount(1);
    await expect(doctor.locator('[data-change="started"]')).toHaveCount(1);
  });

  await test.step("switched off, the old form shows the regimen and cannot overwrite it", async () => {
    sql("update public.multi_medicine_capabilities set enabled=false;");
    await open(doctor, `/staff/real/members/${memberId}?locale=en`);
    await section("Treatment plan");
    await expect(doctor.getByText("This draft has several-medicine entries")).toBeVisible();
    await expect(doctor.getByRole("button", { name: "Save private draft" })).toBeDisabled();
    await open(member, "/patient/care");
    await member.getByRole("tab", { name: "Medicines" }).click();
    await expect(member.locator("#medicines")).toContainText("Fictional statin");
    sql("update public.multi_medicine_capabilities set enabled=true;");
  });
});
