import { devices } from "@playwright/test";
import { expect, test, accounts, asPerson, open, sql, staffSignIn } from "../fixtures";

// Uncontrolled hypertension with a raised waist: 150/95 and 110 cm. Each phone has its own fictional member, because a
// publication happens once. Laboratory receipts are seeded (member-care.spec.ts walks those); the four clinic and home
// tests go through the screens, each confirmed by the assigned doctor.
const phones = [
  ["iphone-15", { ...devices["iPhone 15"], defaultBrowserType: undefined }, "evidenceIphone"],
  ["galaxy-s8", { ...devices["Galaxy S8"], defaultBrowserType: undefined }, "evidenceGalaxy"],
] as const;
const PLAN = "Fictional plan for raised blood pressure.";
const FINDING = "Fictional left ventricular strain pattern";

function prerequisites(member: string, doctor: string, nurse: string) {
  const answer = (key: string, value: number) => `jsonb_set(%s,'{${key},value}','${value}')`;
  const answers = ["q5.last_reading.systolic", 150, "q5.last_reading.diastolic", 95, "q2.waist", 110] as const;
  let edited = "answers";
  for (let i = 0; i < answers.length; i += 2) edited = answer(String(answers[i]), Number(answers[i + 1])).replace("%s", edited);
  const reviewed = JSON.stringify({ reportDate: new Date().toISOString().slice(0, 10), laboratory: "Fictional Lab", personName: null, summary: "Fictional source", warnings: [], rows: [{ name: "LDL-C", literal: "2.1", unit: "mmol/L", reference: "< 3.0", uncertain: false, page: 1, snippet: "LDL-C 2.1" }] });
  sql(`begin;
set local session_replication_role=replica;
update public.patient_assessments set answers=${edited},completed_at=now()-interval '10 days',assessment_date=current_date-10 where user_id='${member}';
update public.patient_clinical_cases set assigned_nurse_id='${nurse}' where user_id='${member}';
insert into public.patient_reports(user_id,object_path,file_name,mime,size_bytes,state,consent_version,confirmed_at,reviewed,revision) values('${member}','e2e-evidence-${member}','fictional.pdf','application/pdf',1,'confirmed','e2e',now(),'${reviewed}',1);
with m as(insert into public.patient_measurements(user_id,submission_id,systolic,diastolic,pulse,measured_at)values('${member}',gen_random_uuid(),148,92,72,now()-interval '2 days')returning id)
 insert into public.staff_care_notes(patient_case_id,actor_id,actor_name,actor_role,kind,note,detail)select '${member}','${nurse}','Nurse Fictional Ani','nurse','measurement','Blood pressure measurement recorded',jsonb_build_object('measurementId',m.id)from m;
with w as(insert into public.bp_weeks(member_id,starts_on,started_by,started_by_role)values('${member}',current_date-8,'${nurse}','nurse')returning id),
 m as(insert into public.patient_measurements(user_id,submission_id,systolic,diastolic,pulse,measured_at)values('${member}',gen_random_uuid(),142,88,66,now()-interval '8 days')returning id)
 insert into public.bp_week_readings(measurement_id,week_id,member_id,day,slot)select m.id,w.id,'${member}',1,'morning'from m,w;
with v as(insert into public.patient_care_visits(id,user_id,actor_id,actor_name,actor_role,clinic_id)values(gen_random_uuid(),'${member}','${nurse}','Nurse Fictional Ani','nurse',(select clinic_id from public.workspace_staff where user_id='${nurse}'))returning id,clinic_id)
 insert into public.patient_care_visit_entries(user_id,visit_id,submission_id,position,payload,observed_at,observed_instant,actor_id,actor_name,actor_role,clinic_id)
 select '${member}',v.id,gen_random_uuid(),x.p,jsonb_build_object('kind','observation','field',x.f,'observedAt',t.s,'state','known','value',x.n,'unit',x.u),t.s,t.s::timestamptz,'${nurse}','Nurse Fictional Ani','nurse',v.clinic_id
 from v,(select to_char((now()-interval '3 days')at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')s)t,(values(1,'weight',82,'kg'),(2,'waist',110,'cm'))x(p,f,n,u);
commit;`);
}

for (const [name, phone, who] of phones) {
  test(`${name}: an uncontrolled hypertension plan publishes once the doctor confirms each requirement`, async ({ browser }) => {
    const member = accounts[who].id, doctorId = accounts.doctor.id;
    prerequisites(member, doctorId, accounts.nurse.id);
    const { page } = await staffSignIn(browser, "doctor", "en", phone);
    const caseLoaded = () => expect.poll(() => page.locator('form:has(input[name="token"]) input[name="revision"]').first().inputValue()).toBe(sql(`select revision from public.patient_clinical_cases where user_id='${member}'`));
    const confirmed = (test: string) => sql(`select review#>'{evidenceReceipts,${test}}' is not null from public.patient_clinical_cases where user_id='${member}'`);
    const section = (label: string) => page.getByRole("button", { name: label, exact: true }).click();
    await open(page, `/staff/real/members/${member}?locale=en`);
    await section("Evidence");
    await page.getByRole("button", { name: "Prepare clinical requirements" }).click();
    await expect(page.getByText("Record 12-lead ECG")).toBeVisible();
    // Everything the doctor would have done for laboratory results, and a review old enough for a consultation to follow it.
    sql(`update public.patient_clinical_cases c set review=review||jsonb_build_object('preparedAt',now()-interval '1 hour',
      'approvals',(select jsonb_object_agg(r.id,jsonb_build_object('revision',1,'actorId','${doctorId}','at',now()))from public.patient_reports r where r.user_id=c.user_id),
      'receipts',(select jsonb_object_agg(t->>'id',jsonb_build_object('reportId',(select id from public.patient_reports r where r.user_id=c.user_id),'reportRevision',1,'rows','[0]'::jsonb,'note','Fictional','actorId','${doctorId}','at',now()))
       from jsonb_array_elements(c.review#>'{engine,tests}')t where t->>'method'='lab'))where user_id='${member}'`);
    await page.reload();
    await section("Treatment plan");
    await expect(page.getByText(/Publishing is blocked: .*12-lead ECG.* not confirmed yet/).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Publish reviewed care plan" })).toBeDisabled();
    await section("Evidence");
    await caseLoaded();

    const record = page.locator('form:has(input[name="performedOn"]):has(input[value="ecg-12-lead"])');
    await record.locator('input[name="performedOn"]').fill(new Date().toISOString().slice(0, 10));
    await record.getByRole("radio", { name: "Abnormal" }).check();
    await record.locator('textarea[name="finding"]').fill(FINDING);
    await record.locator('input[name="source"]').fill("Fictional Clinic North, read by Dr Fictional Other");
    await record.locator('input[name="sourceChecked"]').check();
    await record.getByRole("button", { name: "Save and confirm" }).click();
    await expect.poll(() => confirmed("ecg-12-lead")).toBe("t");

    for (const test of ["bp-home-log", "bp-visit", "anthropometry"]) {
      await page.reload();
      await section("Evidence");
      await caseLoaded();
      const form = page.locator(`form:has(input[name="testId"][value="${test}"])`);
      await form.locator('input[name="sourceChecked"]').check();
      await form.getByRole("button", { name: "Confirm for this requirement" }).click();
      await expect.poll(() => confirmed(test), test).toBe("t");
    }
    await page.reload();
    await section("Evidence");
    await expect(page.getByText(FINDING)).toBeVisible();
    await expect(page.getByText("Publication is blocked")).toHaveCount(0);

    await section("Treatment plan");
    await caseLoaded();
    const choice = page.getByRole("combobox", { name: /Decision/ });
    await choice.click();
    await page.getByRole("option", { name: "Consultation required" }).click();
    const decision = page.locator("form", { has: page.getByRole("button", { name: "Save consultation decision" }) });
    await decision.locator("textarea").first().fill("Fictional abnormal ECG.");
    await decision.getByRole("button", { name: "Save consultation decision" }).click();
    await expect.poll(() => sql(`select review#>>'{consultation,decision}' from public.patient_clinical_cases where user_id='${member}'`)).toBe("required");
    await page.reload();
    await section("Treatment plan");
    await caseLoaded();
    const complete = page.locator("form", { has: page.getByRole("button", { name: "Record completed consultation" }) });
    const now = new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 16);
    await complete.locator('input[name="completedAtLocal"]').fill(now);
    await complete.getByRole("combobox").click();
    await page.getByRole("option", { name: "Phone" }).click();
    await complete.locator("textarea").first().fill("Fictional talk about the ECG.");
    await complete.getByRole("button", { name: "Record completed consultation" }).click();
    await expect.poll(() => sql(`select review#>'{consultation,completedAt}' is not null from public.patient_clinical_cases where user_id='${member}'`)).toBe("t");
    await page.reload();
    await section("Treatment plan");
    await caseLoaded();
    await page.locator('textarea[name="explanation"]').fill(PLAN);
    await page.getByRole("textbox", { name: "Care instructions" }).fill("Keep measuring.");
    await page.getByRole("button", { name: "Save private draft" }).click();
    await expect.poll(() => sql(`select count(*) from public.patient_clinical_cases where user_id='${member}' and draft_saved_at is not null`)).toBe("1");
    await caseLoaded();
    await page.getByRole("button", { name: "Publish reviewed care plan" }).click();
    await expect.poll(() => sql(`select count(*) from public.patient_care_plans where user_id='${member}' and published_at is not null`)).toBe("1");

    const { page: memberPage } = await asPerson(browser, who, phone);
    await open(memberPage, "/patient/care");
    await expect(memberPage.locator("main")).toContainText(PLAN);
    await open(memberPage, "/patient/results");
    await expect(memberPage.locator("main")).not.toContainText(FINDING);
    expect(sql(`select count(*) from public.patient_care_tests where user_id='${member}' and title in('12-lead ECG','7-day home blood pressure log')`)).toBe("0");
  });
}
