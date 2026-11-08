import { readFileSync } from "node:fs";
import { expect, hydrated, test, SIGNUP_CODE, SIGNUP_PHONE, accounts, isolated, open, phone, sql, staffSignIn } from "../fixtures";

// Aged 52 and male, to match the fixture answers.
const PLAN = "Fictional plan for this journey, your cholesterol result is in range.";
const inDays = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const born = new Date();
born.setFullYear(born.getFullYear() - 52);
born.setMonth(born.getMonth() - 1);
const BIRTH = `${String(born.getDate()).padStart(2, "0")}/${String(born.getMonth() + 1).padStart(2, "0")}/${born.getFullYear()}`;
// The fixture answers, changed so that the plan is a single lab test (no hypertension, normal waist and weight).
const fixture = JSON.parse(readFileSync("scripts/fixtures/patient-answers.json", "utf8"));
for (const [id, value] of Object.entries({ "q5.diagnosed": "no", "q5.last_reading.systolic": 118, "q5.last_reading.diastolic": 76, "q2.waist": 80, "q2.weight": 70 })) fixture[id].value = value;
const ANSWERS = JSON.stringify(fixture).replaceAll("'", "''");

test("sign-up to published plan across roles", async ({ browser }) => {
  // One long journey across three roles; on a busy CI server each first page of the dev server compiles for a long while.
  test.setTimeout(900_000);
  const context = await browser.newContext(phone);
  await isolated(context);
  const member = await context.newPage();

  await test.step("wrong code is refused, the right code signs in", async () => {
    await open(member, "/patient?locale=hy");
    await member.locator("input").first().fill(SIGNUP_PHONE);
    await member.getByRole("button", { name: "Ուղարկել կոդը" }).click();
    const code = member.locator("input").first();
    await expect(member.getByText(`+374${SIGNUP_PHONE}`)).toBeVisible();
    await code.fill("000000");
    await expect(member.getByRole("alert").first()).toBeVisible();
    expect(sql(`select count(*) from public.profiles p join auth.users u on u.id=p.id where u.phone='374${SIGNUP_PHONE}' and p.display_name is not null`)).toBe("0");
    await code.fill(SIGNUP_CODE);
    // OTP ends in a full load of Home, whose registration guard sends a new member
    // to profile. Use the navigation budget for that chain, including cold dev compilation.
    await member.waitForURL(/patient\/profile/, { waitUntil: "domcontentloaded" });
    await expect(member).toHaveURL(/patient\/profile/);
  });
  await test.step("details, consent and first answer survive a reload", async () => {
    // Wait for hydration, then open once: retrying a timed-out click can close
    // the popup that the first click already opened on a slow browser.
    const sex = member.locator("#patient-sex");
    await expect.poll(() => sex.evaluate((el) => Object.keys(el).some((key) => key.startsWith("__reactProps")))).toBe(true);
    await sex.click();
    await member.getByRole("option", { name: "Արական" }).click();
    await expect(sex).toContainText("Արական");
    await member.locator("#patient-name").fill("Fictional Signup");
    await member.locator("#birth-date").fill(BIRTH);
    await member.locator("#birth-date").blur();
    await member.getByRole("button", { name: "Շարունակել" }).click();
    await member.getByRole("checkbox").first().check();
    await member.getByRole("button", { name: /Համաձայն/ }).first().click();
    // Saving the consent ends on /patient/ready, which the dev server compiles on first use; the button shows "saving" meanwhile.
    await expect(member).toHaveURL(/patient\/ready/, { timeout: 120_000 });
    await open(member, "/patient/questions?start=1");
    // Advancing is optimistic. Include the first save reply if persistence fails, without
    // logging answers. A transient failure may still recover through the app's save queue.
    // This is the first answers request in next dev; give its cold compilation
    // the same budget as the suite's first navigation and first doctor ask.
    const saving = member.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/patient/answers", { timeout: 120_000 });
    await member.getByRole("button", { name: "Կարծում եմ՝ նորմալ է" }).click();
    await expect(member.getByText("Կարծում եմ՝ նորմալ է")).toBeHidden();
    const response = await saving;
    const result = await response.json().catch(() => null);
    const firstReply = { status: response.status(), ok: result?.ok, reason: result?.reason, accountChanged: response.headers()["x-noreon-account-changed"] };
    const saved = `select count(*) from public.patient_assessments a join auth.users u on u.id=a.user_id where u.phone='374${SIGNUP_PHONE}' and a.answers#>>'{q2.weight_perception,value}'='ok'`;
    await expect.poll(() => sql(saved), { message: `First answer must be stored; first save reply: ${JSON.stringify(firstReply)}` }).toBe("1");
    await member.reload();
    await expect(member.getByText("Կարծում եմ՝ նորմալ է")).toBeHidden();
  });
  await test.step("the rest of the answers, then completion in the app", async () => {
    sql(`update public.patient_assessments a set answers='${ANSWERS}'::jsonb || a.answers,revision=revision+1 from auth.users u where u.id=a.user_id and u.phone='374${SIGNUP_PHONE}'`);
    await open(member, "/patient/questions");
    // The saved answers are shown one screen at a time; finishing leaves the page.
    const next = member.getByRole("button", { name: /^(Շարունակել|Ավարտել հարցաշարը)$/ });
    for (let i = 0; i < 60 && member.url().includes("/patient/questions"); i++) {
      await next.click({ timeout: 5_000 }).catch(() => {});
      await member.waitForTimeout(250);
    }
    await expect(member).toHaveURL(/patient\/health\/profile/);
    await expect(member.getByText("Ձեր պատասխանները պահպանված են։")).toBeVisible();
    expect(sql(`select count(*) from public.patient_assessments a join public.patient_clinical_cases c on c.user_id=a.user_id join auth.users u on u.id=a.user_id where u.phone='374${SIGNUP_PHONE}' and a.completed_at is not null and c.assigned_doctor_id is not null`)).toBe("1");
  });
  const memberId = sql(`select id from auth.users where phone='374${SIGNUP_PHONE}'`);
  const doctorId = sql(`select assigned_doctor_id from public.patient_clinical_cases where user_id='${memberId}'`);
  const doctorName = Object.keys(accounts).find((k) => accounts[k].id === doctorId)!;
  // Staff language follows the sign-in cookie, not the member page's query string.
  const { page: doctor } = await staffSignIn(browser, doctorName, "en");
  await open(doctor, `/staff/real/members/${memberId}?locale=en`);
  const section = (name: string) => doctor.getByRole("navigation", { name: "Case sections" }).getByRole("button", { name }).click();

  // Commands carry the revision the page was rendered with, and the page refreshes itself after each one.
  const reviewHas = (path: string) => sql(`select review#>'{${path}}' is not null from public.patient_clinical_cases where user_id='${memberId}'`);
  const caseLoaded = () => expect.poll(() => doctor.locator('form:has(input[name="token"]) input[name="revision"]').first().inputValue()).toBe(sql(`select revision from public.patient_clinical_cases where user_id='${memberId}'`));

  await test.step("doctor prepares the requirements from the answers", async () => {
    await section("Evidence");
    await doctor.getByRole("button", { name: "Prepare clinical requirements" }).click();
    await expect(doctor.getByRole("button", { name: "Refresh clinical requirements" })).toBeVisible();
  });

  await test.step("member asks for a time: a request, not a booking", async () => {
    await open(member, "/patient/service");
    await expect(member.getByText("Լիպիդային պրոֆիլ և LDL-C")).toBeVisible();
    // Typing before the form hydrates is lost, and the first compile of this page can be slow.
    await hydrated(member.locator('input[name="location"]'));
    // Nothing is chosen until the member chooses (#483), so the button waits for a test.
    const send = member.getByRole("button", { name: "Ուղարկել նախընտրելի պայմանների հարցում" });
    await expect(send).toBeDisabled();
    const tests = member.getByRole("group", { name: "Առաջարկվող հետազոտությունները" }).getByRole("checkbox");
    await expect(tests).not.toHaveCount(0);
    for (const box of await tests.all()) await box.check();
    await expect(send).toBeEnabled();
    await member.locator('input[name="startsAt"]').fill(`${inDays(3)}T10:00`);
    await member.locator('input[name="location"]').fill("Fictional Clinic North");
    await send.click();
    await expect.poll(() => sql(`select status from public.patient_test_requests where user_id='${memberId}'`), { timeout: 120_000 }).toBe("requested");
  });

  await test.step("staff record the provider's terms and the member accepts", async () => {
    await open(doctor, `/staff/real/members/${memberId}?locale=en`);
    const terms = doctor.locator("details", { has: doctor.locator("button", { hasText: "Record terms for member acceptance" }) }).first();
    await terms.locator("summary").click();
    await terms.locator('input[name="startsAt"]').fill(`${inDays(3)}T10:00`);
    await terms.locator('input[name="endsAt"]').fill(`${inDays(3)}T11:00`);
    await terms.locator('input[name="location"]').fill("Fictional Clinic North");
    await terms.locator('input[name="provider"]').fill("Fictional Lab");
    await terms.locator('textarea[name="preparation"]').fill("No fasting needed.");
    await terms.locator('input[name="obtainedAt"]').fill(`${inDays(-1)}T12:00`);
    await terms.locator('[name="channel"]').first().locator("xpath=ancestor::label").getByRole("combobox").click();
    await doctor.getByRole("option", { name: "Phone" }).click();
    await terms.locator('textarea[name="source"], input[name="source"]').fill("Fictional provider call");
    await terms.getByRole("button", { name: "Record terms for member acceptance" }).click();
    await expect.poll(() => sql(`select status from public.patient_test_requests where user_id='${memberId}'`), { timeout: 120_000 }).toBe("provider-proposed");
    await open(member, "/patient/service");
    await expect(member.getByText("Fictional Lab")).toBeVisible();
    await member.getByRole("button", { name: "Ընդունել պայմանները և նախապատրաստումը" }).click();
    await expect.poll(() => sql(`select status from public.patient_test_requests where user_id='${memberId}'`), { timeout: 120_000 }).toBe("confirmed");
    await member.reload();
    await expect(member.getByText("Fictional Lab")).toBeVisible();
    await expect(member.getByRole("button", { name: "Ընդունել պայմանները և նախապատրաստումը" })).toHaveCount(0);
    const arrangement = sql(`select current_arrangement::text from public.patient_test_requests where user_id='${memberId}'`);
    for (const agreed of ["Fictional Lab", "Fictional Clinic North", "No fasting needed."]) expect(arrangement).toContain(agreed);
    const stored = (key: string) => sql(`select to_char((current_arrangement#>>'{terms,${key}}')::timestamptz at time zone 'Asia/Yerevan','YYYY-MM-DD"T"HH24:MI') from public.patient_test_requests where user_id='${memberId}'`);
    expect(stored("startsAt")).toBe(`${inDays(3)}T10:00`);
    expect(stored("endsAt")).toBe(`${inDays(3)}T11:00`);
    expect(sql(`select count(*) from public.patient_test_request_events e join public.patient_test_requests r on r.id=e.request_id where r.user_id='${memberId}' and e.operation='accept'`)).toBe("1");
  });

  await test.step("a checked result and a draft stay hidden from the member", async () => {
    const reviewed = JSON.stringify({ reportDate: inDays(-1), laboratory: "Fictional Lab", personName: null, summary: "Fictional source", warnings: [], rows: [{ name: "LDL-C", literal: "2.1", unit: "mmol/L", reference: "< 3.0", uncertain: false, page: 1, snippet: "Fictional LDL" }] });
    sql(`insert into public.patient_reports(user_id,object_path,file_name,mime,size_bytes,state,consent_version,confirmed_at,reviewed,revision) values('${memberId}','e2e-fixture','fictional.pdf','application/pdf',1,'confirmed','e2e',now(),'${reviewed}',1)`);
    await open(doctor, `/staff/real/members/${memberId}?locale=en`);
    await section("Evidence");
    // A new source report voids the earlier preparation, so the doctor prepares again.
    await doctor.getByRole("button", { name: "Prepare clinical requirements" }).click();
    await expect(doctor.getByRole("button", { name: "Approve checked source" })).toBeVisible();
    await caseLoaded();
    await doctor.locator("form", { has: doctor.getByRole("button", { name: "Approve checked source" }) }).getByRole("checkbox").check();
    await doctor.getByRole("button", { name: "Approve checked source" }).click();
    await expect.poll(() => sql(`select review->'approvals'<>'{}'::jsonb from public.patient_clinical_cases where user_id='${memberId}'`), { timeout: 120_000 }).toBe("t");
    const receipt = doctor.locator("form", { has: doctor.getByRole("button", { name: "Record checked result" }) });
    await expect(receipt).toBeVisible();
    await caseLoaded();
    await receipt.locator('input[name="rows"]').fill("1");
    await receipt.locator('textarea[name="note"]').fill("The LDL row satisfies the lipid panel in this fictional journey.");
    await receipt.getByRole("checkbox").check();
    await receipt.getByRole("button", { name: "Record checked result" }).click();
    await expect.poll(() => reviewHas("receipts,lipid-panel"), { timeout: 120_000 }).toBe("t");
    await section("Treatment plan");
    const choice = doctor.getByRole("combobox", { name: /Decision/ });
    await caseLoaded();
    await choice.click();
    await doctor.getByRole("option", { name: "Consultation not required" }).click();
    await expect(choice).toContainText("Consultation not required");
    const decision = doctor.locator("form", { has: doctor.getByRole("button", { name: "Save consultation decision" }) });
    await decision.locator("textarea").first().fill("Routine fictional result.");
    // The doctor's real request is held. The same request from the wrong staff is refused and changes nothing, then the
    // held one goes through, so the refusal is about who sent it.
    await doctor.route(`**/staff/real/members/${memberId}*`, async (route) => {
      const held = route.request();
      if (held.method() !== "POST" || !held.postDataBuffer()?.includes("consultation-decision")) return route.fallback();
      const headers = { ...(await held.allHeaders()) };
      delete headers.cookie;
      delete headers["content-length"];
      for (const who of ["nurse", accounts.doctor.id === doctorId ? "otherDoctor" : "doctor"]) {
        const { context: staff } = await staffSignIn(browser, who, "en");
        await staff.request.post(held.url(), { headers, data: held.postDataBuffer()! });
        expect(sql(`select review->'consultation'->>'decision' from public.patient_clinical_cases where user_id='${memberId}'`), `${who} must not decide`).toBe("undecided");
        await staff.close();
      }
      return route.continue();
    });
    await decision.getByRole("button", { name: "Save consultation decision" }).click();
    await expect.poll(() => sql(`select review->'consultation'->>'decision' from public.patient_clinical_cases where user_id='${memberId}'`), { timeout: 120_000 }).toBe("not-required");
    // The held request does not refresh the page by itself.
    await doctor.reload();
    await section("Treatment plan");
    await caseLoaded();
    await doctor.locator('textarea[name="explanation"]').fill(PLAN);
    await doctor.getByRole("textbox", { name: "Care instructions" }).fill("Keep walking every day.");
    await doctor.getByRole("button", { name: "Save private draft" }).click();
    await expect.poll(() => sql(`select count(*) from public.patient_clinical_cases where user_id='${memberId}' and draft_saved_at is not null`), { timeout: 120_000 }).toBe("1");
    await open(member, "/patient/care");
    await expect(member.locator("main")).not.toContainText(PLAN);
    await open(member, "/patient/results");
    await expect(member.locator("main")).not.toContainText("2.1");
  });

  await test.step("publication shows the exact plan and value to the member", async () => {
    await caseLoaded();
    await doctor.getByRole("button", { name: "Publish reviewed care plan" }).click();
    await expect.poll(() => sql(`select count(*) from public.patient_care_plans where user_id='${memberId}' and published_at is not null`), { timeout: 120_000 }).toBe("1");
    await expect(doctor.getByRole("status").filter({ hasText: "Care plan published" })).toBeVisible();
    await expect(doctor.getByRole("button", { name: "Publish reviewed care plan" })).toBeDisabled();
    await open(member, "/patient/care");
    await expect(member.locator("main")).toContainText(PLAN);
    await open(member, "/patient/results");
    await expect(member.locator("main")).toContainText("2.1");
    await member.screenshot({ path: "e2e/.state/results/published-member-hy.png", fullPage: true });
  });
});
