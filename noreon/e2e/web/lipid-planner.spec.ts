import { expect, test, accounts, asPerson, desktop, open, phone, sql, staffSignIn } from "../fixtures";

const member = accounts.previewEn;
const doctorId = accounts.doctor.id;
const plan = "Lipid follow-up plan";
const counts = () => sql(`select (select count(*) from public.ldl_goals),(select count(*) from public.ldl_retests),(select count(*) from public.ldl_responses),(select count(*) from public.patient_test_requests where user_id='${member.id}')`);

test("the doctor's lipid plan is dark, read-only and says it is proposed", async ({ browser }) => {
  // Prerequisites only: a heart attack, a statin started 3 weeks ago, a goal, and a reviewed LDL at exactly half the baseline.
  sql(`insert into public.ldl_index_events(member_id,submission_id,event_type,event_on,source,recorded_by) values('${member.id}',gen_random_uuid(),'acs_mi',current_date-21,'document','${doctorId}');
    insert into public.ldl_lipid_therapies(member_id,submission_id,drug,dose,started_on,recorded_by) values('${member.id}',gen_random_uuid(),'atorvastatin','40 mg',current_date-21,'${doctorId}');
    insert into public.ldl_goals(member_id,version,submission_id,category,threshold_mmol,reduction_rule,reduction_pct,baseline_kind,baseline_mmol,baseline_on,baseline_source,defaults_version,set_by) values('${member.id}',1,gen_random_uuid(),'very_high',1.4,true,50,'pre_treatment',3.8,current_date-60,'document','ldl-defaults-2026-10-29','${doctorId}');
    insert into public.patient_care_results(user_id,marker,value,unit,collected_at,received_at,source,source_label,reviewed_at,reviewed_by) values('${member.id}','LDL-C',1.9,'mmol/L',now()-interval '2 days',now()-interval '1 day','laboratory','Fictional lab',now(),'Dr Fictional Hayk');`);
  const { page: doctor } = await staffSignIn(browser, "doctor", "en", desktop);
  try {
    await test.step("off: the LDL record shows and the plan does not", async () => {
      await open(doctor, `/staff/real/members/${member.id}?locale=en`);
      await expect(doctor.getByRole("heading", { name: "LDL goal" })).toBeVisible();
      await expect(doctor.getByRole("heading", { name: plan })).toHaveCount(0);
    });

    const before = counts();
    sql(`update public.ldl_goal_settings set lipid_planner_enabled=true where singleton;`);

    await test.step("on: dates, both parts of the goal, the gaps, and that the rules are proposed", async () => {
      await doctor.reload();
      const card = doctor.locator("section", { has: doctor.getByRole("heading", { name: plan, exact: true }) });
      await expect(card).toContainText("Proposed rules, not signed by Armen and Yesayi");
      await expect(card).toContainText("lipid-rules-2026-10-30");
      await expect(card).toContainText("Lipid test");
      await expect(card).toContainText("Scheduled");
      await expect(card).toContainText("1.9 mmol/L · below 1.4");
      await expect(card).toContainText("Reduction from pre-treatment LDL: 50%");
      await expect(card.getByText("Not met").first()).toBeVisible();
      await expect(card.getByText("Met", { exact: true }).first()).toBeVisible();
      await expect(card).toContainText("No reviewed CK from before the first therapy");
      await expect(card).toContainText("No reviewed Lp(a) on record");
      await expect(card.locator("form, button, input")).toHaveCount(0);
      await card.getByText("Rules checked").click();
      await expect(card.getByText("LR-01")).toBeVisible();
      await expect(card.getByText("ESC/EAS 2019 §9.5 · ESC/EAS 2025 update")).toBeVisible();
    });

    await test.step("reading it changes nothing and reaches no one", async () => {
      expect(counts()).toBe(before);
      expect(sql(`select count(*) from public.access_audit where member_id='${member.id}' and surface='ldl_goal' and object_id='lipid_planner'`)).not.toBe("0");
      const { page: self } = await asPerson(browser, "previewEn", phone);
      await open(self, "/patient/progress");
      await expect(self.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(self.getByText(plan)).toHaveCount(0);
      await expect(self.getByText("Proposed rules")).toHaveCount(0);
    });

    await test.step("in Doctor Zoe the plan arrives as a card with the LDL record", async () => {
      sql(`update public.staff_zoe_settings set staff_zoe_enabled=true where singleton;`);
      await open(doctor, "/staff/real/zoe?locale=en");
      await doctor.locator("#zoe-find").fill("Fictional previewEn");
      await doctor.locator("#zoe-find").press("Enter");
      await doctor.getByRole("list", { name: "Matching members" }).getByRole("button").first().click();
      await expect(doctor.getByTestId("zoe-member")).toContainText("Fictional previewEn");
      // CI's first ask took 36.4s to compile. Give the route the navigation budget,
      // then keep the normal assertion window for the actual streamed cards.
      const response = doctor.waitForResponse(r => new URL(r.url()).pathname === "/staff/real/zoe/ask" && r.request().method() === "POST", { timeout: 120_000 });
      await doctor.getByRole("button", { name: "LDL goal" }).click();
      expect((await response).status()).toBe(200);
      const card = doctor.getByTestId("zoe-card-lipid_plan").first();
      await expect(card).toContainText("Proposed rules, not signed by Armen and Yesayi", { timeout: 30_000 });
      await expect(card).toContainText("Lipid test");
      await expect(doctor.getByTestId("zoe-card-ldl").first()).toBeVisible();
    });
  } finally {
    sql(`update public.ldl_goal_settings set lipid_planner_enabled=false where singleton; update public.staff_zoe_settings set staff_zoe_enabled=false where singleton;`);
  }
});
