import { createClient } from "@supabase/supabase-js";
import { expect, test, accounts, asPerson, desktop, env, open, phone, sql, staffSignIn } from "../fixtures";

const memberA = accounts.otherMember.id;

async function client(who: string) {
  const c = createClient(env.api, env.anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await c.auth.signInWithPassword({ email: accounts[who].email, password: accounts[who].password });
  if (error) throw error;
  return c;
}

test("a nurse works on an assigned member but cannot publish or set an LDL goal", async ({ browser }) => {
  const { page } = await staffSignIn(browser, "nurse", "en", desktop);
  await open(page, `/staff/real/members/${memberA}?locale=en`);
  await expect(page.getByText("Fictional otherMember").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Evidence" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Treatment plan" })).toHaveCount(0);
  await expect(page.getByText("LDL goal", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Publish reviewed care plan" })).toHaveCount(0);

  await page.getByRole("button", { name: "Start new visit" }).click();
  await expect.poll(() => sql(`select count(*) from public.patient_care_visits where user_id='${memberA}'`)).toBe("1");

  const nurse = await client("nurse");
  const command = { version: "ldl-goal-v1", memberId: memberA, submissionId: crypto.randomUUID(), expectedVersion: 0, category: "very_high", thresholdMmol: 1.4, reductionRule: false, reductionPct: null, baselineKind: "unknown", baselineMmol: null, baselineOn: null, baselineSource: null, nextTestOn: null, reason: "Fictional reason", defaultsVersion: "ldl-defaults-2026-10-29" };
  const refused = await nurse.rpc("doctor_ldl_goal_set", { p_command: command });
  expect(refused.error?.code ?? refused.data?.status, "the database refuses a nurse").toMatch(/42501|access/);
  expect(sql(`select count(*) from public.ldl_goals where member_id='${memberA}'`)).toBe("0");
  // The same command from the assigned doctor goes through, so the refusal above is about the role.
  const doctor = await client("doctor");
  const accepted = await doctor.rpc("doctor_ldl_goal_set", { p_command: command });
  expect(accepted.error).toBeNull();
  expect(sql(`select count(*) from public.ldl_goals where member_id='${memberA}'`)).toBe("1");
});

test("a treated hypertension member's ECG has a way in, not a publication block", async ({ browser }) => {
  // The full journey is required-evidence.spec.ts. This pins the warning's removal for the test that recorded the gap.
  const { page } = await staffSignIn(browser, "doctor", "en", desktop);
  await open(page, `/staff/real/members/${accounts.zoeEn.id}?locale=en`);
  await page.getByRole("button", { name: "Evidence" }).click();
  await page.getByRole("button", { name: "Prepare clinical requirements" }).click();
  await expect(page.getByText("12-lead ECG").first()).toBeVisible();
  await expect(page.getByText("Record 12-lead ECG")).toBeVisible();
  await expect(page.getByText("Publication is blocked")).toHaveCount(0);
});

test("staff without access are refused by the database, not only by the page", async () => {
  const args = { p_user_id: memberA, p_actor: accounts.doctor.id, p_expected_revision: 0, p_evidence_token: "e2e", p_engine: {}, p_request_id: crypto.randomUUID() };
  for (const who of ["nurse", "otherDoctor"]) {
    const staff = await client(who);
    const published = await staff.rpc("publish_patient_clinical_plan", args);
    expect(published.error?.code, `${who} publishing`).toBe("42501");
  }
  expect(sql(`select count(*) from public.patient_care_plans where user_id='${memberA}'`)).toBe("0");
  // Read access, with the assigned doctor as the control.
  const other = await (await client("otherDoctor")).rpc("patient_clinical_case_snapshot", { p_user_id: memberA });
  expect(other.data, "an unassigned doctor reads nothing").toBeNull();
  const assigned = await (await client("doctor")).rpc("patient_clinical_case_snapshot", { p_user_id: memberA });
  expect(assigned.error).toBeNull();
  expect(assigned.data).toBeTruthy();
});

test("a doctor who is not assigned cannot open the member", async ({ browser }) => {
  const { page } = await staffSignIn(browser, "otherDoctor", "en", desktop);
  const response = await page.goto(`${env.site}/staff/real/members/${memberA}?locale=en`);
  expect(response?.status()).toBe(404);
  await expect(page.locator("body")).not.toContainText("Fictional otherMember");
  // The assigned doctor reaches the same page, so the 404 above is about access and not a broken route.
  const { page: assigned } = await staffSignIn(browser, "doctor", "en", desktop);
  await open(assigned, `/staff/real/members/${memberA}?locale=en`);
  await expect(assigned.getByText("Fictional otherMember").first()).toBeVisible();
});

test("one member cannot read another member's readings", async ({ browser }) => {
  const stranger = await client("zoeEn");
  const taken = await stranger.from("patient_measurements").select("id").eq("user_id", memberA);
  expect(taken.data ?? []).toEqual([]);
  const owner = await client("otherMember");
  expect((await owner.from("patient_measurements").select("systolic").eq("user_id", memberA)).data).toEqual([{ systolic: 131 }]);
  const { page } = await asPerson(browser, "zoeEn", phone);
  await open(page, "/patient/measurements");
  await expect(page.locator("main")).not.toContainText("131");
});
