import { asPerson, desktop, expect, open, sql, test } from "../fixtures";
import { answerTo, askForDoseCard, deliver, dueNow, person, pressUpdate, sent, sweep } from "./bot";

const plan = "e2e00000-0000-4000-8000-000000000a01", first = "e2e00000-0000-4000-8000-000000000a02", second = "e2e00000-0000-4000-8000-000000000a03";
const events = () => sql(`select coalesce(string_agg(medication_id||':'||status||':'||revision,',' order by medication_id),'') from public.patient_dose_events where medication_id in('${first}','${second}')`);

test("dose card with plan medicines: one record from a press, replays and old buttons refused, the app shows it, and a press after unlink does nothing", async ({ browser }) => {
  const member = person("tgDose");
  sql(`insert into public.patient_care_plans(id,user_id,clinician,instructions,published_at) values('${plan}','${member.id}','Dr Fictional Hayk','Fictional only',now()-interval '2 days');
   insert into public.patient_care_medications(id,user_id,plan_id,name,dose,instructions,times,start_date) values
    ('${first}','${member.id}','${plan}','Alpha plan medicine','10 mg','Fictional only',${dueNow},current_date-1),
    ('${second}','${member.id}','${plan}','Beta plan medicine','20 mg','Fictional only',${dueNow},current_date-1);`);

  const card = await askForDoseCard(member.chat, member.id);
  expect(card.body.text).toContain("Alpha plan medicine 10 mg");
  expect(card.body.text).toContain("Beta plan medicine 20 mg");
  expect(card.body.protect_content).toBe(true);
  const keys = card.body.reply_markup!.inline_keyboard!;
  expect(keys.map((row) => row.map((b) => b.text))).toEqual([["1. Mark as taken", "1. Mark as missed"], ["2. Mark as taken", "2. Mark as missed"], ["Refresh"]]);
  expect(keys.flat().every((b) => /^ni1:[A-Za-z0-9_-]{16,60}$/.test(b.callback_data)), "buttons carry only an opaque reference").toBe(true);
  expect(events(), "nothing stored before a press").toBe("");

  const messageId = Number(card.result?.message_id);
  const taken = keys[0][0].callback_data, missed = keys[0][1].callback_data;
  const press = pressUpdate(member.chat, messageId, taken);

  await test.step("a press records the dose once and rewrites the card", async () => {
    expect((await deliver(press)).status).toBe(200);
    await expect.poll(async () => { await sweep(); return events(); }).toBe(`${first}:taken:1`);
    await expect.poll(async () => (await answerTo(press)).map((c) => c.body.text)).toEqual(["Logged as taken."]);
    await expect.poll(async () => (await sent(member.chat, "editMessageText")).length).toBe(1);
    expect((await sent(member.chat, "editMessageText"))[0].body.text).toMatch(/Alpha plan medicine 10 mg, \d\d:\d\d: Taken/);
  });

  await test.step("Telegram redelivering the same update changes nothing", async () => {
    expect((await deliver(press)).status).toBe(200);
    await sweep();
    expect(events()).toBe(`${first}:taken:1`);
    expect(await answerTo(press), "not processed again").toHaveLength(1);
  });

  await test.step("a second tap replays the saved answer and writes nothing", async () => {
    const again = pressUpdate(member.chat, messageId, taken);
    await deliver(again);
    await expect.poll(async () => { await sweep(); return (await answerTo(again)).map((c) => c.body.text); }).toEqual(["Logged as taken."]);
    expect(events()).toBe(`${first}:taken:1`);
  });

  await test.step("the old button for the other answer and a forged one are refused", async () => {
    const old = pressUpdate(member.chat, messageId, missed), forged = pressUpdate(member.chat, messageId, "ni1:AAAAAAAAAAAAAAAAAAAAAAAA");
    await deliver(old); await deliver(forged);
    await expect.poll(async () => { await sweep(); return (await answerTo(old)).length + (await answerTo(forged)).length; }).toBe(2);
    expect((await answerTo(old))[0].body.text).toMatch(/changed after the card was shown/);
    expect((await answerTo(forged))[0].body.text).toBe("This button no longer works. Write to Zoe here again.");
    expect(events()).toBe(`${first}:taken:1`);
  });

  const { page } = await asPerson(browser, "tgDose", desktop);
  await test.step("the app shows the same record", async () => {
    expect(sql(`select recorded_by from public.patient_dose_event_history where medication_id='${first}' and kind='report'`), "the history names the member").toBe(member.id);
    await open(page, "/patient/medicines");
    const row = page.getByText("Alpha plan medicine").first().locator("xpath=ancestor::li[1]");
    await expect(row.getByRole("button", { name: "Change to skipped" }), "a taken dose offers the change").toBeVisible();
    await expect(page.getByText("Beta plan medicine").first().locator("xpath=ancestor::li[1]").getByRole("button", { name: "Change to skipped" }), "the other dose is still open").toHaveCount(0);
  });

  await test.step("after unlinking, a press on a live button writes nothing and sends nothing of the card", async () => {
    await open(page, "/patient/account/telegram");
    await page.getByRole("button", { name: "Disconnect Telegram" }).click();
    await page.getByRole("button", { name: "Yes, disconnect" }).click();
    await expect.poll(() => sql(`select count(*) from public.conversation_endpoints where member_id='${member.id}' and active`)).toBe("0");
    const before = (await sent(member.chat)).length, edits = (await sent(member.chat, "editMessageText")).length;
    const late = pressUpdate(member.chat, messageId, keys[1][0].callback_data);
    await deliver(late);
    await expect.poll(async () => { await sweep(); return (await answerTo(late)).map((c) => c.body.text); }).toEqual(["This chat is no longer connected to your Noreon account."]);
    await sweep();
    expect(events(), "no second dose").toBe(`${first}:taken:1`);
    // Any unlinked chat gets the same fixed next step. Nothing of the card goes out.
    const after = (await sent(member.chat)).slice(before);
    expect(after.map((c) => c.body.text), "only the fixed next step").toEqual([expect.stringContaining("Replies in Telegram are turned off")]);
    expect(after[0].body.reply_markup).toBeUndefined();
    expect((await sent(member.chat, "editMessageText")).length, "no edit").toBe(edits);
  });
});
