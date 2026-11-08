import { asPerson, desktop, expect, open, openZoe, sql, staffSignIn, test } from "../fixtures";
import { FAKE_REPLY } from "./config.mjs";
import { answerTo, askForDoseCard, deliver, doctorReplies, dueNow, failNext, isZoeText, person, pressUpdate, say, sent, sweep, texts, zoeFinished } from "./bot";

test("a lost send is never repeated and shows as not delivered", async ({ browser }) => {
  const member = person("tgFail"), reply = "A doctor's reply that gets lost.";

  await test.step("Zoe's answer is lost: one attempt, unknown, and still in the app", async () => {
    await failNext("sendMessage", "drop", member.chat);
    await failNext("sendMessage", "drop", member.chat);
    await say(member.chat, "What does a high cholesterol reading mean?");
    await zoeFinished(member.id);
    await sweep();
    const zoe = (await sent(member.chat)).filter((c) => isZoeText(String(c.body.text)));
    expect(zoe, "one attempt only").toHaveLength(1);
    expect(zoe[0].failed).toBe("drop");
    expect(sql(`select state from public.system_messages where member_id='${member.id}' and template_id like 'zoe.%' order by created_at desc limit 1`)).toBe("unknown");
    const { page } = await asPerson(browser, "tgFail", desktop);
    await openZoe(page);
    await expect(page.getByText(FAKE_REPLY.en)).toHaveCount(1);
  });

  await test.step("the doctor's reply is lost: one attempt, and the doctor sees it was not confirmed", async () => {
    const { page } = await staffSignIn(browser, "doctor");
    await failNext("sendMessage", "drop", member.chat);
    await doctorReplies(page, member.id, reply);
    await expect.poll(async () => { await sweep(); return (await texts(member.chat)).filter((t) => t.includes(reply)).length; }).toBe(1);
    await sweep(); await sweep();
    expect((await texts(member.chat)).filter((t) => t.includes(reply)), "never sent again").toHaveLength(1);
    await page.reload();
    await expect(page.getByText("Unknown", { exact: true })).toBeVisible();
    await expect(page.getByText("We can’t confirm it arrived. It will not be resent automatically.")).toBeVisible();
    const { page: admin } = await staffSignIn(browser, "tgAdmin");
    await open(admin, "/staff/real/delivery-problems?locale=en");
    await expect(admin.getByText("Fictional tgFail").first()).toBeVisible();
  });
});

test("a press whose answer is lost is saved once, and redelivery repeats nothing", async () => {
  const member = person("tgAction");
  sql(`insert into public.member_medicines(id,user_id,name,dose,times,started_on) values('e2e00000-0000-4000-8000-000000000b01','${member.id}','Synthetic own medicine','5 mg',${dueNow},current_date-3);`);
  const doses = () => sql(`select coalesce(string_agg(status||':'||revision,','),'') from public.member_medicine_doses where user_id='${member.id}'`);
  const card = await askForDoseCard(member.chat, member.id);
  const press = pressUpdate(member.chat, Number(card.result?.message_id), card.body.reply_markup!.inline_keyboard![0][0].callback_data);

  await failNext("answerCallbackQuery", "drop");
  await failNext("editMessageText", "drop", member.chat);
  expect((await deliver(press)).status).toBe(200);
  await expect.poll(async () => { await sweep(); return doses(); }).toBe("taken:1");
  await expect.poll(async () => (await answerTo(press)).length).toBe(1);
  await expect.poll(async () => (await sent(member.chat, "editMessageText")).map((c) => c.failed), "the lost edit was tried once").toEqual(["drop"]);

  expect((await deliver(press)).status, "the redelivered update is acknowledged").toBe(200);
  await sweep();
  expect(doses()).toBe("taken:1");
  expect(await answerTo(press), "and not processed again").toHaveLength(1);
  expect(await sent(member.chat, "editMessageText"), "and the edit is not tried again").toHaveLength(1);
});
