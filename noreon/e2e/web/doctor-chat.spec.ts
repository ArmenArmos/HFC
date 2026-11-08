import type { Page } from "@playwright/test";
import { accounts, asPerson, desktop, env, expect, fixtureId, hydrated, open, openZoe, phone, sql, staffSignIn, test } from "../fixtures";

// Sources: V12 D001-D020, D250-D264, D276-D282, D324-D338.
// This covers the reachable chat/page paths, not every matrix row. #459 approval
// cards are outside the suite. SQL arranges sources, never a successful action.
const home = "/staff/real/doctor-workspace";
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const doctorId = accounts.doctor.id;
const variants = [
  { name: "phone English", who: "doctorPhoneEn", locale: "en", size: phone },
  { name: "phone Armenian", who: "doctorPhoneHy", locale: "hy", size: phone },
  { name: "desktop English", who: "doctorDesktopEn", locale: "en", size: desktop },
  { name: "desktop Armenian", who: "doctorDesktopHy", locale: "hy", size: desktop },
] as const;

// Restore the shared switches so later web files keep their original prerequisites.
let switches: { staff: boolean; alerts: boolean; ldl: boolean; notices: boolean };
test.beforeAll(() => {
  switches = JSON.parse(sql(`select json_build_object(
    'staff',(select staff_zoe_enabled from public.staff_zoe_settings where singleton),
    'alerts',coalesce((select enabled from public.care_alert_settings where singleton),false),
    'ldl',(select ldl_response_enabled from public.ldl_goal_settings where singleton),
    'notices',coalesce((select enabled from public.staff_message_notice_settings where singleton),false))`));
  sql(`update public.staff_zoe_settings set staff_zoe_enabled=true where singleton;
    insert into public.care_alert_settings(singleton,enabled) values(true,true) on conflict(singleton) do update set enabled=true;
    update public.ldl_goal_settings set ldl_response_enabled=true where singleton;`);
});
test.afterAll(() => {
  if (!switches) return;
  sql(`update public.staff_zoe_settings set staff_zoe_enabled=${switches.staff} where singleton;
    update public.care_alert_settings set enabled=${switches.alerts} where singleton;
    update public.ldl_goal_settings set ldl_response_enabled=${switches.ldl} where singleton;
    update public.staff_message_notice_settings set enabled=${switches.notices} where singleton;`);
});

/** The chat's actions live in the shell's Menu, in groups; choosing one closes the Menu again. */
async function menu(page: Page, locale: string, en: string, hy: string, group?: [string, string]) {
  const shell = page.locator("details:has(#doctor-chat-menu)");
  await shell.locator("summary").first().click();
  if (group) {
    // A group stays open after its action, so a second visit must not close it again.
    const details = shell.locator("details").filter({ has: page.locator("summary", { hasText: locale === "hy" ? group[1] : group[0] }) });
    if (!(await details.evaluate((el: HTMLDetailsElement) => el.open))) await details.locator("summary").first().click();
  }
  await shell.getByRole("button", { name: locale === "hy" ? hy : en, exact: true }).click();
}
const MORE: [string, string] = ["More actions", "Այլ գործողություններ"];

async function choose(page: Page, who: string, locale: string) {
  const hy = locale === "hy";
  const lists = page.locator("details.dw-members");
  const previousCount = await lists.count();
  await menu(page, locale, "Show my members", "Իմ անդամները");
  // The command appends a list asynchronously. Wait for that result before searching;
  // otherwise .last() still targets the preceding command's list.
  await expect(lists).toHaveCount(previousCount + 1);
  const list = lists.last();
  await list.getByLabel(hy ? "Անուն կամ հեռախոսի թվեր" : "Name or phone digits").fill(`Fictional ${who}`);
  await list.getByRole("button", { name: hy ? "Գտնել անդամներին" : "Find members", exact: true }).click();
  await expect(list.locator("button.dw-member")).toHaveCount(1);
  await list.getByRole("button", { name: new RegExp(`Fictional ${who}`) }).click();
  await expect(page.locator(".dw-patient-header")).toContainText(`Fictional ${who}`);
}

async function memberMessage(page: Page, text: string) {
  await page.locator("textarea").last().fill(text);
  await page.locator('button[type="submit"]').last().click();
  await expect(page.locator('[data-zoe-thread]')).toContainText(text);
}

function alert(memberId: string) {
  return sql(`insert into public.care_alerts(member_id,source,reason_code,rule_id,rule_version,source_ref,doctor_id)
    values('${memberId}','message','urgent_words_matched','e2e.doctor-chat','e2e',gen_random_uuid()::text,'${doctorId}') returning id`);
}

function approvals(memberId: string) {
  return Number(sql(`select count(*) from public.conversation_approvals a join public.conversation_drafts d on d.id=a.draft_id
    join public.conversations c on c.id=d.conversation_id where c.member_id='${memberId}'`));
}

for (const { name, who, locale, size } of variants) {
  test(`${name}: doctor chat from the day summary to records, reply, takeover and live follow-up`, async ({ browser }) => {
    test.setTimeout(600_000);
    const memberId = accounts[who].id;
    const hy = locale === "hy";
    const t = (en: string, armenian: string) => hy ? armenian : en;
    const incoming = `Fictional question for ${who}`;
    const reply = hy ? "Ձեր գրառումը ստացել եմ։\nՇնորհակալություն մանրամասների համար։" : "I have received your note.\nThank you for the details.";
    const summary = `Private fictional summary for ${who}`;
    const { page: member } = await asPerson(browser, who, size);
    await openZoe(member);
    await memberMessage(member, incoming);
    await expect.poll(() => sql(`select count(*) from public.conversation_messages m join public.conversations c on c.id=m.conversation_id
      where c.member_id='${memberId}' and m.body=${quote(incoming)}`)).toBe("1");
    // A known dated BP and an uploaded-history chart. No clinical thresholds in this test.
    sql(`insert into public.patient_measurements(user_id,submission_id,measured_at,systolic,diastolic)
      values('${memberId}',gen_random_uuid(),'2026-10-20T08:00:00Z',137,86);
      insert into public.member_reported_values(user_id,measure,value,unit,measured_on)
      values('${memberId}','ldl_c',2.3,'mmol/L','2026-10-20'),('${memberId}','ldl_c',2.1,'mmol/L','2026-10-27');`);
    const alertId = alert(memberId);
    const facts = { version: "ldl-response-facts-v1", defaultsVersion: "ldl-defaults-2026-10-29",
      value: { mmol: 2.1, on: "2026-10-27", source: "clinic_reviewed" }, goal: null, previous: null, changePct: null,
      reduction: { state: "not_assessable", percent: null, requiredPct: null }, adherence: null, alt: null,
      nextStep: "adherence_unknown", adherenceThresholdPct: 80 };
    const ldlId = sql(`insert into public.ldl_responses(member_id,observation_key,observed_on,status,facts,doctor_id)
      values('${memberId}','cr:'||gen_random_uuid()::text,'2026-10-27','not_assessable',${quote(JSON.stringify(facts))}::jsonb,'${doctorId}') returning id`);
    const { context, page } = await staffSignIn(browser, "doctor", locale, size);

    await test.step("D001, D019, D250-D261: sign-in, matching Today counts and an item opens its card", async () => {
      await expect(page).toHaveURL(env.site + home);
      // The chat starts empty (#481): no greeting, no summary and no cards until the doctor asks. The waiting line is the way in.
      const chat = page.getByRole("region", { name: t("Your day with Zoe", "Ձեր օրը Զոյայի հետ"), exact: true });
      const waitingLine = chat.getByRole("button", { name: hy ? /^Սպասում է՝ \d+$/ : /^\d+ waiting$/ });
      await expect(waitingLine).toBeVisible();
      await expect(page.locator("[data-day-item]")).toHaveCount(0);
      await expect(page.getByText(hy ? /^Ձեր խնամքի ցանկերում \d+ գործ է սպասում/ : /^You have \d+ items waiting across your care queues/)).toHaveCount(0);
      await hydrated(waitingLine);
      const waiting = Number((await waitingLine.innerText()).match(/\d+/)![0]);
      await waitingLine.click();
      const totalText = await page.getByText(hy ? /^Ձեր խնամքի ցանկերում \d+ գործ է սպասում/ : /^You have \d+ items waiting across your care queues/).innerText();
      const total = Number(totalText.match(/\d+/)![0]);
      expect(total, "the waiting line and the summary count the same work").toBe(waiting);
      // The summary lists each non-empty queue as "N label".
      const detail = await page.getByText(hy ? /\d+ խնամքի ահազանգեր/ : /\d+ care alerts/).innerText();
      const queue = (labelEn: string, labelHy: string) => Number(new RegExp(`(\\d+) ${hy ? labelHy : labelEn}`).exec(detail)?.[1] ?? 0);
      const counts = [queue("care alerts", "խնամքի ահազանգեր"), queue("for today", "այսօրվա համար"), queue("for this week", "այս շաբաթվա համար"), queue("for routine review", "ընթացիկ վերանայման համար")];
      expect(counts[0]).toBeGreaterThan(0);
      const extra = [queue("first notes", "առաջին գրառումներ"), queue("LDL reviews", "ՑԽԼ վերանայումներ"), queue("medicine concerns", "դեղերի հարցեր"), queue("overdue tasks", "ժամկետանց առաջադրանքներ")];
      const handoffs = page.getByText(hy ? /^Բուժքրոջ բաց փոխանցումներ՝/ : /^Open nurse handoffs:/);
      const handoffCount = await handoffs.count() ? Number((await handoffs.innerText()).match(/\d+/)![0]) : 0;
      expect(total).toBe([...counts, ...extra, handoffCount].reduce((sum, count) => sum + count, 0));
      const today = await context.newPage();
      await open(today, `/staff/real/today?locale=${locale}`);
      const todayText = await today.locator("main header > p").first().innerText();
      expect(todayText.match(/\d+/g)!.slice(0, 4).map(Number)).toEqual(counts);
      expect(Number(await today.locator("#ldl-responses span").last().innerText())).toBe(extra[1]);
      await expect(today.getByText(`Fictional ${who}`, { exact: true }).first()).toBeVisible();
      const item = page.locator(`[data-day-item="care_alert:${alertId}"]`);
      await expect(item).toContainText(`Fictional ${who}`);
      await expect(item.locator("time")).toHaveAttribute("datetime", /\d{4}-\d{2}-\d{2}/);
      await item.getByRole("button", { name: t("Open decision card", "Բացել որոշման քարտը") }).click();
      await expect(page.locator('[data-decision="alert"]')).toBeVisible();
      await today.close();
    });

    await test.step("D002-D005, D011-D015, D020: glance, dated record answer, chart and no-data state", async () => {
      await expect(page.locator(".dw-patient-header")).toContainText(`Fictional ${who}`);
      const birthYear = sql(`select extract(year from birth_date)::int from public.profiles where id='${memberId}'`);
      await expect(page.locator(".dw-patient-header")).toContainText(birthYear);
      // A member opens with a short summary of what is waiting. The full glance is one menu step away.
      const summaryCard = page.getByRole("region", { name: t("Member summary", "Անդամի ամփոփում"), exact: true });
      await expect(summaryCard).toContainText("137/86");
      // The member's own words come from the conversation read that once lost a row-lock race (#496): the summary must carry them.
      await expect(summaryCard).toContainText(incoming);
      await expect(summaryCard).not.toContainText(t("This could not be read", "Չհաջողվեց կարդալ"));
      await menu(page, locale, "Show dashboard", "Վահանակ", MORE);
      await expect(page.getByRole("region", { name: t("At a glance", "Մի հայացքով"), exact: true })).toBeVisible();
      // The compact overview keeps the full dated records in its source disclosure.
      const glance = page.locator("details.dw-sources");
      await glance.locator("summary").click();
      await expect(glance.getByTestId("zoe-card-overview").getByText("52", { exact: true })).toBeVisible();
      await expect(glance.getByTestId("zoe-card-bp")).toContainText(t("137/86 mmHg", "137/86 մմ ս.ս."));
      const date = hy ? "20 հոկ 2026" : "20 Oct 2026";
      await expect(glance.getByTestId("zoe-card-bp")).toContainText(date);
      await expect(glance.getByTestId("zoe-card-plan").getByRole("status")).toContainText(t("nothing recorded", "ոչինչ գրանցված չէ"));
      await page.getByLabel(t("Ask Zoe…", "Հարցրեք Զոյային…"), { exact: true }).fill(t("What is the latest blood pressure?", "Ո՞րն է վերջին գրանցված ճնշումը"));
      // The first ask can cold-compile in next dev, just like the first page navigation.
      const response = page.waitForResponse(r => new URL(r.url()).pathname === "/staff/real/zoe/ask" && r.request().method() === "POST", { timeout: 120_000 });
      await page.getByRole("button", { name: t("Ask", "Հարցնել"), exact: true }).click();
      expect((await response).status()).toBe(200);
      const answer = page.getByTestId("zoe-answer").last();
      await expect(answer).toContainText(t("137/86 mmHg", "137/86 մմ ս.ս."));
      await expect(answer).toContainText(t("Test stand-in: no model was called.", "Փորձնական փոխարինող. մոդել չի կանչվել։"));
      await expect(answer.locator(`a[href="/staff/real/members/${memberId}"]`).first()).toBeVisible();
      const chart = page.locator('article[aria-labelledby="chart-ldl_c"]');
      await expect(chart).toContainText("2.1");
      await expect(chart.locator("svg.recharts-surface")).toBeVisible();
      await menu(page, locale, "BP chart", "Ճնշման գրաֆիկ", MORE);
      await expect(page.getByText(t("The BP chart is unavailable here. Open the full record.", "Ճնշման գրաֆիկն այստեղ անհասանելի է։ Բացեք ամբողջական գրառումը։"))).toBeVisible();
      await expect(page.getByRole("link", { name: t("Open the full record", "Բացել ամբողջական գրառումը"), exact: true })).toHaveAttribute("href", `/staff/real/members/${memberId}`);
      // An unsupported home question offers the existing page; the stand-in cannot infer a clinical answer.
      const fallback = await context.newPage();
      await open(fallback, `${home}?locale=${locale}`);
      await hydrated(fallback.locator("#doctor-home-ask"));
      await fallback.locator("#doctor-home-ask").fill("Predict next year's MRI result");
      await fallback.getByRole("button", { name: t("Ask", "Հարցնել"), exact: true }).click();
      // Nothing is answered without a member: the question waits and the doctor is asked to choose one.
      await expect(fallback.getByText(t("Choose the member for this question. Zoe will read their saved records.", "Ընտրեք անդամին այս հարցի համար։ Զոյան կկարդա նրա պահպանված գրառումները։"))).toBeVisible();
      await expect(fallback.locator("details.dw-members").last().locator("button.dw-member").first()).toBeVisible();
      await expect(fallback.getByTestId("zoe-answer")).toHaveCount(0);
      await fallback.close();
    });

    await test.step("D017: typed patients command, search, invalid query and an empty result", async () => {
      await open(page, `${home}?locale=${locale}`);
      await hydrated(page.locator("#doctor-home-ask"));
      await page.locator("#doctor-home-ask").fill(t("show my patients", "իմ անդամները"));
      await page.getByRole("button", { name: t("Ask", "Հարցնել"), exact: true }).click();
      const list = page.locator("details.dw-members").last();
      await expect(list.locator("button.dw-member").first()).toBeVisible();
      await expect(list).not.toContainText("Fictional doctorUnassigned");
      await list.getByLabel(t("Name or phone digits", "Անուն կամ հեռախոսի թվեր")).fill("x");
      await list.getByRole("button", { name: t("Find members", "Գտնել անդամներին"), exact: true }).click();
      await expect(list.getByRole("alert")).toContainText(t("Enter at least two letters", "Մուտքագրեք առնվազն երկու տառ"));
      for (const query of ["NoFictionalMatch", "Fictional doctorUnassigned"]) {
        await list.getByLabel(t("Name or phone digits", "Անուն կամ հեռախոսի թվեր")).fill(query);
        await list.getByRole("button", { name: t("Find members", "Գտնել անդամներին"), exact: true }).click();
        await expect(list.getByRole("status")).toContainText(t("No assigned members", "համընկնող կցված անդամներ չկան"));
        await expect(list.locator("button.dw-member")).toHaveCount(0);
      }
      await choose(page, who, locale);
    });

    await test.step("D276: acknowledge stays open; D251: LDL review closes only the review item", async () => {
      const card = page.locator('[data-decision="alert"]');
      const before = approvals(memberId);
      await card.getByRole("button").click();
      await expect(card.getByRole("status")).toHaveText(t("Saved.", "Պահպանված է։"));
      expect(sql(`select state||':'||acknowledged_by::text||':'||(resolved_at is null)::text from public.care_alerts where id='${alertId}'`)).toBe(`acknowledged:${doctorId}:true`);
      // One decision shows at a time; the alert stays first and the others are a step away.
      const ldl = page.locator('[data-decision="ldl"]');
      const next = page.getByRole("button", { name: t("Next item", "Հաջորդ հարցը"), exact: true });
      for (let step = 0; step < 6 && !(await ldl.isVisible()); step++) await next.click();
      await expect(ldl).toBeVisible();
      await expect(ldl).toContainText("2.1");
      await expect(ldl).toContainText(/27 \S+ 2026/);
      await ldl.getByRole("button").click();
      await expect(ldl.getByRole("status")).toHaveText(t("Saved.", "Պահպանված է։"));
      expect(sql(`select closed_by::text from public.ldl_responses where id='${ldlId}' and closed_at is not null`)).toBe(doctorId);
      expect(approvals(memberId), "neither action sends a reply").toBe(before);
    });

    // The reply is written in the conversation card, which opens from the Menu. Saving it puts the decision card in the chat.
    const saveDraft = async (body: string) => {
      await menu(page, locale, "Open conversation", "Բացել զրույցը");
      await page.getByLabel(t("Reply to the member", "Պատասխան անդամին"), { exact: true }).fill(body);
      await page.locator("summary", { hasText: t("Private summary (optional)", "Գաղտնի ամփոփում (ոչ պարտադիր)") }).click();
      await page.getByLabel(t("Private factual summary", "Գաղտնի փաստական ամփոփում"), { exact: true }).fill(summary);
      await page.getByRole("button", { name: t("Review exact reply", "Ստուգել ճշգրիտ պատասխանը"), exact: true }).click();
      await expect(page.getByRole("heading", { name: t("Approve this exact reply", "Հաստատել այս ճշգրիտ պատասխանը"), exact: true })).toBeVisible();
      // The saved draft is the reply card in the chat, with the doctor's exact text.
      await reloadCards();
      await expect(page.locator('[data-decision="reply"], [data-decision="takeover"]').locator("blockquote")).toHaveText(body);
    };
    // A decision card has no reload button of its own: opening the same conversation again reads every card from the record.
    async function reloadCards() {
      const conversationId = sql(`select id from public.staff_zoe_conversations where staff_id='${doctorId}' and member_id='${memberId}' order by last_at desc limit 1`);
      await open(page, `${home}?c=${conversationId}&locale=${locale}`);
      await hydrated(page.locator("#zoe-ask"));
    }
    const send = () => page.locator('[data-decision="reply"], [data-decision="takeover"]').getByRole("button", { name: /^(Send this reply|Ուղարկել այս պատասխանը)/ });
    // One decision shows at a time: step to the reply card before pressing its button.
    const showReply = async () => {
      const card = page.locator('[data-decision="reply"], [data-decision="takeover"]');
      const next = page.getByRole("button", { name: t("Next item", "Հաջորդ հարցը"), exact: true });
      for (let step = 0; step < 8 && !(await card.isVisible()) && (await next.count()) && (await next.isEnabled()); step++) await next.click();
      await expect(card).toBeVisible();
    };
    const pressSend = async () => { await showReply(); await send().click(); };
    const staleText = t("This card has changed. Nothing was applied.", "Այս քարտը փոխվել է։ Ոչինչ չի կիրառվել։");

    await test.step("D325-D327, D334: private draft and stale reply refused after the record changes", async () => {
      const before = approvals(memberId);
      await saveDraft(reply);
      await member.reload();
      await expect(member.locator('[data-zoe-thread]')).not.toContainText(reply);
      await expect(member.locator('[data-zoe-thread]')).not.toContainText(summary);
      sql(`update public.patient_clinical_cases set revision=revision+1 where user_id='${memberId}'`);
      await pressSend();
      await expect(page.getByRole("alert").filter({ hasText: staleText })).toBeVisible();
      expect(approvals(memberId)).toBe(before);
      await reloadCards();
      await saveDraft(reply);
    });

    await test.step("D330, D336: double press publishes exact text once under the doctor's name", async () => {
      // Enable consented Zoe for this member so the real reply action also exercises takeover.
      const previous = JSON.parse(sql(`select coalesce((select json_build_object('collection',consent_collection_enabled,
        'wording',consent_wording_version,'replies',conversational_replies_enabled) from public.zoe_settings where singleton),
        '{"collection":false,"wording":null,"replies":false}'::json)`));
      try {
        // Local takeover prerequisite only: no model calls or model evaluations run in this suite.
        // Bypass this settings guard only inside the fixture transaction, keeping real-call flags off.
        // An error rolls back both the fixture and the trigger change when psql disconnects.
        sql(`begin;
          alter table public.zoe_settings disable trigger zoe_conversational_guard;
          insert into public.zoe_settings(singleton,consent_collection_enabled,consent_wording_version,conversational_replies_enabled)
          values(true,true,'e2e-doctor-chat',true) on conflict(singleton) do update set consent_collection_enabled=true,consent_wording_version='e2e-doctor-chat',conversational_replies_enabled=true;
          insert into public.zoe_consents(member_id,kind,granted,wording_version) values('${memberId}','zoe_reads_messages',true,'e2e-doctor-chat');
          alter table public.zoe_settings enable trigger zoe_conversational_guard;
          commit;`);
        await reloadCards();
        // Reload is asynchronous. Wait for the new consent/mode snapshot before
        // evaluate(), which bypasses Playwright's normal click readiness checks.
        const takeover = page.locator('[data-decision="takeover"]');
        await showReply();
        await expect(takeover.locator("blockquote")).toHaveText(reply);
        const takeoverSend = takeover.getByRole("button", { name: t("Send this reply and take over", "Ուղարկել այս պատասխանը և շարունակել"), exact: true });
        await expect(takeoverSend).toBeEnabled();
        const before = approvals(memberId);
        // Two synchronous presses while the first request is held. This also works on touch viewports.
        let release!: () => void;
        const held = new Promise<void>(resolve => { release = resolve; });
        await page.route(`**${home}*`, async route => {
          if (route.request().method() === "POST") await held;
          await route.continue();
        });
        await takeoverSend.evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
        release();
        await expect.poll(() => approvals(memberId)).toBe(before + 1);
        await page.unroute(`**${home}*`);
        await expect(page.getByRole("status").filter({ hasText: t("Reply approved and queued.", "Պատասխանը հաստատված է և հերթում է։") })).toBeVisible();
        expect(sql(`select a.body from public.conversation_approvals a join public.conversation_drafts d on d.id=a.draft_id
          join public.conversations c on c.id=d.conversation_id where c.member_id='${memberId}' order by a.created_at desc limit 1`)).toBe(reply);
        await member.reload();
        const bubble = member.locator('[data-zoe-bubble="reply"]').filter({ hasText: reply });
        await expect(bubble).toHaveCount(1);
        await expect(bubble).toContainText("Dr Fictional Hayk");
        await expect(member.locator('[data-zoe-thread]')).not.toContainText(summary);
        expect(sql(`select doctor_mode from public.zoe_doctor_mode where member_id='${memberId}'`)).toBe("t");
        await expect(member.locator('[data-zoe-thread]')).toContainText(t("Your doctor is answering you now.", "Այժմ ձեզ պատասխանում է ձեր բժիշկը։"));

        await test.step("D338: the emergency route still opens during takeover", async () => {
          // The dev server compiles /patient/zoe/urgent on first use (about 30 s). Compiling it inside the send makes the
          // page Fast Refresh while the redirect is in flight, and the member stays on the chat (the server did redirect:
          // action 307, urgent page 200 in the app log of run 41490800289). A real build has no such wait, so compile it first.
          await open(member, "/patient/zoe/urgent");
          await open(member, "/patient/zoe");
          // The page was reloaded just above: text typed before it hydrates is lost, and the urgent check then never sees it.
          await hydrated(member.locator("textarea").last());
          await member.locator("textarea").last().fill("I have crushing chest pain right now");
          await member.locator('button[type="submit"]').last().click();
          await expect(member).toHaveURL(/\/patient\/zoe\/urgent/, { timeout: 90_000 });
          await expect(member.getByRole("link", { name: t("Call 103 now", "Զանգահարել 103 հիմա") })).toBeVisible();
        });
        await test.step("D337: hand back on the existing conversation page", async () => {
          await open(page, `/staff/real/conversations/${memberId}?locale=${locale}`);
          await expect(page.getByRole("heading", { name: t("You are answering this member", "Դուք եք պատասխանում այս անդամին"), exact: true })).toBeVisible();
          await page.getByRole("button", { name: t("Hand back to Zoe", "Վերադարձնել Զոյային"), exact: true }).click();
          await expect.poll(() => sql(`select doctor_mode from public.zoe_doctor_mode where member_id='${memberId}'`)).toBe("f");
          await openZoe(member);
          await expect(member.locator('[data-zoe-thread]')).toContainText(t("Zoe is with you again.", "Զոյան կրկին ձեզ հետ է։"));
        });
      } finally {
        sql(`update public.zoe_settings set conversational_replies_enabled=${previous.replies},consent_collection_enabled=${previous.collection},
          consent_wording_version=${previous.wording === null ? "null" : quote(previous.wording)} where singleton;`);
      }
    });

    await test.step("D325: failed network offers recovery, then the same reply can be sent", async () => {
      await open(page, `${home}?locale=${locale}`);
      await choose(page, who, locale);
      const followup = `${reply}\n${t("Follow-up received.", "Հետագա գրառումն ստացված է։")}`;
      await saveDraft(followup);
      const before = approvals(memberId);
      await page.route(`**${home}*`, route => route.request().method() === "POST" ? route.abort("failed") : route.continue());
      await pressSend();
      await expect(page.getByRole("alert").filter({ hasText: t("Reload", "Թարմացրեք") })).toBeVisible();
      expect(approvals(memberId)).toBe(before);
      await page.unroute(`**${home}*`);
      await reloadCards();
      await pressSend();
      await expect.poll(() => approvals(memberId)).toBe(before + 1);
      await member.reload();
      await expect(member.locator('[data-zoe-bubble="reply"]').filter({ hasText: followup })).toHaveCount(1);
    });

    await test.step("D008: a new member message appears without navigating or reloading the doctor", async () => {
      // The read poll arms its one-minute timer when the chat mounts, and a clock installed later cannot move a timer that is
      // already running. So install it first and load the chat again, then advance the poll without waiting a minute.
      await page.clock.install();
      await reloadCards();
      const live = `New fictional message for ${who}`;
      await memberMessage(member, live);
      await page.bringToFront();
      let navigations = 0;
      page.on("framenavigated", frame => { if (frame === page.mainFrame()) navigations++; });
      const waitingLine = page.getByRole("button", { name: hy ? /^Սպասում է՝ \d+$/ : /^\d+ waiting$/ });
      // The poll runs while the doctor reads a member. What arrives is kept for the day, and shows when the doctor opens it.
      await hydrated(waitingLine);
      await waitingLine.click();
      // The member's message reaches the doctor's queue a moment after it is sent, so each minute that passes reads again.
      const arrived = page.getByText(t("New items arrived", "Նոր տարրեր են ստացվել"), { exact: true });
      await expect.poll(async () => { await page.clock.fastForward(60_001); return arrived.count(); }, { timeout: 90_000 }).toBeGreaterThan(0);
      await expect(page.getByText(t("New items arrived", "Նոր տարրեր են ստացվել"), { exact: true }).last()).toBeVisible();
      await expect(page.locator('[data-day-item]').filter({ hasText: `Fictional ${who}` }).first()).toBeVisible();
      // The poll announces new work. Its text is read through the existing record question.
      await page.getByLabel(t("Ask Zoe…", "Հարցրեք Զոյային…"), { exact: true }).fill(t("What did the member write?", "Ի՞նչ է գրել անդամը"));
      await page.getByRole("button", { name: t("Ask", "Հարցնել"), exact: true }).click();
      await expect(page.getByTestId("zoe-answer").last().getByTestId("zoe-card-member_messages")).toContainText(live);
      expect(navigations).toBe(0);
    });

    await test.step("#491: the doctor's replies sit between the member's messages in time order", async () => {
      await menu(page, locale, "Open conversation", "Բացել զրույցը");
      // The card shows the latest few entries; the earlier ones are one press away.
      await page.getByRole("button", { name: hy ? /^Ցույց տալ \d+ ավելի վաղ հաղորդագրություն/ : /^Show \d+ earlier messages?$/ }).click();
      const thread = page.locator("ol.space-y-5 > li");
      await expect(thread.filter({ hasText: incoming })).toHaveCount(1);
      await expect(thread.filter({ hasText: `New fictional message for ${who}` })).toHaveCount(1);
      const texts = await thread.allInnerTexts();
      const at = (text: string) => texts.findIndex(entry => entry.includes(text));
      const sentence = t("Thank you for the details.", "Շնորհակալություն մանրամասների համար։");
      // member question, first reply, follow-up reply, then the later member message: replies are not parked below the messages.
      const order = [at(incoming), at(sentence), at(t("Follow-up received.", "Հետագա գրառումն ստացված է։")), at(`New fictional message for ${who}`)];
      expect(order.every(index => index >= 0), `all four are listed: ${JSON.stringify(texts)}`).toBe(true);
      expect(order, "listed by time").toEqual([...order].sort((a, b) => a - b));
      await expect(page.locator("[data-doctor-reply]")).toHaveCount(2);
    });

    await test.step("D008: Why did Zoe say this reads the saved snapshot, not today's BP", async () => {
      const why = { v: 1, version: "zoe-why-1", at: "2026-10-20T12:00:00Z", decidedBy: "rule",
        reply: { kind: "line", words: "fixed", outcome: "chatted", reason: "e2e_saved_reason", language: locale },
        level: { final: "planned", model: null }, signs: [], doubts: [], rules: [],
        data: [{ key: "bp", source: "home_bp", date: "2026-10-19", value: "146/92 mmHg", reviewed: false, relied: true }],
        doctor: { suggested: false, how: "none", reason: null, why: null },
        models: { provider: "test", model: "saved-model", tier: "low", fallbackUsed: false, rationaleModel: null, prompt: "saved-prompt", config: "e2e" },
        rationale: { status: "not_asked", missing: null, aboutHeldText: false } };
      // Historical source fixture. The browser still goes through the real audited why read.
      const runId = sql(`insert into public.zoe_runs(conversation_id,member_id,message_seq,context_version,draft_epoch,spend_day,state,outcome,reason_code,finished_at,why)
        select c.id,c.member_id,1000+coalesce((select max(message_seq) from public.zoe_runs where conversation_id=c.id),0),c.version,c.draft_epoch,current_date,
          'finished','chatted','e2e_saved_reason',clock_timestamp(),${quote(JSON.stringify(why))}::jsonb from public.conversations c where c.member_id='${memberId}' returning id`);
      await menu(page, locale, "Why did Zoe say this?", "Ինչու Զոյան սա ասաց", [ "Ask about saved records", "Հարցնել պահպանված գրառումների մասին" ]);
      const saved = page.getByTestId("zoe-answer").last().getByTestId("zoe-card-zoe_why");
      await expect(saved).toContainText(runId);
      await expect(saved).toContainText(t("146/92 mmHg", "146/92 մմ ս.ս."));
      await expect(saved).not.toContainText("137/86");
      expect(Number(sql(`select count(*) from public.access_audit where actor_id='${doctorId}' and member_id='${memberId}' and surface='zoe_run_why' and object_id='${runId}'`))).toBeGreaterThan(0);
    });

    await test.step("D001: the old pages remain reachable", async () => {
      // "conversations" (awaiting replies) is a Telegram page for doctors: it is not found while Telegram is off, as in this suite.
      for (const path of ["members", "today", "zoe", "alerts"]) {
        await open(page, `/staff/real/${path}?locale=${locale}`);
        await expect(page.locator("main h1").first()).toBeVisible();
      }
    });
  });
}

for (const size of [phone, desktop]) {
  const label = size === phone ? "phone" : "desktop";
  for (const role of ["nurse", "admin"]) {
    test(`${label}: ${role} keeps the original landing and cannot open doctor chat`, async ({ browser }) => {
      const { page } = await staffSignIn(browser, role, "en", size);
      await expect(page).toHaveURL(`${env.site}/staff/real/members`);
      const response = await page.goto(env.site + home);
      expect(response?.status()).toBe(404);
      await expect(page.getByRole("heading", { name: "Your day with Zoe" })).toHaveCount(0);
    });
  }
  test(`${label}: an unassigned doctor cannot read a selected conversation or the member page`, async ({ browser }) => {
    const memberId = accounts.doctorPhoneEn.id;
    const { page: assigned } = await staffSignIn(browser, "doctor", "en", size);
    await choose(assigned, "doctorPhoneEn", "en");
    const conversationId = sql(`select id from public.staff_zoe_conversations where staff_id='${doctorId}' and member_id='${memberId}' order by last_at desc limit 1`);
    const { page } = await staffSignIn(browser, "otherDoctor", "en", size);
    await open(page, `${home}?c=${conversationId}&locale=en`);
    await expect(page.getByRole("alert").filter({ hasText: "Your workspace could not be read" })).toBeVisible();
    await expect(page.locator("main")).not.toContainText("Fictional doctorPhoneEn");
    const response = await page.goto(`${env.site}/staff/real/members/${memberId}?locale=en`);
    expect(response?.status()).toBe(404);
    await expect(page.locator("body")).not.toContainText("Fictional doctorPhoneEn");
  });

  test(`${label}: assigned-member search pages forward without duplicates and resets`, async ({ browser }) => {
    // Exactly 51 matching assigned members cross the real 50-row boundary. They need no login.
    const ids = Array.from({ length: 51 }, (_, i) => fixtureId(1000 + i));
    sql(`insert into auth.users(id) values ${ids.map(id => `('${id}')`).join(",")};
      update public.profiles set display_name='Fictional paging '||right(id::text,4) where id in(${ids.map(quote).join(",")});
      insert into public.patient_clinical_cases(user_id,assigned_doctor_id)
      values ${ids.map(id => `('${id}','${doctorId}')`).join(",")};`);
    try {
      const { page } = await staffSignIn(browser, "doctor", "en", size);
      await page.locator("#doctor-home-ask").fill("find Fictional paging");
      await page.getByRole("button", { name: "Ask", exact: true }).click();
      const list = page.locator("details.dw-members").last();
      await expect(list.locator("button.dw-member")).toHaveCount(50);
      const first = await list.locator("button.dw-member").allTextContents();
      await list.getByRole("button", { name: "Next members", exact: true }).click();
      await expect(list.locator("button.dw-member")).toHaveCount(1);
      const last = await list.locator("button.dw-member").allTextContents();
      expect(new Set([...first, ...last]).size).toBe(51);
      await expect(list.getByRole("button", { name: "Next members", exact: true })).toHaveCount(0);
      await list.getByRole("button", { name: "Back to all members", exact: true }).click();
      await expect(list.getByLabel("Name or phone digits")).toHaveValue("");
      await expect(list.locator("button.dw-member")).toHaveCount(50);
      await expect(list).not.toContainText("Fictional doctorUnassigned");
    } finally {
      sql(`delete from public.patient_clinical_cases where user_id in(${ids.map(quote).join(",")});
        delete from auth.users where id in(${ids.map(quote).join(",")});`);
    }
  });

  test(`${label}: a real member message queues a neutral doctor Telegram notice`, async ({ browser }) => {
    const who = size === phone ? "doctorDesktopEn" : "doctorDesktopHy";
    const memberId = accounts[who].id;
    const bindingId = fixtureId(900);
    sql(`insert into public.staff_message_notice_settings(singleton,enabled) values(true,true)
      on conflict(singleton) do update set enabled=true;
      insert into public.telegram_auth_bindings(id,auth_user_id,kind,principal_ref,account_ref,phone,address,generation)
      values('${bindingId}','${doctorId}','staff','["telegram","e2e-doctor",9001,"user",99000900]','["e2e-doctor",9001]','+37499000900','99000900',1)
      on conflict(id) do update set active=true;`);
    try {
      const { page } = await asPerson(browser, who, size);
      await openZoe(page);
      const privateText = "Fictional confidential question about cholesterol 2.1 mmol/L";
      await memberMessage(page, privateText);
      const noticeSql = `select json_build_object('body',m.body,'template',m.template_id,'keyboard',m.keyboard)::text
        from public.staff_message_notices n join public.telegram_auth_messages m on m.id=n.telegram_message_id
        join public.conversations c on c.id=n.conversation_id
        where c.member_id='${memberId}' and n.recipient_id='${doctorId}' order by n.created_at desc limit 1`;
      await expect.poll(() => sql(noticeSql)).not.toBe("");
      const notice = JSON.parse(sql(noticeSql));
      expect(notice.template).toBe("staff_message.notice");
      const approvedCopy = sql(`select body from public.system_message_templates where template_id='staff_message.notice'
        and locale=(select locale from public.telegram_auth_messages m join public.staff_message_notices n on n.telegram_message_id=m.id
          join public.conversations c on c.id=n.conversation_id where c.member_id='${memberId}' order by n.created_at desc limit 1)
        order by version desc limit 1`);
      expect(notice.body).toBe(approvedCopy);
      expect(notice.body).toMatch(/new message|նոր հաղորդագրություն/);
      for (const detail of [`Fictional ${who}`, privateText, "cholesterol", "2.1", "mmol/L"]) expect(notice.body).not.toContain(detail);
      expect(notice.keyboard).toEqual({ kind: "open_url", url: `https://backoffice.noreon.health/staff/real/conversations/${memberId}` });
      const { page: doctor } = await staffSignIn(browser, "doctor", "en", size);
      await open(doctor, `/staff/real/notice/conversations/${memberId}`);
      await expect(doctor).toHaveURL(env.site + home);
      // This web suite checks the real queued payload. Telegram dispatch is exercised by e2e/telegram.
    } finally {
      sql(`update public.staff_message_notice_settings set enabled=${switches.notices} where singleton;
        delete from public.telegram_auth_bindings where id='${bindingId}';`);
    }
  });

  test(`${label}: D277-D282 alert outcomes, mandatory Other note and a stale resolution`, async ({ browser }) => {
    const memberId = fixtureId(size === phone ? 1100 : 1101);
    sql(`insert into auth.users(id) values('${memberId}');
      update public.profiles set display_name='Fictional alert ${label}' where id='${memberId}';
      insert into public.patient_clinical_cases(user_id,assigned_doctor_id) values('${memberId}','${doctorId}');`);
    const { page } = await staffSignIn(browser, "doctor", "en", size);
    for (const [resolution, option] of [
      ["member_contacted", "Member contacted"], ["emergency_care_advised", "Emergency care advised"],
      ["no_action_needed", "No action needed"], ["duplicate", "Duplicate"], ["other", "Other (see note)"],
    ]) {
      const id = alert(memberId);
      await open(page, "/staff/real/alerts?locale=en");
      const card = page.locator("li").filter({ has: page.locator(`input[name="alertId"][value="${id}"]`) }).first();
      // A choice made before the page hydrates is dropped when React takes over, and the form then says "Please select an item".
      await hydrated(card.getByRole("button", { name: "Acknowledge" }));
      const prepare = async () => {
        await card.locator("summary").click();
        await card.getByRole("combobox").click();
        await page.getByRole("option", { name: option, exact: true }).click();
      };
      await prepare();
      if (resolution === "other") {
        await card.getByRole("button", { name: "Save resolution" }).click();
        await expect(page.getByRole("status")).toContainText('For "Other", add a short note.');
        expect(sql(`select state from public.care_alerts where id='${id}'`)).toBe("open");
        await prepare();
        await card.locator('textarea[name="note"]').fill("Fictional staff-only outcome note");
      }
      if (resolution === "duplicate") {
        sql(`update public.care_alerts set state_seq=state_seq+1,occurrences=occurrences+1,last_seen_at=clock_timestamp() where id='${id}'`);
        await card.getByRole("button", { name: "Save resolution" }).click();
        await expect(page.getByRole("status")).toContainText("This alert changed while you were looking at it");
        expect(sql(`select state from public.care_alerts where id='${id}'`)).toBe("open");
        await prepare();
      }
      await card.getByRole("button", { name: "Save resolution" }).click();
      await expect(page.getByRole("status")).toHaveText("Alert resolved.");
      expect(sql(`select resolution||':'||resolved_by::text from public.care_alerts where id='${id}' and resolved_at is not null`)).toBe(`${resolution}:${doctorId}`);
      await open(page, "/staff/real/alerts?view=resolved&locale=en");
      const resolved = page.locator("li").filter({ hasText: `Fictional alert ${label}` }).first();
      await expect(resolved).toContainText(option);
      await expect(resolved.getByRole("button")).toHaveCount(0);
    }
    expect(approvals(memberId), "resolving an alert sends no member reply").toBe(0);
  });
}

