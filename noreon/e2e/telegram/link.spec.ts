import { asPerson, expect, open, phone, sql, test } from "../fixtures";
import { chatOf, FAKE_REPLY } from "./config.mjs";
import { contactUpdate, deliver, model, person, runs, say, sent, stored, sweep, texts, zoeFinished, zoeSaid } from "./bot";

const links = (chat: number) => sql(`select count(*) from public.conversation_endpoints e where e.active and e.address='${chat}'`);

test("an unlinked chat is refused, a linked member reaches Zoe, and unlinking stops access", async ({ browser }) => {
  const member = person("tgLink"), stranger = chatOf(99);

  await test.step("a stranger gets the next step and nothing else", async () => {
    await say(stranger, "Բարև, ես ուզում եմ խորհուրդ");
    await expect.poll(async () => { await sweep(); return (await sent(stranger)).length; }).toBeGreaterThan(0);
    expect(sql(`select count(*) from public.conversation_messages where body like '%ուզում եմ խորհուրդ%'`), "nothing stored for anyone").toBe("0");
    expect((await model()).filter((c) => c.user.includes("ուզում եմ խորհուրդ")), "no model call").toEqual([]);
  });

  const { page } = await asPerson(browser, "tgLink", phone);
  await test.step("the member links from the app, and the bot checks their phone number", async () => {
    await open(page, "/patient/account/telegram");
    await page.getByRole("button", { name: "Միացնել Telegram-ը" }).click();
    const href = await page.getByRole("link", { name: "Բացել Telegram-ը" }).getAttribute("href");
    const token = /start=([A-Za-z0-9_-]{32})$/.exec(href!)![1];
    await say(member.chat, `/start ${token}`);
    await expect.poll(async () => { await sweep(); return (await sent(member.chat)).some((c) => c.body.reply_markup?.keyboard?.[0]?.[0]?.request_contact === true); }, "the bot asks for the number").toBe(true);
    expect((await deliver(contactUpdate(member.chat, `+${member.account.phone}`))).status).toBe(200);
    await expect.poll(async () => { await sweep(); return links(member.chat); }).toBe("1");
    await page.reload();
    await expect(page.getByRole("heading", { name: "Միացված է" })).toBeVisible();
  });

  await test.step("the linked member reaches Zoe", async () => {
    await say(member.chat, "Ի՞նչ է խոլեստերինը");
    await zoeFinished(member.id);
    expect(await zoeSaid(member.chat)).toEqual([expect.stringContaining(FAKE_REPLY.hy)]);
  });

  await test.step("unlinking in the app stops access at once", async () => {
    await page.getByRole("button", { name: "Անջատել Telegram-ը" }).click();
    await page.getByRole("button", { name: "Այո, անջատել" }).click();
    await expect(page.getByRole("status").or(page.getByRole("heading", { name: "Միացված չէ" })).first()).toBeVisible();
    expect(links(member.chat)).toBe("0");
    const before = { runs: runs(member.id), said: (await texts(member.chat)).length, stored: stored(member.id), model: (await model()).length };
    await say(member.chat, "Հիմա կրկին գրում եմ անջատելուց հետո");
    await expect.poll(async () => { await sweep(); return (await texts(member.chat)).length; }, "the chat is told it is not connected").toBeGreaterThan(before.said);
    await sweep();
    expect(stored(member.id), "the message reached no conversation").toBe(before.stored);
    expect(runs(member.id)).toBe(before.runs);
    expect((await model()).length).toBe(before.model);
    expect((await zoeSaid(member.chat)).length).toBe(1);
  });
});
