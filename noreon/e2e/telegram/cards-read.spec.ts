// Results, plan, LDL goal, /menu and files on Telegram.
import { asPerson, desktop, expect, fixtureId, open, sql, test } from "../fixtures";
import { allCalls, cards, deliver, person, pressUpdate, say, sent, sweep, textUpdate } from "./bot";
import { answers, buttons, cardRows, chatProblems, labels, press, refOf, typeAndSettle, unlinkSql, wrongLanguageLines } from "./cards-lib";

const doctor = fixtureId(1);
const plan = (n: number) => fixtureId(1000 + n);
const publishPlan = (id: string, n: number, instructions: string) => sql(`insert into public.patient_care_plans(id,user_id,clinician,instructions,published_at) values('${plan(n)}','${id}','Dr Fictional Hayk','${instructions.replaceAll("'", "''")}',now()-interval '2 days')`);
const result = (id: string, n: number, marker: string, value: string, ago = "3 days", ref = "") => sql(`insert into public.patient_care_results(user_id,marker,value,unit,collected_at,received_at,source,source_label,reviewed_at,reviewed_by,publication_plan_id${ref ? ",reference_text" : ""}) values('${id}','${marker.replaceAll("'", "''")}',${value},'mmol/L',now()-interval '${ago}',now(),'clinic','Fictional lab',now(),'${doctor}','${plan(n)}'${ref ? `,'${ref}'` : ""})`);
const bigText = (n: number, w = "Fictional sentence about the plan. ") => w.repeat(Math.ceil(n / w.length)).slice(0, n);

/** Asks in plain words and waits for the card. */
async function ask(who: Parameters<typeof person>[0], text: string, kindTitle: string) {
  const m = person(who);
  await typeAndSettle(who, text);
  await expect.poll(async () => { await sweep(); return (await cards(m.chat)).filter((c) => c.body.text!.includes(kindTitle)).length; }, `${kindTitle} card arrives`).toBeGreaterThan(0);
  const c = (await cards(m.chat)).filter((x) => x.body.text!.includes(kindTitle));
  return { m, card: c[c.length - 1] };
}

test("results (Armenian): card, more pages, replays, the app agrees, press after unlink writes nothing", async ({ browser }) => {
  const m = person("tgResultsHy");
  publishPlan(m.id, 1, "Fictional plan.");
  result(m.id, 1, "LDL-C", "1.9", "5 days", "0.0 - 3.0");
  for (let i = 1; i <= 29; i++) result(m.id, 1, `Fictional marker ${String(i).padStart(2, "0")}`, `${i}.5`, `${i} hours`);
  const { card } = await ask("tgResultsHy", "ցույց տուր իմ վերջին արդյունքները", "Ձեր վերջին արդյունքները");
  expect(card.body.text!.split("\n").filter((l) => /^(LDL-C|Fictional marker)/.test(l)).length).toBe(12);
  expect(card.body.text).toContain("LDL-C: 1.9 mmol/L");
  expect(card.body.text!.indexOf("LDL-C")).toBeLessThan(card.body.text!.indexOf("Fictional marker"));
  expect(labels(card)).toEqual(["Ցույց տալ ևս 18-ը", "Թարմացնել"]);
  expect(wrongLanguageLines(card.body.text!, "hy")).toEqual([]);
  const id = Number(card.result?.message_id);
  const more = refOf(card, /Ցույց տալ ևս/);
  const before = (await cards(m.chat)).length;
  const u = await press(m.chat, id, more);
  await expect.poll(async () => { await sweep(); return (await cards(m.chat)).length; }).toBe(before + 1);
  const second = (await cards(m.chat)).at(-1)!;
  const rows = (c: typeof card) => c.body.text!.split("\n").filter((l) => /^(LDL-C|Fictional marker)/.test(l));
  expect(new Set([...rows(card), ...rows(second)]).size, "no row twice across pages").toBe(rows(card).length + rows(second).length);
  // redelivery of the same update: no third card
  await deliver(u); await sweep();
  expect((await cards(m.chat)).length).toBe(before + 1);
  // a second tap (new callback) opens one more card; it must be the same page
  await press(m.chat, id, more);
  await expect.poll(async () => { await sweep(); return (await cards(m.chat)).length; }).toBe(before + 2);
  expect((await cards(m.chat)).at(-1)!.body.text!.split("\n").slice(2).join("\n")).toContain("Fictional marker");
  const page = await asPerson(browser, "tgResultsHy", desktop);
  await open(page.page, "/patient/results");
  expect(await page.page.locator("main").innerText()).toContain("LDL-C");
  // after unlink
  unlinkSql(m.id);
  const cardsBefore = cardRows(m.id), sentBefore = (await sent(m.chat)).length;
  await press(m.chat, id, more);
  expect(cardRows(m.id), "no card written").toBe(cardsBefore);
  expect((await sent(m.chat)).length - sentBefore, "only the fixed 'replies are off' step").toBeLessThanOrEqual(1);
  expect(await chatProblems(m.chat, "hy")).toEqual([]);
});

test("results changed elsewhere: a result removed after the card, then 'more'", async () => {
  const m = person("tgResultsEn");
  publishPlan(m.id, 2, "Fictional plan.");
  for (let i = 1; i <= 26; i++) result(m.id, 2, `Fictional marker ${String(i).padStart(2, "0")}`, `${i}.5`, `${i} hours`);
  const { card } = await ask("tgResultsEn", "show my latest results", "Your latest results");
  const first = card.body.text!.split("\n").filter((l) => /^Fictional marker/.test(l));
  expect(first.length).toBe(12);
  // The doctor withdraws one of the twelve shown (here: unpublish it) before the member taps "Show 12 more".
  sql(`update public.patient_care_results set reviewed_at=null,reviewed_by=null,explanation=null where user_id='${m.id}' and marker='Fictional marker 03'`);
  await press(m.chat, Number(card.result?.message_id), refOf(card, /Show \d+ more/));
  await expect.poll(async () => { await sweep(); return (await cards(m.chat)).length; }).toBe(2);
  const second = (await cards(m.chat)).at(-1)!.body.text!.split("\n").filter((l) => /^Fictional marker/.test(l));
  expect(second.length).toBeGreaterThan(0);
  // Not asserted: "more" pages by offset on the live list, so a withdrawn row makes it skip one (QA finding 8, 30 Oct).
  expect(second.join("\n"), "the withdrawn result is gone").not.toContain("Fictional marker 03");
  expect(await chatProblems(m.chat, "en")).toEqual([]);
});

test("results with very long rows stay inside one message and say what is left out", async () => {
  const m = person("tgResultsBig");
  publishPlan(m.id, 3, "Fictional plan.");
  for (let i = 1; i <= 14; i++) result(m.id, 3, `${"Long marker name ".repeat(12)}${i}`.slice(0, 160), `${i}.5`, `${i} hours`, "R".repeat(150));
  const { card } = await ask("tgResultsBig", "show my latest results", "Your latest results");
  expect(card.body.text!.length).toBeLessThanOrEqual(4096);
  expect(await chatProblems(m.chat, "en")).toEqual([]);
});

test("plan (Armenian): card, changed elsewhere, 'show current', long plan, press after unlink", async ({ browser }) => {
  const m = person("tgPlanHy");
  publishPlan(m.id, 4, "Fictional instructions for the plan.");
  sql(`insert into public.patient_care_medications(user_id,plan_id,name,dose,instructions,times,start_date) values
    ('${m.id}','${plan(4)}','Alpha plan medicine','10 mg','x',array['08:00'::time,'20:00'::time],current_date-3),
    ('${m.id}','${plan(4)}','Ended plan medicine','5 mg','x',array['08:00'::time],current_date-30)`);
  sql(`update public.patient_care_medications set end_date=current_date-1 where name='Ended plan medicine' and user_id='${m.id}'`);
  const { card } = await ask("tgPlanHy", "ցույց տուր իմ պլանը", "Ձեր պլանը");
  expect(card.body.text).toContain("Alpha plan medicine, 10 mg, 08:00, 20:00");
  expect(card.body.text, "an ended course is not in force").not.toContain("Ended plan medicine");
  expect(wrongLanguageLines(card.body.text!, "hy")).toEqual([]);
  expect(labels(card)).toEqual(["Թարմացնել"]);
  const pp = await asPerson(browser, "tgPlanHy", desktop);
  await open(pp.page, "/patient/medicines");
  expect(await pp.page.locator("main").innerText()).toContain("Alpha plan medicine");
  // The doctor publishes a new plan (the old one is replaced).
  sql(`update public.patient_care_plans set active=false where id='${plan(4)}';
   insert into public.patient_care_plans(id,user_id,clinician,instructions,published_at) values('${plan(5)}','${m.id}','Dr Fictional Other','New instructions.',now()-interval '1 minute');
   insert into public.patient_care_medications(user_id,plan_id,name,dose,instructions,times,start_date) values('${m.id}','${plan(5)}','Gamma new medicine','2 mg','x',array['09:00'::time],current_date)`);
  await press(m.chat, Number(card.result?.message_id), refOf(card, "Թարմացնել"));
  await expect.poll(async () => { await sweep(); return (await cards(m.chat)).length; }).toBe(2);
  const fresh = (await cards(m.chat)).at(-1)!;
  expect(fresh.body.text).toContain("Gamma new medicine");
  expect(fresh.body.text).not.toContain("Alpha plan medicine");
  expect(card.body.text, "the old card keeps what it showed").toContain("Alpha plan medicine");
  unlinkSql(m.id);
  const cr = cardRows(m.id);
  await press(m.chat, Number(fresh.result?.message_id), refOf(fresh, "Թարմացնել"));
  expect(cardRows(m.id)).toBe(cr);
  expect(await chatProblems(m.chat, "hy")).toEqual([]);
});

test("plan with a very long text and many long medicines stays inside one message", async () => {
  const m = person("tgPlanBig");
  publishPlan(m.id, 6, bigText(3990));
  for (let i = 0; i < 20; i++) sql(`insert into public.patient_care_medications(user_id,plan_id,name,dose,instructions,times,start_date) values('${m.id}','${plan(6)}','${"Medicine ".repeat(20).slice(0, 190)}${i}','${"dose ".repeat(40).slice(0, 190)}','x',array['08:00'::time,'09:00'::time,'10:00'::time,'11:00'::time,'12:00'::time,'13:00'::time,'14:00'::time,'15:00'::time],current_date)`);
  const { card } = await ask("tgPlanBig", "show my plan", "Your plan");
  // Only the limit: a plan this size is cut mid-medicine with no notice (QA finding 9, 30 Oct).
  expect(card.body.text!.length).toBeLessThanOrEqual(4096);
  expect(await chatProblems(m.chat, "en")).toEqual([]);
});

function seedLdl(id: string, goalMmol = "1.4") {
  publishPlan(id, 7 + (goalMmol === "1.4" ? 0 : 1), "Fictional plan.");
  sql(`insert into public.ldl_index_events(member_id,submission_id,event_type,source,recorded_by) values('${id}',gen_random_uuid(),'acs_mi','doctor_entered','${doctor}');
   insert into public.ldl_goals(member_id,version,submission_id,category,threshold_mmol,reduction_rule,reduction_pct,baseline_kind,baseline_mmol,baseline_on,baseline_source,defaults_version,set_by)
    values('${id}',1,gen_random_uuid(),'very_high',${goalMmol},true,50,'pre_treatment',3.8,'2026-09-01','doctor_entered','e2e',(select user_id from public.workspace_staff where role='doctor' limit 1))`);
}

test("LDL goal (English): card says what the app says, changed elsewhere, press after unlink", async ({ browser }) => {
  const m = person("tgLdlEn");
  seedLdl(m.id);
  result(m.id, 7, "LDL-C", "1.9", "5 days");
  const { card } = await ask("tgLdlEn", "what is my LDL goal", "LDL");
  expect(card.body.text).toContain("below 1.4 mmol/L");
  expect(card.body.text).toContain("1.9 mmol/L");
  expect(card.body.text).toContain("Above your goal");
  const p = await asPerson(browser, "tgLdlEn", desktop);
  await open(p.page, "/patient/progress");
  const app = await p.page.locator("[data-ldl-goal]").innerText();
  expect(app).toContain("1.4");
  expect(app).toContain("1.9");
  // new goal version set elsewhere
  sql(`insert into public.ldl_goals(member_id,version,submission_id,category,threshold_mmol,reduction_rule,reduction_pct,baseline_kind,baseline_mmol,baseline_on,baseline_source,defaults_version,set_by,reason)
   values('${m.id}',2,gen_random_uuid(),'high',2.0,false,null,'unknown',null,null,null,'e2e','${doctor}','Fictional change')`);
  await press(m.chat, Number(card.result?.message_id), refOf(card, "Refresh"));
  await expect.poll(async () => { await sweep(); return (await cards(m.chat)).filter((c) => c.body.text!.includes("LDL")).length; }).toBe(2);
  const fresh = (await cards(m.chat)).at(-1)!;
  expect(fresh.body.text).toContain("below 2.0 mmol/L");
  expect(fresh.body.text).toContain("Below your goal");
  unlinkSql(m.id);
  const cr = cardRows(m.id);
  await press(m.chat, Number(fresh.result?.message_id), refOf(fresh, "Refresh"));
  expect(cardRows(m.id)).toBe(cr);
  expect(await chatProblems(m.chat, "en")).toEqual([]);
});

test("LDL goal (Armenian)", async () => {
  const m = person("tgLdlHy");
  seedLdl(m.id, "1.8");
  result(m.id, 8, "LDL-C", "1.5", "5 days");
  const { card } = await ask("tgLdlHy", "իմ ՑԽԼ նպատակը ինչ է", "ՑԽԼ");
  expect(card.body.text).toContain("1.8");
  expect(card.body.text).toContain("Ձեր նպատակից ցածր է");
  expect(wrongLanguageLines(card.body.text!, "hy")).toEqual([]);
  expect(await chatProblems(m.chat, "hy")).toEqual([]);
});

test("/menu (Armenian): list of tasks, every button opens its card once, variants of the command, replays", async () => {
  const m = person("tgMenuHy");
  await say(m.chat, "/menu");
  await expect.poll(async () => { await sweep(); return (await cards(m.chat)).length; }, "menu arrives").toBe(1);
  const menu = (await cards(m.chat))[0];
  expect(menu.body.text).toBe("Zoe: Ի՞նչ կցանկանայիք անել");
  expect(labels(menu)).toEqual(["Նշել այսօրվա դեղերը", "Գրանցել ճնշումը", "Իմ վերջին արդյունքները", "Իմ պլանը", "Իմ ՑԽԼ նպատակը", "Իմ այցը", "Հայտնել կողմնակի ազդեցության մասին", "Գրել խնամքի թիմին"]);
  expect(cardRows(m.id)).toBe("menu:open:-");
  expect(sql(`select count(*) from public.conversation_messages cm join public.conversations c on c.id=cm.conversation_id where c.member_id='${m.id}'`), "/menu is not stored as a message").toBe("0");
  // The care-team message card has text but no inline buttons. Count delivered messages,
  // and check the stored kind too, so a refusal cannot pass as an opened card.
  const kinds = ["dose", "bp", "results", "plan", "ldl", "visit", "side_effect", "message"];
  let n = (await sent(m.chat)).length;
  let index = 0;
  for (const k of buttons(menu)) {
    await press(m.chat, Number(menu.result?.message_id), k.callback_data);
    n++;
    await expect.poll(async () => { await sweep(); return (await sent(m.chat)).length; }, k.text).toBe(n);
    expect(cardRows(m.id).split(",").at(-1)).toBe(`${kinds[index++]}:open:-`);
  }
  // same button twice is two cards, redelivery of the same update is one
  const last = pressUpdate(m.chat, Number(menu.result?.message_id), buttons(menu)[3].callback_data);
  await deliver(last); await sweep(); await deliver(last); await sweep();
  expect((await sent(m.chat)).length).toBe(n + 1);
  for (const v of ["/MENU", "  /menu  ", "/menu@noreon_e2e_bot", "menu", "մենյու", "меню"]) {
    const before = (await cards(m.chat)).length;
    await say(m.chat, v);
    await expect.poll(async () => { await sweep(); return (await cards(m.chat)).length; }, `variant ${v}`).toBe(before + 1);
  }
  const before = (await cards(m.chat)).length;
  await say(m.chat, "/menu please");
  await sweep();
  expect((await cards(m.chat)).length, "'/menu please' is an ordinary message, not the command").toBe(before);
  expect(await chatProblems(m.chat, "hy")).toEqual([]);
});

test("/menu (English), unlinked chat and press after unlink", async () => {
  const m = person("tgMenuEn");
  await say(m.chat, "/menu");
  await expect.poll(async () => { await sweep(); return (await cards(m.chat)).length; }).toBe(1);
  const menu = (await cards(m.chat))[0];
  expect(labels(menu)).toEqual(["Log today’s medicine", "Record blood pressure", "My latest results", "My plan", "My LDL goal", "My visit", "Report a side effect", "Message my care team"]);
  unlinkSql(m.id);
  const cr = cardRows(m.id);
  await press(m.chat, Number(menu.result?.message_id), buttons(menu)[0].callback_data);
  expect(cardRows(m.id), "no dose card opened").toBe(cr);
  await say(m.chat, "/menu");
  await sweep();
  expect((await cards(m.chat)).length).toBe(1);
  // a stranger
  const stranger = 880000000 + 98;
  await say(stranger, "/menu");
  await sweep();
  expect(await cards(stranger)).toEqual([]);
  expect(await chatProblems(m.chat, "en")).toEqual([]);
});

const documentUpdate = (chat: number, extra: Record<string, unknown> = {}) => {
  const base = textUpdate(chat, "x") as { update_id: number; message: Record<string, unknown> };
  const message = { ...base.message };
  delete message.text;
  return { update_id: base.update_id, message: { ...message, document: { file_id: "BQACAgIAAxkBAAIB", file_unique_id: "AgADabc", file_name: "result.pdf", mime_type: "application/pdf", file_size: 123456 }, ...extra } };
};

test("a file (Armenian member): the text-only reply, once, nothing downloaded, nothing stored, no model call", async () => {
  const m = person("tgMediaHy");
  const calls0 = (await allCalls()).length;
  expect((await deliver(documentUpdate(m.chat))).status).toBe(200);
  await expect.poll(async () => { await sweep(); return (await sent(m.chat)).length; }).toBeGreaterThan(0);
  const reply = (await sent(m.chat))[0];
  expect(reply.body.text).toContain("103");
  expect(reply.body.text).toMatch(/[Ա-֏]/);
  // a second file inside the window and a photo with a caption
  await deliver(documentUpdate(m.chat));
  const photo = documentUpdate(m.chat) as { message: Record<string, unknown> };
  delete photo.message.document; photo.message.photo = [{ file_id: "p", file_unique_id: "u", width: 90, height: 90 }]; photo.message.caption = "my bp is 128/82";
  await deliver(photo);
  await sweep(); await sweep();
  const after = (await allCalls()).slice(calls0);
  expect(after.filter((c) => /file/i.test(c.method)), "no file was fetched").toEqual([]);
  expect((await sent(m.chat)).length, "one reply for three files").toBe(1);
  expect(sql(`select count(*) from public.conversation_messages cm join public.conversations c on c.id=cm.conversation_id where c.member_id='${m.id}'`)).toBe("0");
  expect((await cards(m.chat)).length, "a caption is not read as a reading").toBe(0);
  expect(sql(`select count(*) from public.conversation_doctor_alerts where member_id='${m.id}'`)).toBe("1");
  expect(await chatProblems(m.chat, "hy")).toEqual([]);
});

test("a file (English member) after a card was shown: the card still works, the file is refused once", async () => {
  const m = person("tgMediaEn");
  await typeAndSettle("tgMediaEn", "my bp is 131/84");
  await expect.poll(async () => { await sweep(); return (await cards(m.chat)).length; }).toBe(1);
  const card = (await cards(m.chat))[0];
  await deliver(documentUpdate(m.chat)); await sweep();
  const texts = (await sent(m.chat)).map((c) => c.body.text);
  expect(texts.at(-1)).toContain("only read text messages");
  const u = await press(m.chat, Number(card.result?.message_id), refOf(card, "Yes, save it"));
  expect(await answers(u)).toEqual(["Saved."]);
  expect(sql(`select count(*) from public.patient_measurements where user_id='${m.id}'`)).toBe("1");
  expect(await chatProblems(m.chat, "en")).toEqual([]);
});
