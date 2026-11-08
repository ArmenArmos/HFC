// The blood pressure card on Telegram: a typed reading is shown back and saved once.
import { asPerson, desktop, expect, open, test } from "../fixtures";
import { cards, deliver, person, pressUpdate, say, sent, sweep, zoeFinished } from "./bot";
import { answers, chatProblems, edits, labels, press, readings, refOf, typeAndSettle, unlinkSql, wrongLanguageLines } from "./cards-lib";

test("BP card (English): typed reading shown back, one press saves once, replays and forged buttons write nothing, the app shows it, a press after unlink writes nothing", async ({ browser }) => {
  const m = person("tgBp");
  await typeAndSettle("tgBp", "my bp is 128/82 pulse 70");
  await expect.poll(async () => { await sweep(); return (await cards(m.chat)).length; }, "BP card arrives").toBe(1);
  const card = (await cards(m.chat))[0];
  expect(card.body.text).toContain("Zoe: Blood pressure reading");
  expect(card.body.text).toContain("128/82, pulse 70");
  expect(card.body.protect_content).toBe(true);
  expect(labels(card)).toEqual(["Yes, save it", "Refresh"]);
  expect(readings(m.id), "nothing saved before the press").toBe("");
  expect(wrongLanguageLines(card.body.text!, "en")).toEqual([]);

  const messageId = Number(card.result?.message_id), save = refOf(card, "Yes, save it");
  const u = await press(m.chat, messageId, save);
  await expect.poll(async () => { await sweep(); return readings(m.id); }).toBe("128/82/70");
  expect(await answers(u)).toEqual(["Saved."]);
  const ed = await edits(m.chat);
  expect(ed.length).toBe(1);
  expect(ed[0].body.text).toContain("Saved: 128/82, pulse 70.");
  expect(labels(ed[0])).toEqual(["Refresh"]);

  // redelivery of the same update and a second tap
  await deliver(u); await sweep();
  expect(readings(m.id)).toBe("128/82/70");
  const again = await press(m.chat, messageId, save);
  expect(readings(m.id), "second tap writes nothing").toBe("128/82/70");
  expect(await answers(again)).toEqual(["Saved."]);
  const forged = await press(m.chat, messageId, "ni1:AAAAAAAAAAAAAAAAAAAAAAAA");
  expect(await answers(forged)).toEqual(["This button no longer works. Write to Zoe here again."]);

  const { page } = await asPerson(browser, "tgBp", desktop);
  await open(page, "/patient/measurements");
  const body = await page.locator("main").innerText();
  expect(body).toContain("128/82");
  expect(body).toContain("70");

  // unlink, then the old live button
  unlinkSql(m.id);
  const late = await press(m.chat, messageId, save);
  expect(readings(m.id)).toBe("128/82/70");
  expect(await answers(late)).toEqual(["This chat is no longer connected to your Noreon account."]);
  expect(await chatProblems(m.chat, "en")).toEqual([]);
});

test("BP card (Armenian): typed reading in Armenian words, text correct, one press saves once", async () => {
  const m = person("tgBpHy");
  await typeAndSettle("tgBpHy", "ճնշումս 134/86 է");
  await expect.poll(async () => { await sweep(); return (await cards(m.chat)).length; }, "BP card arrives").toBe(1);
  const card = (await cards(m.chat))[0];
  expect(card.body.text).toContain("134/86");
  expect(card.body.text).toContain("Ճնշման չափում");
  expect(labels(card)).toEqual(["Այո, պահել", "Թարմացնել"]);
  expect(wrongLanguageLines(card.body.text!, "hy")).toEqual([]);
  const u = await press(m.chat, Number(card.result?.message_id), refOf(card, "Այո, պահել"));
  expect(readings(m.id)).toBe("134/86/-");
  expect(await answers(u)).toEqual(["Պահված է։"]);
  expect((await edits(m.chat))[0].body.text).toContain("Պահված է՝ 134/86։");
  expect(await chatProblems(m.chat, "hy")).toEqual([]);
});

test("BP card: numbers alone get a card, and six presses with three sweeps at once save one reading", async () => {
  const m = person("tgBpRace");
  await typeAndSettle("tgBpRace", "128/82");
  await expect.poll(async () => { await sweep(); return (await cards(m.chat)).length; }, "BP card arrives").toBe(1);
  const card = (await cards(m.chat))[0];
  const id = Number(card.result?.message_id), save = refOf(card, "Yes, save it");
  const ups = Array.from({ length: 6 }, () => pressUpdate(m.chat, id, save));
  await Promise.all(ups.map((u) => deliver(u)));
  await Promise.all([sweep(), sweep(), sweep()]);
  await sweep();
  expect(readings(m.id)).toBe("128/82/-");
  const said = await Promise.all(ups.map((u) => answers(u)));
  expect(said.flat().length, "every press answered once").toBe(6);
  expect(await chatProblems(m.chat, "en")).toEqual([]);
});

test("which typed messages get a save card: one plain reading does, a question, another day or two readings do not", async () => {
  const m = person("tgBpWords");
  const cases: [string, string | null][] = [
    ["128/82", "Save this reading: 128/82,"],
    ["BP 128 over 82 mmHg", "Save this reading: 128/82,"],
    ["ճնշումս 13-ի 8", "Save this reading: 130/80,"],
    ["128/82 pulse 70", "Save this reading: 128/82, pulse 70,"],
    ["ճնշումս 128/82 է, զարկերակս 72", "Save this reading: 128/82, pulse 72,"],
    ["my bp is 128/82 yesterday", null],
    ["is 128/82 ok?", null],
    ["bp 128/82 and 130/85", null],
  ];
  for (const [text, line] of cases) {
    const before = (await cards(m.chat)).length;
    await typeAndSettle("tgBpWords", text);
    await sweep();
    const after = await cards(m.chat);
    expect(after.length, text).toBe(before + (line ? 1 : 0));
    if (line) expect(after.at(-1)!.body.text, text).toContain(line);
  }
});

test("an alarming typed reading gets the doctor-today reply and no save card", async () => {
  const m = person("tgUrgentBp");
  await typeAndSettle("tgUrgentBp", "bp 190/125");
  await sweep();
  expect((await cards(m.chat)).length).toBe(0);
  expect((await sent(m.chat)).map((c) => c.body.text).join("\n")).toContain("needs a doctor today");
  expect(readings(m.id)).toBe("");
});

test("a message that names the task and carries a reading gets the card with those numbers", async () => {
  // QA finding 1, 30 Oct: "log my bp 128/82" gets the empty card that asks for the numbers again
  // (lib/telegram-runtime/cards.ts, typed-reading.ts). Keep this as a failing regression until the product is fixed.
  const m = person("tgLogWords");
  await typeAndSettle("tgLogWords", "log my bp 128/82");
  await expect.poll(async () => { await sweep(); return (await cards(m.chat)).length; }, "a card arrives").toBe(1);
  expect((await cards(m.chat))[0].body.text).toContain("128/82");
});

test("a reading followed at once by 'thanks' still gets its card", async () => {
  // QA finding 2, 30 Oct: the card rules read only the newest message, so the card is dropped without a word
  // (supabase/migrations/20261030143000_zoe_chat_cards_entry.sql). Keep this as a failing regression until the product is fixed.
  const m = person("tgQuick");
  await say(m.chat, "my bp is 127/81");
  await say(m.chat, "thanks");
  await zoeFinished(m.id);
  await sweep(); await sweep();
  expect((await cards(m.chat)).length).toBeGreaterThan(0);
});
