import { asPerson, expect, openZoe, phone, staffSignIn, test } from "../fixtures";
import { FAKE_REPLY } from "./config.mjs";
import { doctorReplies, person, runs, say, sweep, texts, zoeFinished, zoeSaid } from "./bot";

test("doctor takeover: a doctor's reply reaches Telegram and Zoe stays quiet on that topic, except for 103", async ({ browser }) => {
  const member = person("tgTakeover"), reply = "Բժշկի պատասխանը փորձի համար։";
  await say(member.chat, "Ի՞նչ պետք է անեմ բարձր ճնշման դեպքում");
  await zoeFinished(member.id);
  expect(await zoeSaid(member.chat)).toHaveLength(1);

  const { page } = await staffSignIn(browser, "doctor");
  await doctorReplies(page, member.id, reply);
  await expect.poll(async () => { await sweep(); return (await texts(member.chat)).filter((t) => t.includes(reply)).length; }, "the doctor's words reach the chat").toBe(1);
  expect((await texts(member.chat)).find((t) => t.includes(reply)), "under the doctor's name").toContain("Fictional Hayk");
  await page.reload();
  await expect(page.getByRole("heading", { name: "You are answering this member" })).toBeVisible();
  await expect(page.getByText("Sent", { exact: true })).toBeVisible();

  const { page: app } = await asPerson(browser, "tgTakeover", phone);
  await openZoe(app);
  await expect(app.getByText(reply)).toHaveCount(1);

  await say(member.chat, "Հասկացա, իսկ ճնշումը օրական քանի՞ անգամ չափեմ");
  await zoeFinished(member.id);
  expect(runs(member.id)).toMatch(/discarded\/doctor_mode$/);
  expect(await zoeSaid(member.chat), "only the fixed note that the doctor answers now").toEqual([`Զոյա՝ ${FAKE_REPLY.hy}`, "Զոյա՝ Այժմ ձեզ պատասխանում է ձեր բժիշկը։"]);

  await say(member.chat, "Ուժեղ կրծքավանդակի ցավ ունեմ հիմա");
  await zoeFinished(member.id);
  const said = await zoeSaid(member.chat);
  expect(said, "the urgent text still goes").toHaveLength(3);
  expect(said[2]).toContain("103");
});
